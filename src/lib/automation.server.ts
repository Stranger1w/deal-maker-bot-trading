// Motor de automatización 24/7 (server-only).
// Se ejecuta desde un cron/worker durable en la nube: NO depende de la app Electron
// ni de que la PC del usuario esté encendida.
//
// Reglas de seguridad implementadas aquí:
//  - Kill switch global y motor deshabilitado por defecto.
//  - Trading real deshabilitado por defecto: exige allow_real_trading + credenciales
//    Binance verificadas + bot en modo "real" confirmado.
//  - Controles de riesgo por bot y globales; al alcanzarse un límite el bot se detiene,
//    se audita y se registra una alerta.
//  - Protección anti-duplicados por clave de idempotencia única por bot y ciclo.
//  - Reintentos con backoff y registro de errores.

import type { EngineSession } from "./engine-sessions.server";
import type { FilaAjustes } from "./propietario.server";
import {
  capitalPorDueno,
  claveDueno,
  concentracionPct,
  duenoDe,
  duenosQueSuperanConLimitePropio,
  esDelAdmin,
  perdidaDelAdmin,
  sumarPerdida,
  type BotCapital,
} from "./tick-scope";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type TickResult = {
  status: "completed" | "halted" | "idle" | "failed";
  botsProcessed: number;
  ordersCreated: number;
  errors: number;
  retries: number;
  notes: string;
};

/** Fila de automation_settings con los topes propios de un usuario. */
type AjustesUsuario = {
  id: string;
  user_id?: string | null;
  global_max_capital?: number | null;
  max_pair_concentration_pct?: number | null;
  global_max_daily_loss?: number | null;
  global_max_weekly_drawdown_pct?: number | null;
};

async function withRetry<T>(fn: () => Promise<T>, onRetry: () => void, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        onRetry();
        await new Promise((r) => setTimeout(r, 150 * (i + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operación fallida tras reintentos");
}

async function log(db: Db, botId: string, level: "info" | "warn" | "error", message: string) {
  await db.from("bot_logs").insert({ bot_id: botId, level, message });
}

/**
 * Alerta del motor. La alerta SIEMPRE tiene dueño (alerts.user_id es NOT
 * NULL): si no se dice quién, el insert falla y la alerta no se guarda.
 *
 * Un fallo al guardar la alerta no puede tumbar el tick (se dejaria de
 * gestionar posiciones abiertas), asi que se registra en el log del servidor
 * en lugar de propagar el error.
 */
async function raise(
  category: "risk" | "engine" | "bot" | "binance" | "mining",
  severity: "info" | "warning" | "critical",
  title: string,
  message: string,
  entityId: string | undefined,
  userId: string | null,
) {
  if (!userId) {
    // Sin dueño no se puede guardar la alerta (alerts.user_id es NOT NULL).
    // Se deja constancia en el log en lugar de perderla en silencio.
    console.error(
      `[alertas] "${title}" sin dueño: no se puede guardar (alerts.user_id es NOT NULL)`,
    );
    return;
  }
  const db = await getDb();
  const { raiseAlert } = await import("./alerts.server");
  try {
    await raiseAlert(db, {
      category,
      severity,
      title,
      message,
      entity: "automation",
      entityId: entityId ?? null,
      userId,
    });
  } catch (error) {
    console.error(`[alertas] no se pudo guardar "${title}":`, error);
  }
}

// Aplicacion atomica del P&L y los contadores de riesgo (RPC definida en la
// migracion 20260925000003). Evita el leer-calcular-escribir entre el cron y los
// ticks manuales; si la funcion no existe todavia, el llamador hace fallback.
async function applyBotExecutionAtomically(
  db: Db,
  args: {
    botId: string;
    pnlDelta: number;
    lossDelta: number;
    isDemo: boolean;
    today: string;
    weekStart: string;
  },
): Promise<{ ok: boolean }> {
  try {
    const { error } = await db.rpc("bot_apply_execution", {
      p_bot_id: args.botId,
      p_pnl_delta: args.pnlDelta,
      p_loss_delta: args.lossDelta,
      p_is_demo: args.isDemo,
      p_today: args.today,
      p_week_start: args.weekStart,
    });
    if (!error) return { ok: true };
  } catch {
    // Nube sin la funcion: el llamador usa el fallback leer-calcular-escribir.
  }
  return { ok: false };
}

async function audit(
  db: Db,
  action: string,
  entityId: string | null,
  details: Record<string, unknown>,
  userId: string | null = null,
) {
  // types.ts aun no incluye audit_events.user_id: cast.
  await db.from("audit_events").insert({
    action,
    entity: "automation",
    entity_id: entityId,
    details: details as never,
    user_id: userId,
  } as never);
}
/* ---------------------- Ã“RDENES REALES EN BINANCE ---------------------- */

type RealOrderOutcome = {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  pnl: number;
  /** `filled` completo, `partially_filled` si Binance solo ejecuto parte. */
  status: "filled" | "partially_filled" | "error";
  /** true cuando Binance ejecuta solo una fraccion de la orden solicitada. */
  partial: boolean;
  error: string | null;
  stopLoss: boolean;
  takeProfit: boolean;
  env: string;
  note: string;
  orderId: string | null;
  dryRun: boolean;
};

/**
 * Credenciales Binance descifradas en memoria. Nunca se registran ni se devuelven.
 * Solo se usan las del dueno del bot: un bot jamas opera con las claves de otro
 * usuario, y un bot sin dueno no tiene credenciales.
 *
 * La implementacion vive en credenciales.server.ts (la usa tambien la
 * reconciliacion).
 */
async function loadBinanceSecret(
  db: Db,
  ownerId: string | null,
): Promise<{ apiKey: string; apiSecret: string } | null> {
  const { loadBinanceSecret: cargar } = await import("./credenciales.server");
  return cargar(db, ownerId);
}

/**
 * Posicion abierta de un bot (la ultima ejecucion que fue una compra y no
 * se ha cerrado). Es la misma lectura que usa el ciclo real, pero para el
 * modo demo, que no manda ordenes a Binance.
 */
async function posicionAbierta(
  db: Db,
  bot: { id: string; pair: string },
): Promise<{ precio: number; cantidad: number } | null> {
  const { data } = await db
    .from("bot_executions")
    .select("side,quantity,price")
    .eq("bot_id", bot.id)
    .eq("symbol", bot.pair)
    .in("status", ["filled", "simulated", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data as { side?: string; quantity?: number; price?: number } | null;
  if (last?.side !== "buy") return null;
  const cantidad = Number(last.quantity ?? 0);
  const precio = Number(last.price ?? 0);
  if (!(cantidad > 0) || !(precio > 0)) return null;
  return { precio, cantidad };
}

/**
 * Ciclo real de un bot: entrada MARKET por importe (activo de cotización) y salida
 * MARKET por cantidad cuando se alcanza el stop-loss o el take-profit (obligatorios
 * en Real). El P&L sale del precio real de ejecución de Binance, no de un número
 * aleatorio. Devuelve null cuando no hay nada que operar en este ciclo.
 *
 * `senal` es la señal de los indicadores (la misma función que usa el
 * backtest): sin señal de compra no se entra y con señal de venta se sale.
 */
async function realCycleOrder(
  db: Db,
  bot: {
    id: string;
    name: string;
    pair: string;
    stop_loss_pct: number;
    take_profit_pct: number;
    user_id?: string | null;
  },
  size: number,
  minuteKey: string,
  settings: { allow_live_orders?: boolean },
  senal: "buy" | "sell" | null = null,
): Promise<RealOrderOutcome | null> {
  const {
    placeBinanceOrder,
    fetchBinancePrice,
    getBinanceSymbolRules,
    roundDownToStep,
    resolveBinanceTradingEnv,
  } = await import("./binance-trading.server");

  if (settings.allow_live_orders !== true) {
    return {
      side: "buy",
      quantity: 0,
      price: 0,
      pnl: 0,
      status: "error",
      partial: false,
      error: "live_orders_disabled",
      stopLoss: false,
      takeProfit: false,
      env: "dry-run",
      note: "dry-run: activa allow_live_orders para enviar ordenes reales",
      orderId: null,
      dryRun: true,
    };
  }
  const creds = await loadBinanceSecret(db, bot.user_id ?? null);
  if (!creds) {
    await log(
      db,
      bot.id,
      "warn",
      "Modo Real sin credenciales Binance utilizables: ciclo omitido (no se abre ninguna posición).",
    );
    return null;
  }

  const env = await resolveBinanceTradingEnv();
  const symbol = bot.pair.toUpperCase();
  const rules = await getBinanceSymbolRules(symbol, env);
  const clientOrderId = `dm-${bot.id.slice(0, 8)}-${minuteKey.slice(11, 16).replace(":", "")}`;

  const { data: lastRow } = await db
    .from("bot_executions")
    .select("side,quantity,price")
    .eq("bot_id", bot.id)
    .eq("symbol", symbol)
    // `partially_filled` tambien abre posicion: si se omitiera, el motor creeria
    // que no hay posicion abierta y abriria una segunda entrada duplicada.
    .in("status", ["filled", "simulated", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = lastRow as { side?: string; quantity?: number; price?: number } | null;
  const openQty = last?.side === "buy" ? Number(last.quantity ?? 0) : 0;
  const entryPrice = last?.side === "buy" ? Number(last.price ?? 0) : 0;

  // Sin posición abierta: entrada por importe en el activo de cotización.
  // SOLO si hay señal de compra: sin señal no se abre nada (misma regla que
  // el backtest, para que ambos midan lo mismo).
  if (openQty <= 0 || entryPrice <= 0) {
    if (senal !== "buy") {
      await log(db, bot.id, "info", "Ciclo real omitido: sin señal de compra de los indicadores.");
      return null;
    }
    const order = await placeBinanceOrder({
      env,
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      symbol,
      side: "BUY",
      quoteOrderQty: size,
      clientOrderId,
      rules,
    });
    if (!order.ok) {
      return {
        side: "buy",
        quantity: 0,
        price: 0,
        pnl: 0,
        status: "error",
        partial: false,
        error: `${order.errorCode ?? "sin_codigo"}: ${order.errorMessage ?? "sin detalle"}`,
        stopLoss: false,
        takeProfit: false,
        env,
        note: "entrada rechazada",
        orderId: null,
        dryRun: false,
      };
    }
    return {
      side: "buy",
      quantity: order.executedQty,
      price: order.price,
      pnl: 0,
      status: order.partiallyFilled ? "partially_filled" : "filled",
      partial: order.partiallyFilled,
      error: null,
      stopLoss: false,
      takeProfit: false,
      env,
      note: order.partiallyFilled
        ? `entrada PARCIAL en ${env}: solo ${order.executedQty} de ${size} ${rules.quote} se ejecutaron`
        : `entrada ejecutada en ${env}`,
      orderId: order.orderId,
      dryRun: false,
    };
  }

  // ── Reconciliación: antes de vender, comprobar contra el exchange ──────
  // Si el motor cree que hay posición y en Binance no hay nada (venta
  // manual, orden que se perdió, reinicio a medias), NO se manda ninguna
  // orden de venta: se registra la diferencia y se cierra la posición local.
  // Si las cantidades no cuadran, se vende lo que HAY, no lo que se cree.
  let cantidadAVender = openQty;
  try {
    const { reconciliarBot } = await import("./reconciliacion.server");
    const rec = await reconciliarBot(
      db,
      { id: bot.id, name: bot.name, pair: symbol, mode: "real", user_id: bot.user_id },
      env,
    );
    if (rec.consultado) {
      const sinPosicion = rec.discrepancias.find((d) => d.tipo === "posicion_sin_exchange");
      if (sinPosicion) {
        await log(
          db,
          bot.id,
          "warn",
          `Reconciliación: el exchange no tiene ${symbol} pero el motor sí. No se manda ninguna orden; revisa si vendiste a mano.`,
        );
        await audit(
          db,
          "reconciliation.position_missing",
          bot.id,
          { simbolo: symbol, local: sinPosicion.local, exchange: sinPosicion.exchange },
          bot.user_id ?? null,
        );
        return null;
      }
      const cantidadDistinta = rec.discrepancias.find((d) => d.tipo === "cantidad_distinta");
      if (cantidadDistinta && rec.exchange !== null) {
        cantidadAVender = rec.exchange;
        await log(
          db,
          bot.id,
          "warn",
          `Reconciliación: el motor cree que tiene ${cantidadDistinta.local} y el exchange tiene ${rec.exchange}. Se opera con la cantidad real.`,
        );
        await audit(
          db,
          "reconciliation.quantity_mismatch",
          bot.id,
          { simbolo: symbol, local: cantidadDistinta.local, exchange: cantidadDistinta.exchange },
          bot.user_id ?? null,
        );
      }
    }
  } catch (error) {
    // Si la reconciliación falla (red, credenciales), se sigue: el
    // sell se limita a lo que el motor tiene registrado.
    await log(
      db,
      bot.id,
      "warn",
      `Reconciliación no disponible: ${error instanceof Error ? error.message : "error desconocido"}`,
    );
  }

  // Posición abierta: se cierra con stop-loss o take-profit.
  const price = await fetchBinancePrice(symbol, env);
  if (!price) {
    await log(
      db,
      bot.id,
      "warn",
      "Precio de Binance no disponible: se mantiene la posición abierta y no se abre nada nuevo.",
    );
    return null;
  }
  const movePct = ((price - entryPrice) / entryPrice) * 100;
  const hitStopLoss = movePct <= -Number(bot.stop_loss_pct);
  const hitTakeProfit = movePct >= Number(bot.take_profit_pct);
  // Cierra con stop-loss, take-profit o señal de venta.
  if (!hitStopLoss && !hitTakeProfit && senal !== "sell") return null;

  const quantity = roundDownToStep(cantidadAVender, rules.stepSize);
  const order = await placeBinanceOrder({
    env,
    apiKey: creds.apiKey,
    apiSecret: creds.apiSecret,
    symbol,
    side: "SELL",
    quantity,
    clientOrderId,
    rules,
  });
  if (!order.ok) {
    return {
      side: "sell",
      quantity,
      price,
      pnl: 0,
      status: "error",
      partial: false,
      error: `${order.errorCode ?? "sin_codigo"}: ${order.errorMessage ?? "sin detalle"}`,
      stopLoss: hitStopLoss,
      takeProfit: hitTakeProfit,
      env,
      note: "cierre rechazado",
      orderId: null,
      dryRun: false,
    };
  }
  const cost = entryPrice * openQty;
  const pnl = Number((order.quoteQty - cost - order.commission).toFixed(2));
  return {
    side: "sell",
    quantity: order.executedQty,
    price: order.price,
    pnl,
    status: order.partiallyFilled ? "partially_filled" : "filled",
    partial: order.partiallyFilled,
    error: null,
    stopLoss: hitStopLoss,
    takeProfit: hitTakeProfit,
    env,
    note: order.partiallyFilled
      ? `${hitStopLoss ? "stop-loss" : "take-profit"} PARCIAL en ${env}: solo ${order.executedQty} de ${quantity} seVendieron; queda posicion abierta`
      : `${hitStopLoss ? "stop-loss" : hitTakeProfit ? "take-profit" : "senal de venta"} ejecutado en ${env} (movimiento ${movePct.toFixed(2)}%)`,
    orderId: order.orderId,
    dryRun: false,
  };
}

/** Un ciclo del motor. Idempotente por bot dentro del mismo minuto. */
export async function runEngineTick(trigger: "cron" | "manual"): Promise<TickResult> {
  const db = await getDb();
  const startedAt = new Date();
  let retries = 0;
  let errors = 0;
  let ordersCreated = 0;
  let botsProcessed = 0;

  // La configuracion de la plataforma es la fila del ADMINISTRADOR (una fila
  // por usuario). Antes se leia con .limit(1): con mas de un usuario, el
  // motor leia (y escribia) la fila de otro usuario.
  const { leerAjustesPlataforma } = await import("./propietario.server");
  let plataforma: { fila: FilaAjustes; adminId: string | null } | null = null;
  try {
    plataforma = await leerAjustesPlataforma(db);
  } catch (error) {
    console.error("[motor] no se pudo leer la configuracion de la plataforma:", error);
  }
  const settings = plataforma?.fila ?? null;
  const adminId = plataforma?.adminId ?? null;
  // Id exacto de la fila leida: todo lo que escriba el tick va a ESA fila.
  const settingsId = settings?.id ?? null;

  // Nube sin PART7 (sin tabla engine_runs): el ciclo sigue sin historial;
  // tras pegar PART7 se registra cada ciclo.
  let runId: string | undefined;
  try {
    const { data: run } = await db
      .from("engine_runs")
      .insert({
        trigger,
        status: "running",
        started_at: startedAt.toISOString(),
        user_id: adminId,
      } as never)
      .select("id")
      .single();
    runId = (run as { id?: string } | null)?.id as string | undefined;
  } catch {
    runId = undefined;
  }

  // Fase 1 · estado de la sesión del motor en este tick. Se declaran antes de
  // finish() para que contadores y cierre funcionen en cualquier salida del
  // ciclo (incluidos los errores del catch final).
  let sesion: EngineSession | null = null;
  let sesionesOk = false;
  let cierreEnCurso = false;

  const finish = async (result: TickResult, engineStatus: string, lastError: string | null) => {
    const durationMs = Date.now() - startedAt.getTime();
    if (cierreEnCurso && !result.notes.includes("sesión en cierre")) {
      result.notes += " · sesión en cierre (sin nuevas posiciones)";
    }
    if (runId) {
      try {
        await db
          .from("engine_runs")
          .update({
            status: result.status,
            finished_at: new Date().toISOString(),
            bots_processed: result.botsProcessed,
            orders_created: result.ordersCreated,
            errors: result.errors,
            retries: result.retries,
            duration_ms: durationMs,
            notes: result.notes,
          })
          .eq("id", runId);
      } catch {
        // Historial best-effort: no rompe el ciclo si la tabla no existe.
      }
    }
    // Solo se actualiza la fila leida (la del administrador). Antes se
    // actualizaban TODAS las filas (.neq("id","000...")), asi que el tick
    // pisaba el estado de cada usuario.
    if (settingsId) {
      await db
        .from("automation_settings")
        .update({
          engine_status: engineStatus,
          last_heartbeat_at: new Date().toISOString(),
          last_error: lastError,
          updated_at: new Date().toISOString(),
        })
        .eq("id", settingsId);
    }

    // Fase 1 · sesión: contadores de este tick y cierre final cuando ya no
    // quedan posiciones abiertas (el motivo lo fijó el corte del tick).
    if (sesion && sesion.status !== "closed") {
      try {
        const sesiones = await import("./engine-sessions.server");
        await sesiones.registrarTickSesion(db, sesion, {
          runsDelta: 1,
          ordersDelta: result.ordersCreated,
          errorsDelta: result.errors,
        });
      } catch {
        // Best-effort: sin tabla engine_sessions el ciclo no falla.
      }
      if (sesion.status === "closing") {
        try {
          const sesiones = await import("./engine-sessions.server");
          if ((await sesiones.contarPosicionesAbiertas(db, adminId)) === 0) {
            // El Kill Switch tiene prioridad sobre timer/manual: si el ciclo
            // se detiene con el kill switch activo, ese es el motivo de cierre.
            let motivo = sesion.close_reason ?? "manual";
            if (engineStatus === "halted" && settingsId) {
              const { data: actual } = await db
                .from("automation_settings")
                .select("kill_switch")
                .eq("id", settingsId)
                .maybeSingle();
              if (actual?.kill_switch) motivo = "kill_switch";
            }
            const cerrada = await sesiones.cerrarSesion(db, sesion.id, motivo, adminId);
            if (cerrada) sesion = cerrada;
          }
        } catch {
          // Best-effort: el próximo tick reintenta el cierre.
        }
      }
    }
    return result;
  };

  try {
    if (!settings) {
      return await finish(
        {
          status: "failed",
          botsProcessed: 0,
          ordersCreated: 0,
          errors: 1,
          retries: 0,
          notes: "Sin configuración de motor",
        },
        "error",
        "Sin configuración de motor",
      );
    }

    // â”€â”€ Fase 1 · corte de sesión (timer / Detener / Kill Switch) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Va antes de los cortes de kill switch y engine_enabled para que la
    // sesión quede bien resuelta en cualquier salida del ciclo.
    const {
      aperturasPermitidas,
      botTienePosicionAbierta,
      cerrarSesion,
      expiraPorTimer,
      marcarSesionParaCierre,
      obtenerSesionActiva,
    } = await import("./engine-sessions.server");
    try {
      // La sesion viva es la del ADMINISTRADOR (el indice unico parcial es
      // por usuario): antes se leia cualquiera, y el tick podia adoptar la
      // sesion de otro usuario.
      sesion = await obtenerSesionActiva(db, adminId);
      sesionesOk = true;
    } catch {
      // Sin tabla engine_sessions (migración pendiente): el ciclo sigue como
      // antes, decidiendo solo con engine_enabled.
      sesion = null;
      sesionesOk = false;
    }
    if (sesionesOk) {
      try {
        if (sesion && settings.kill_switch) {
          // El Kill Switch tiene prioridad: cierra la sesión ya con ese
          // motivo. Los bots quedan detenidos en un momento y nada gestionará
          // las posiciones después, así que no se espera a ponerlas planas.
          await marcarSesionParaCierre(db, sesion.id, "kill_switch");
          sesion = await cerrarSesion(db, sesion.id, "kill_switch");
        } else if (sesion && expiraPorTimer(sesion, new Date())) {
          // Venció el temporizador: la sesión pasa a 'closing'. Este tick ya
          // no abre posiciones nuevas y sigue gestionando las abiertas con
          // TP/SL; se cierra con motivo 'timer' cuando no queden abiertas.
          await marcarSesionParaCierre(db, sesion.id, "timer");
          sesion = { ...sesion, status: "closing", close_reason: "timer" };
        }
      } catch {
        // Best-effort: si falla la transición, el próximo tick la reintenta.
      }
      cierreEnCurso = sesion?.status === "closing";
    }
    const puedeAbrir = aperturasPermitidas({
      engineEnabled: settings.engine_enabled,
      sesion,
      sesionesOk,
    });

    if (settings.kill_switch) {
      await stopAllBots(db, "kill_switch_global");
      return await finish(
        {
          status: "halted",
          botsProcessed: 0,
          ordersCreated: 0,
          errors: 0,
          retries: 0,
          notes: "Kill switch global activo",
        },
        "halted",
        null,
      );
    }

    // Detener/manual deja engine_enabled apagado, pero mientras la sesión
    // siga en 'closing' el tick sigue para gestionar TP/SL de lo abierto y
    // cerrar la sesión cuando no queden posiciones (Fase 1).
    if (!settings.engine_enabled && !cierreEnCurso) {
      return await finish(
        {
          status: "idle",
          botsProcessed: 0,
          ordersCreated: 0,
          errors: 0,
          retries: 0,
          notes: "Motor desactivado",
        },
        "stopped",
        null,
      );
    }

    const { data: creds } = await db.from("binance_credentials").select("*");
    // Credenciales verificadas / con claves, por dueno: un bot Real solo puede
    // operar si SU dueno las tiene (no basta con que las tenga otro usuario).
    const duenosBinanceOk = new Set<string>();
    const duenosConClaves = new Set<string>();
    for (const c of creds ?? []) {
      const dueno = duenoDe(c);
      if (!dueno) continue;
      if (c.connection_status === "ok") duenosBinanceOk.add(dueno);
      if (c.api_key_cipher && c.api_secret_cipher) duenosConClaves.add(dueno);
    }
    const binanceOk = (creds ?? []).some((c) => c.connection_status === "ok");
    // Sin claves guardadas y utilizables no se puede enviar ninguna orden real.
    const binanceCredsOk = (creds ?? []).some(
      (c) => Boolean(c.api_key_cipher) && Boolean(c.api_secret_cipher),
    );

    // Restricción geográfica de Binance: se detecta en cada ciclo antes de operar.
    const {
      isBinanceGeoRestricted,
      safeBinanceError,
      GEO_RESTRICTED_MESSAGE,
      GEO_RESTRICTED_CODE,
    } = await import("./binance-region");
    let geoRestricted = false;
    try {
      const ping = await fetch("https://api.binance.com/api/v3/ping");
      if (!ping.ok) {
        const raw = await ping.text().catch(() => "");
        geoRestricted = isBinanceGeoRestricted(ping.status, raw);
        if (geoRestricted) {
          await db
            .from("binance_credentials")
            .update({
              connection_status: "geo_restricted",
              geo_restricted: true,
              last_error_code: GEO_RESTRICTED_CODE,
              last_error_message: GEO_RESTRICTED_MESSAGE,
              updated_at: new Date().toISOString(),
            })
            .neq("id", "00000000-0000-0000-0000-000000000000");
          await audit(
            db,
            "binance.geo_restricted",
            null,
            {
              source: "engine_tick",
              detail: safeBinanceError(ping.status, raw),
            },
            adminId,
          );
          await raise(
            "binance",
            "critical",
            "Binance bloqueado por región del servidor",
            GEO_RESTRICTED_MESSAGE,
            undefined,
            adminId,
          );
        }
      }
    } catch {
      // Fallo de red puntual: no se marca restricción geográfica.
    }

    const realAllowed =
      settings.allow_real_trading === true &&
      binanceOk &&
      !geoRestricted &&
      binanceCredsOk &&
      settings.allow_live_orders === true;
    if (settings.allow_real_trading === true && !binanceOk) {
      await raise(
        "binance",
        "critical",
        "Binance no verificado",
        "El trading real está autorizado pero la conexión con Binance no está verificada. Los bots en Real quedan bloqueados hasta reconectar.",
        undefined,
        adminId,
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const cycleKey = new Date().toISOString().slice(0, 19);
    const tickSecs = Number(settings.tick_interval_seconds ?? 60);
    const minuteKey = `${cycleKey}#${tickSecs}s`;

    const { data: bots } = await db
      .from("bots")
      .select("*")
      .eq("status", "running")
      .eq("automation_enabled", true);

    const weekStart = (() => {
      const d = new Date();
      const diff = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - diff);
      return d.toISOString().slice(0, 10);
    })();

    // Configuracion de senales (indicadores y horizonte) de la plataforma.
    // Es la MISMA que usa el backtest: si aqui no hay senal, no se opera.
    const { leerConfigSenales, senalDelBot } = await import("./senal-motor.server");
    const cfgSenales = await leerConfigSenales(db, adminId);

    // ── Selector automático de par (Fase 3) ──────────────────────────────
    // Solo para los bots que lo tienen ENCENDIDO (engine_strategies.auto_symbol,
    // interruptor por bot) y SOLO en testnet de momento: cambiar el par con
    // dinero real sin haberlo probado en testnet seria operar a ciegas.
    const { resolveBinanceTradingEnv } = await import("./binance-trading.server");
    const envTrading = await resolveBinanceTradingEnv();
    const autoSymbolPermitido = envTrading === "testnet";
    const { data: botsAuto } = await db
      .from("engine_strategies" as never)
      .select("bot_id" as never)
      .eq("auto_symbol" as never, true as never);
    const idsConAuto = new Set(
      ((botsAuto ?? []) as unknown as { bot_id: string }[]).map((b) => b.bot_id),
    );

    // Capital y concentracion se miden por dueno: los bots de un usuario no suman
    // al tope del administrador ni a los de otro usuario.
    const { data: allBots } = await db.from("bots").select("*");
    const capitales = capitalPorDueno((allBots ?? []) as unknown as BotCapital[]);

    // Limites PROPIOS de cada usuario (Fase 3): cada usuario tiene su fila en
    // automation_settings con sus topes. El limite de la plataforma (fila del
    // administrador) se usa solo para quien no tenga fila propia.
    const { data: ajustesVarios } = await db
      .from("automation_settings")
      .select(
        "id,user_id,global_max_capital,max_pair_concentration_pct,global_max_daily_loss,global_max_weekly_drawdown_pct",
      );
    const ajustesPorDueno = new Map<string, AjustesUsuario>();
    for (const fila of (ajustesVarios ?? []) as unknown as AjustesUsuario[]) {
      const dueno = duenoDe(fila);
      if (dueno) ajustesPorDueno.set(dueno, fila);
    }
    const maxCapitalDe = (clave: string) =>
      Number(ajustesPorDueno.get(clave)?.global_max_capital ?? settings.global_max_capital);
    const maxConcentracionDe = (clave: string) =>
      Number(
        ajustesPorDueno.get(clave)?.max_pair_concentration_pct ??
          settings.max_pair_concentration_pct,
      );
    const maxPerdidaDiariaDe = (clave: string) =>
      Number(ajustesPorDueno.get(clave)?.global_max_daily_loss ?? settings.global_max_daily_loss);
    const maxPerdidaSemanalDe = (clave: string) =>
      Number(
        ajustesPorDueno.get(clave)?.global_max_weekly_drawdown_pct ??
          settings.global_max_weekly_drawdown_pct,
      );
    /** Limite semanal (pct del capital) de cada dueno, con SU capital. */
    const limiteSemanalDe = (clave: string) =>
      (maxPerdidaSemanalDe(clave) * maxCapitalDe(clave)) / 100;

    const perdidaDia = new Map<string, number>();
    const perdidaSemana = new Map<string, number>();

    for (const bot of bots ?? []) {
      botsProcessed++;
      const duenoId = duenoDe(bot);

      // ── Reevaluacion del par (Auto) ──────────────────────────────────
      // Va antes de la senal: si cambia el par, la senal y la operacion de
      // este ciclo usan el par NUEVO. Nunca cambia con una posicion abierta
      // (lo comprueba reevaluarBot) y nunca cada poco (histresis + intervalo).
      if (autoSymbolPermitido && idsConAuto.has(bot.id)) {
        try {
          const { reevaluarBot } = await import("./asset-reevaluate.server");
          const r = await reevaluarBot(db as never, bot.id, { aplicar: true });
          if (r.aplicado && r.parNuevo) {
            bot.pair = r.parNuevo;
            await log(db, bot.id, "info", `Auto: par cambiado a ${r.parNuevo}. ${r.detalle}`);
          }
        } catch (error) {
          await log(
            db,
            bot.id,
            "warn",
            `Auto: no se pudo reevaluar el par: ${error instanceof Error ? error.message : "error desconocido"}`,
          );
        }
      }

      // La señal de los indicadores: la MISMA función que usa el backtest
      // (senalDe). Sin señal de compra no se abre nada; con señal de venta se
      // cierra lo que haya abierto.
      const senal = cfgSenales ? await senalDelBot(db, bot, cfgSenales) : null;
      // Se declaran fuera del try para que el catch pueda auditar una orden real ya
      // ejecutada en Binance cuyo PnL no se aplicó (fallo de la RPC y del fallback).
      let exchangeOrderId: string | null = null;
      let pnlDelta = 0;
      try {
        // Reinicio diario de contadores de riesgo
        let dailyLoss = Number(bot.daily_loss ?? 0);
        let tradesToday = Number(bot.trades_today ?? 0);
        let weeklyLoss = Number(bot.weekly_loss ?? 0);
        if (bot.risk_day !== today) {
          dailyLoss = 0;
          tradesToday = 0;
        }
        if (bot.risk_week !== weekStart) {
          weeklyLoss = 0;
        }

        // Stop-loss y take-profit son obligatorios para operar en Real.
        if (
          bot.mode === "real" &&
          (Number(bot.stop_loss_pct) <= 0 || Number(bot.take_profit_pct) <= 0)
        ) {
          await stopBot(db, bot.id, bot.name, "faltan_stop_loss_o_take_profit", {
            stop_loss_pct: Number(bot.stop_loss_pct),
            take_profit_pct: Number(bot.take_profit_pct),
          });
          continue;
        }

        // Fase 3 · defensa en profundidad: el modo Real es solo del administrador
        // (promoteBotToReal exige admin + 2FA). Un bot Real de otro usuario se
        // detiene sin operar.
        if (bot.mode === "real" && !esDelAdmin(claveDueno(duenoId), adminId)) {
          await stopBot(db, bot.id, bot.name, "real_solo_administrador", {});
          continue;
        }

        // Tope global de capital del Escuadrón y regla de diversificación (del dueno).
        // Cada usuario se mide con SU propio tope (si no tiene fila propia, el
        // de la plataforma).
        const claveDuenoBot = claveDueno(duenoId);
        const capitalDueno = capitales.get(claveDuenoBot);
        const squadCapital = capitalDueno?.squad ?? 0;
        const maxCapitalDueno = maxCapitalDe(claveDuenoBot);
        if (squadCapital > maxCapitalDueno) {
          await stopBot(db, bot.id, bot.name, "tope_global_capital_escuadron", {
            squad_capital: squadCapital,
            max: maxCapitalDueno,
          });
          continue;
        }
        const pairShare = concentracionPct(capitalDueno, bot.pair);
        const maxConcentracionDueno = maxConcentracionDe(claveDuenoBot);
        if (pairShare > maxConcentracionDueno) {
          await stopBot(db, bot.id, bot.name, "concentracion_excesiva_por_par", {
            pair: bot.pair,
            concentration_pct: Number(pairShare.toFixed(2)),
            max: maxConcentracionDueno,
          });
          continue;
        }

        // Restricción geográfica: el bot Real se pausa de forma segura (sin abrir posiciones).
        if (bot.mode === "real" && geoRestricted) {
          await stopBot(db, bot.id, bot.name, "binance_restriccion_geografica", {
            code: "binance_geo_restricted",
          });
          continue;
        }

        // Trading real bloqueado por defecto (y solo con las credenciales de su dueno)
        const realPermitido =
          realAllowed &&
          duenoId !== null &&
          duenosBinanceOk.has(duenoId) &&
          duenosConClaves.has(duenoId);
        if (bot.mode === "real" && !realPermitido) {
          await log(
            db,
            bot.id,
            "warn",
            "Ciclo omitido: el trading real requiere credenciales Binance verificadas y la autorización global de trading real.",
          );
          continue;
        }

        // Límite de capital asignado
        if (Number(bot.capital) > Number(bot.max_capital)) {
          await stopBot(db, bot.id, bot.name, "limite_capital_asignado", {
            capital: Number(bot.capital),
            max_capital: Number(bot.max_capital),
          });
          continue;
        }

        // Máximo de operaciones por día
        if (tradesToday >= Number(bot.max_trades_per_day)) {
          await stopBot(db, bot.id, bot.name, "maximo_operaciones_diarias", {
            trades_today: tradesToday,
            max: Number(bot.max_trades_per_day),
          });
          continue;
        }

        // Fase 1 · aperturas: sin sesión activa (o en cierre por timer,
        // Detener o Kill Switch) no se abren posiciones nuevas. Una posición
        // real abierta sí pasa por realCycleOrder más abajo, que en ese caso
        // solo hará TP/SL sin entrar de nuevo.
        const gestionandoAbierta =
          cierreEnCurso && bot.mode === "real" && (await botTienePosicionAbierta(db, bot));
        if (!puedeAbrir && !gestionandoAbierta) continue;

        // Protección anti-duplicación: como máximo una entrada y su salida por bot
        // y ciclo. Binance además rechaza el duplicado por `newClientOrderId`.
        const idempotencyKey = `${bot.id}:${cycleKey}:${tickSecs}s`;
        const size = Math.min(Number(bot.capital), Number(bot.max_capital)) * 0.02;

        let side: "buy" | "sell";
        let quantity: number;
        let price = 0;
        let execStatus: "filled" | "partially_filled" | "simulated" | "error";
        let execError: string | null = null;
        let hitStopLoss = false;
        let hitTakeProfit = false;
        let note: string;

        if (bot.mode === "real") {
          // Orden MARKET real en Binance (testnet primero): el P&L sale del precio
          // real de ejecución, nunca de un número aleatorio.
          const outcome = await realCycleOrder(db, bot, size, minuteKey, settings, senal);
          if (!outcome) continue;
          side = outcome.side;
          quantity = outcome.quantity;
          price = outcome.price;
          pnlDelta = outcome.pnl;
          execStatus = outcome.status;
          execError = outcome.error;
          hitStopLoss = outcome.stopLoss;
          hitTakeProfit = outcome.takeProfit;
          note = outcome.note;
          exchangeOrderId = outcome.orderId;
          if (outcome.dryRun) {
            // allow_live_orders apagado: no se envió nada a Binance, así que no se
            // registra ejecución ni se altera el P&L. Queda solo el aviso en el log.
            await log(db, bot.id, "warn", `Ciclo real omitido (dry-run): ${outcome.note}`);
            continue;
          }
        } else {
          // Demo = PAPER TRADING con el precio REAL del mercado (no un número
          // aleatorio): se entra con señal de compra y se sale con stop-loss,
          // take-profit o señal de venta. Así el resultado en demo es
          // comparable con el backtest y con testnet, y se puede medir si la
          // estrategia tiene ventaja antes de arriesgar dinero.
          const { fetchBinancePrice } = await import("./binance-trading.server");
          const precio = await fetchBinancePrice(bot.pair, "production");
          if (!precio) {
            await log(
              db,
              bot.id,
              "warn",
              "Precio de mercado no disponible: el ciclo demo se omite (no se inventa un precio).",
            );
            continue;
          }
          const abierta = await posicionAbierta(db, bot);
          if (abierta) {
            const movimiento = ((precio - abierta.precio) / abierta.precio) * 100;
            const hitStop =
              Number(bot.stop_loss_pct) > 0 && movimiento <= -Number(bot.stop_loss_pct);
            const hitTake =
              Number(bot.take_profit_pct) > 0 && movimiento >= Number(bot.take_profit_pct);
            if (!hitStop && !hitTake && senal !== "sell") {
              await log(
                db,
                bot.id,
                "info",
                `Posición demo abierta (${abierta.cantidad} a ${abierta.precio}): se mantiene (movimiento ${movimiento.toFixed(2)} %).`,
              );
              continue;
            }
            pnlDelta = Number(((precio - abierta.precio) * abierta.cantidad).toFixed(2));
            side = "sell";
            quantity = abierta.cantidad;
            price = precio;
            execStatus = "simulated";
            hitStopLoss = hitStop;
            hitTakeProfit = hitTake;
            note = hitStop
              ? "cierre demo por stop-loss"
              : hitTake
                ? "cierre demo por take-profit"
                : "cierre demo por señal de venta";
          } else if (senal === "buy") {
            side = "buy";
            quantity = Number((size / precio).toFixed(8));
            price = precio;
            pnlDelta = 0;
            execStatus = "simulated";
            note = "entrada demo por señal de compra (paper trading con precio real)";
          } else {
            await log(
              db,
              bot.id,
              "info",
              "Ciclo demo omitido: sin señal de compra y sin posición abierta.",
            );
            continue;
          }
        }

        const execRow = {
          bot_id: bot.id,
          bot_name: bot.name,
          idempotency_key: idempotencyKey,
          mode: bot.mode,
          side,
          symbol: bot.pair,
          quantity,
          price,
          pnl: pnlDelta,
          status: execStatus,
          error: execError,
          exchange_order_id: exchangeOrderId,
        };
        let insert = await db.from("bot_executions").insert(execRow as never);
        if (
          insert.error &&
          /42703|does not exist|could not find/i.test(
            `${insert.error.code ?? ""} ${insert.error.message}`,
          )
        ) {
          const { exchange_order_id: _omit, ...legacyRow } = execRow;
          insert = await db.from("bot_executions").insert(legacyRow as never);
        }

        if (insert.error) {
          if (insert.error.code === "23505") {
            await log(db, bot.id, "info", "Orden duplicada evitada por clave de idempotencia.");
            continue;
          }
          throw new Error(insert.error.message);
        }

        // Trazabilidad honesta: entorno usado (testnet/producción) y motivo del ciclo.
        await log(
          db,
          bot.id,
          execStatus === "error" ? "error" : "info",
          `Orden ${side} ${quantity} ${bot.pair} @ ${price} · ${note}${execError ? ` · ${execError}` : ""}`,
        );

        // Fill parcial: no es silencioso. Queda constancia explicita de que la
        // posicion resultante es menor que la ordenada y requiere reconciliacion.
        if (execStatus === "partially_filled") {
          await log(
            db,
            bot.id,
            "warn",
            `FILL PARCIAL de Binance: se ejecutaron ${quantity} de los ${size} ${bot.pair} solicitados. La posicion se registro con el importe real; revisar en el panel de Binance.`,
          );
          await audit(
            db,
            "bot.order_partially_filled",
            bot.id,
            {
              exchangeOrderId,
              symbol: bot.pair,
              side,
              executed_quantity: quantity,
              requested: size,
              price,
            },
            duenoId,
          );
        }

        // Orden rechazada por Binance: no se altera el P&L del bot ni se cuenta la
        // operación como creada (la ejecución queda registrada con su error).
        if (execStatus === "error") {
          errors++;
          await audit(
            db,
            "bot.real_order_rejected",
            bot.id,
            {
              symbol: bot.pair,
              side,
              error: execError,
            },
            duenoId,
          );
          continue;
        }
        ordersCreated++;

        const lossDelta = Math.max(0, -pnlDelta);
        const atomic = await applyBotExecutionAtomically(db, {
          botId: bot.id,
          pnlDelta,
          lossDelta,
          isDemo: bot.mode === "demo",
          today,
          weekStart,
        });
        const newPnl = Number((Number(bot.pnl) + pnlDelta).toFixed(2));
        const peak = Math.max(Number(bot.peak_pnl ?? 0), newPnl);
        dailyLoss = Number((dailyLoss + Math.max(0, -pnlDelta)).toFixed(2));
        weeklyLoss = Number((weeklyLoss + Math.max(0, -pnlDelta)).toFixed(2));
        tradesToday += 1;
        sumarPerdida(perdidaDia, duenoId, -pnlDelta);
        sumarPerdida(perdidaSemana, duenoId, -pnlDelta);

        if (!atomic.ok) {
          await withRetry(
            async () => {
              // Intento completo (nube con PART7). Si la nube es vieja y faltan
              // columnas, se reintenta con el subset básico para no romper el ciclo.
              const full = {
                pnl: newPnl,
                peak_pnl: peak,
                daily_loss: dailyLoss,
                weekly_loss: weeklyLoss,
                trades_today: tradesToday,
                risk_day: today,
                risk_week: weekStart,
                demo_trades:
                  bot.mode === "demo"
                    ? Number(bot.demo_trades ?? 0) + 1
                    : Number(bot.demo_trades ?? 0),
                last_tick_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              const { error } = await db.from("bots").update(full).eq("id", bot.id);
              if (error) {
                if (
                  !/42703|does not exist|could not find/i.test(
                    `${error.code ?? ""} ${error.message}`,
                  )
                ) {
                  throw new Error(error.message);
                }
                const { error: fallbackError } = await db
                  .from("bots")
                  .update({
                    pnl: newPnl,
                    daily_loss: dailyLoss,
                    weekly_loss: weeklyLoss,
                    trades_today: tradesToday,
                    demo_trades:
                      bot.mode === "demo"
                        ? Number(bot.demo_trades ?? 0) + 1
                        : Number(bot.demo_trades ?? 0),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", bot.id);
                if (fallbackError) throw new Error(fallbackError.message);
              }
            },
            () => {
              retries++;
            },
          );
        }

        const takeProfitAmount = (size * Number(bot.take_profit_pct ?? 0)) / 100;
        const takeProfitHit =
          bot.mode === "real"
            ? hitTakeProfit
            : takeProfitAmount > 0 && pnlDelta >= takeProfitAmount;
        if (takeProfitHit) {
          await log(
            db,
            bot.id,
            "info",
            `Take-profit alcanzado (${bot.take_profit_pct}%): posición cerrada con beneficio.`,
          );
        }
        if (hitStopLoss) {
          await log(
            db,
            bot.id,
            "warn",
            `Stop-loss por operación aplicado (${bot.stop_loss_pct}%).`,
          );
        }

        // Pérdida máxima diaria
        if (dailyLoss >= Number(bot.max_daily_loss)) {
          await stopBot(db, bot.id, bot.name, "limite_perdida_diaria", {
            daily_loss: dailyLoss,
            max: Number(bot.max_daily_loss),
          });
          continue;
        }

        // Drawdown semanal por bot
        if (weeklyLoss >= (Number(bot.max_weekly_drawdown_pct) * Number(bot.max_capital)) / 100) {
          await stopBot(db, bot.id, bot.name, "drawdown_semanal_bot", {
            weekly_loss: weeklyLoss,
            max_pct: Number(bot.max_weekly_drawdown_pct),
          });
          continue;
        }

        // Drawdown acumulado desde el pico
        const drawdownPct = peak > 0 ? ((peak - newPnl) / peak) * 100 : 0;
        if (drawdownPct >= Number(bot.max_drawdown_pct)) {
          await stopBot(db, bot.id, bot.name, "drawdown_maximo", {
            drawdown_pct: Number(drawdownPct.toFixed(2)),
            max: Number(bot.max_drawdown_pct),
          });
        }
      } catch (error) {
        errors++;
        await log(
          db,
          bot.id,
          "error",
          `Error en el ciclo del motor: ${error instanceof Error ? error.message : "desconocido"}`,
        );
        // Orden real ejecutada en Binance pero el PnL no se aplicó: la fila en
        // bot_executions queda sin sincronizar con bots. Se audita para que la
        // discrepancia sea un evento buscable y no una fila silenciosa.
        if (bot.mode === "real" && exchangeOrderId) {
          await audit(
            db,
            "bot.pnl_apply_failed_after_real_order",
            bot.id,
            {
              exchangeOrderId,
              pnlDelta,
              symbol: bot.pair,
              error: error instanceof Error ? error.message : String(error),
            },
            duenoId,
          );
          await log(
            db,
            bot.id,
            "error",
            `Orden real ${exchangeOrderId} ejecutada pero el PnL no se aplicó. Requiere reconciliación manual.`,
          );
        }
      }
    }

    // Fase 3 · limites de cada usuario (no administrador): cada uno se mide con
    // SU propio tope (el de su fila de automation_settings; si no tiene fila
    // propia, el de la plataforma). Solo detienen SUS bots; nunca activan el
    // kill switch ni frenan al administrador u otros usuarios.
    for (const dueno of duenosQueSuperanConLimitePropio(perdidaSemana, limiteSemanalDe, adminId)) {
      await stopBotsDeDueno(db, dueno, "drawdown_semanal_usuario");
    }
    for (const dueno of duenosQueSuperanConLimitePropio(perdidaDia, maxPerdidaDiariaDe, adminId)) {
      await stopBotsDeDueno(db, dueno, "limite_global_perdida_diaria_usuario");
    }

    // Perdidas del administrador: el kill switch y los limites globales siguen
    // funcionando como antes, pero solo con los bots del administrador.
    const globalWeeklyLoss = perdidaDelAdmin(perdidaSemana, adminId);
    const globalDailyLoss = perdidaDelAdmin(perdidaDia, adminId);

    // Límite global de pérdida semanal del Escuadrón
    if (
      globalWeeklyLoss >=
      (Number(settings.global_max_weekly_drawdown_pct) * Number(settings.global_max_capital)) / 100
    ) {
      try {
        await db
          .from("automation_settings")
          .update({
            global_weekly_loss: Number(globalWeeklyLoss.toFixed(2)),
            risk_week: weekStart,
            updated_at: new Date().toISOString(),
          })
          .eq("id", settings.id);
      } catch {
        // Nube sin PART7: sin persistencia semanal, pero se detiene igual.
      }
      await stopAllBots(db, "drawdown_semanal_escuadron");
      await raise(
        "risk",
        "critical",
        "Drawdown semanal del Escuadrón alcanzado",
        `Se pausaron todos los bots tras una pérdida semanal de ${globalWeeklyLoss.toFixed(2)}.`,
        undefined,
        adminId,
      );
      return await finish(
        {
          status: "halted",
          botsProcessed,
          ordersCreated,
          errors,
          retries,
          notes: "Drawdown semanal del Escuadrón alcanzado",
        },
        "halted",
        "Drawdown semanal del Escuadrón alcanzado",
      );
    }

    // Límite global de pérdida diaria â†’ kill switch automático
    if (globalDailyLoss >= Number(settings.global_max_daily_loss)) {
      await db
        .from("automation_settings")
        .update({ kill_switch: true, updated_at: new Date().toISOString() })
        .eq("id", settings.id);
      await stopAllBots(db, "limite_global_perdida_diaria");
      await audit(db, "automation.kill_switch_auto", null, {
        global_daily_loss: Number(globalDailyLoss.toFixed(2)),
        limit: Number(settings.global_max_daily_loss),
      });
      return await finish(
        {
          status: "halted",
          botsProcessed,
          ordersCreated,
          errors,
          retries,
          notes: "Kill switch automático: límite global de pérdida diaria alcanzado",
        },
        "halted",
        "Límite global de pérdida diaria alcanzado",
      );
    }

    let notes: string;
    if (!settings.allow_real_trading) {
      notes = "Ciclo completado (solo demo/testnet)";
    } else if (settings.allow_live_orders !== true) {
      notes = "Ciclo completado (real habilitado pero en dry-run: allow_live_orders desactivado)";
    } else if (realAllowed) {
      notes = "Ciclo completado (real autorizado y ejecutando órdenes)";
    } else {
      notes = "Ciclo completado (real bloqueado: revisar credenciales o geo-restricción)";
    }

    return await finish(
      {
        status: "completed",
        botsProcessed,
        ordersCreated,
        errors,
        retries,
        notes,
      },
      "running",
      null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return await finish(
      {
        status: "failed",
        botsProcessed,
        ordersCreated,
        errors: errors + 1,
        retries,
        notes: message,
      },
      "error",
      message,
    );
  }
}

async function stopBot(
  db: Db,
  botId: string,
  botName: string,
  reason: string,
  details: Record<string, unknown>,
) {
  await db
    .from("bots")
    .update({
      status: "stopped",
      auto_stop_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", botId);
  await log(
    db,
    botId,
    "error",
    `Bot detenido automáticamente: ${reason} ${JSON.stringify(details)}`,
  );
  // La auditoria y la alerta quedan a nombre del dueno del bot para que lo vea.
  const { data: fila } = await db.from("bots").select("*").eq("id", botId).maybeSingle();
  const { adminIdDeLaPlataforma } = await import("./propietario.server");
  const duenoId = duenoDe(fila) ?? (await adminIdDeLaPlataforma(db));
  await audit(db, "risk.limit_reached", botName, { reason, ...details }, duenoId);
  await raise(
    "risk",
    "critical",
    `Bot detenido por límite de riesgo: ${botName}`,
    `Motivo: ${reason}. Detalles: ${JSON.stringify(details)}. No quedan órdenes pendientes: el ciclo se cierra antes de abrir nuevas posiciones.`,
    botId,
    duenoId,
  );
}

async function stopAllBots(db: Db, reason: string) {
  const { data: bots } = await db.from("bots").select("id, name").eq("status", "running");
  for (const bot of bots ?? []) {
    await stopBot(db, bot.id, bot.name, reason, {});
  }
}

/** Detiene solo los bots en ejecucion de un usuario (limite propio alcanzado). */
async function stopBotsDeDueno(db: Db, duenoClave: string, reason: string) {
  const { data: bots } = await db
    .from("bots")
    .select("id, name")
    .eq("status", "running")
    // types.ts aun no incluye bots.user_id: cast.
    .eq("user_id" as never, duenoClave as never);
  for (const bot of bots ?? []) {
    await stopBot(db, bot.id, bot.name, reason, {});
  }
}
