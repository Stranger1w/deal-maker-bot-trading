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

async function raise(
  category: "risk" | "engine" | "bot" | "binance" | "mining",
  severity: "info" | "warning" | "critical",
  title: string,
  message: string,
  entityId?: string,
) {
  const db = await getDb();
  const { raiseAlert } = await import("./alerts.server");
  await raiseAlert(db, {
    category,
    severity,
    title,
    message,
    entity: "automation",
    entityId: entityId ?? null,
  });
}

async function audit(
  db: Db,
  action: string,
  entityId: string | null,
  details: Record<string, unknown>,
) {
  await db.from("audit_events").insert({
    action,
    entity: "automation",
    entity_id: entityId,
    details: details as never,
  });
}
/* ---------------------- ÓRDENES REALES EN BINANCE ---------------------- */

type RealOrderOutcome = {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  pnl: number;
  status: "filled" | "error";
  error: string | null;
  stopLoss: boolean;
  takeProfit: boolean;
  env: string;
  note: string;
};

/** Credenciales Binance descifradas en memoria. Nunca se registran ni se devuelven. */
async function loadBinanceSecret(db: Db): Promise<{ apiKey: string; apiSecret: string } | null> {
  const { data } = await db
    .from("binance_credentials")
    .select("api_key_cipher,api_secret_cipher")
    .limit(1)
    .maybeSingle();
  const row = data as { api_key_cipher?: string; api_secret_cipher?: string } | null;
  if (!row?.api_key_cipher || !row?.api_secret_cipher) return null;
  const { decryptSecret } = await import("./crypto.server");
  try {
    return {
      apiKey: await decryptSecret(row.api_key_cipher),
      apiSecret: await decryptSecret(row.api_secret_cipher),
    };
  } catch {
    return null;
  }
}

/**
 * Ciclo real de un bot: entrada MARKET por importe (activo de cotización) y salida
 * MARKET por cantidad cuando se alcanza el stop-loss o el take-profit (obligatorios
 * en Real). El P&L sale del precio real de ejecución de Binance, no de un número
 * aleatorio. Devuelve null cuando no hay nada que operar en este ciclo.
 */
async function realCycleOrder(
  db: Db,
  bot: { id: string; name: string; pair: string; stop_loss_pct: number; take_profit_pct: number },
  size: number,
  minuteKey: string,
): Promise<RealOrderOutcome | null> {
  const {
    placeBinanceOrder,
    fetchBinancePrice,
    getBinanceSymbolRules,
    roundDownToStep,
    resolveBinanceTradingEnv,
  } = await import("./binance-trading.server");

  const creds = await loadBinanceSecret(db);
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
    .in("status", ["filled", "simulated"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = lastRow as { side?: string; quantity?: number; price?: number } | null;
  const openQty = last?.side === "buy" ? Number(last.quantity ?? 0) : 0;
  const entryPrice = last?.side === "buy" ? Number(last.price ?? 0) : 0;

  // Sin posición abierta: entrada por importe en el activo de cotización.
  if (openQty <= 0 || entryPrice <= 0) {
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
        error: `${order.errorCode ?? "sin_codigo"}: ${order.errorMessage ?? "sin detalle"}`,
        stopLoss: false,
        takeProfit: false,
        env,
        note: "entrada rechazada",
      };
    }
    return {
      side: "buy",
      quantity: order.executedQty,
      price: order.price,
      pnl: 0,
      status: "filled",
      error: null,
      stopLoss: false,
      takeProfit: false,
      env,
      note: `entrada ejecutada en ${env}`,
    };
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
  if (!hitStopLoss && !hitTakeProfit) return null;

  const quantity = roundDownToStep(openQty, rules.stepSize);
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
      error: `${order.errorCode ?? "sin_codigo"}: ${order.errorMessage ?? "sin detalle"}`,
      stopLoss: hitStopLoss,
      takeProfit: hitTakeProfit,
      env,
      note: "cierre rechazado",
    };
  }
  const cost = entryPrice * openQty;
  const pnl = Number((order.quoteQty - cost - order.commission).toFixed(2));
  return {
    side: "sell",
    quantity: order.executedQty,
    price: order.price,
    pnl,
    status: "filled",
    error: null,
    stopLoss: hitStopLoss,
    takeProfit: hitTakeProfit,
    env,
    note: `${hitStopLoss ? "stop-loss" : "take-profit"} ejecutado en ${env} (movimiento ${movePct.toFixed(2)}%)`,
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

  // Nube sin PART7 (sin tabla engine_runs): el ciclo sigue sin historial;
  // tras pegar PART7 se registra cada ciclo.
  let runId: string | undefined;
  try {
    const { data: run } = await db
      .from("engine_runs")
      .insert({ trigger, status: "running", started_at: startedAt.toISOString() })
      .select("id")
      .single();
    runId = (run as { id?: string } | null)?.id as string | undefined;
  } catch {
    runId = undefined;
  }

  const finish = async (result: TickResult, engineStatus: string, lastError: string | null) => {
    const durationMs = Date.now() - startedAt.getTime();
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
    await db
      .from("automation_settings")
      .update({
        engine_status: engineStatus,
        last_heartbeat_at: new Date().toISOString(),
        last_error: lastError,
        updated_at: new Date().toISOString(),
      })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    return result;
  };

  try {
    const { data: settings } = await db
      .from("automation_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
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

    if (!settings.engine_enabled) {
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

    const { data: creds } = await db
      .from("binance_credentials")
      .select("api_key_cipher,api_secret_cipher,connection_status");
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
          await audit(db, "binance.geo_restricted", null, {
            source: "engine_tick",
            detail: safeBinanceError(ping.status, raw),
          });
          await raise(
            "binance",
            "critical",
            "Binance bloqueado por región del servidor",
            GEO_RESTRICTED_MESSAGE,
          );
        }
      }
    } catch {
      // Fallo de red puntual: no se marca restricción geográfica.
    }

    const realAllowed =
      settings.allow_real_trading === true && binanceOk && !geoRestricted && binanceCredsOk;
    if (settings.allow_real_trading === true && !binanceOk) {
      await raise(
        "binance",
        "critical",
        "Binance no verificado",
        "El trading real está autorizado pero la conexión con Binance no está verificada. Los bots en Real quedan bloqueados hasta reconectar.",
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const minuteKey = new Date().toISOString().slice(0, 16);

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

    const { data: allBots } = await db.from("bots").select("pair, capital");
    const squadCapital = (allBots ?? []).reduce((s, b) => s + Number(b.capital), 0);
    const pairCapital = (allBots ?? []).reduce<Record<string, number>>((acc, b) => {
      acc[b.pair] = (acc[b.pair] ?? 0) + Number(b.capital);
      return acc;
    }, {});

    let globalDailyLoss = 0;
    let globalWeeklyLoss = 0;

    for (const bot of bots ?? []) {
      botsProcessed++;
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

        // Tope global de capital del Escuadrón y regla de diversificación.
        if (squadCapital > Number(settings.global_max_capital)) {
          await stopBot(db, bot.id, bot.name, "tope_global_capital_escuadron", {
            squad_capital: squadCapital,
            max: Number(settings.global_max_capital),
          });
          continue;
        }
        const pairShare =
          squadCapital > 0 ? ((pairCapital[bot.pair] ?? 0) / squadCapital) * 100 : 0;
        if (pairShare > Number(settings.max_pair_concentration_pct)) {
          await stopBot(db, bot.id, bot.name, "concentracion_excesiva_por_par", {
            pair: bot.pair,
            concentration_pct: Number(pairShare.toFixed(2)),
            max: Number(settings.max_pair_concentration_pct),
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

        // Trading real bloqueado por defecto
        if (bot.mode === "real" && !realAllowed) {
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

        // Protección anti-duplicación: como máximo una entrada y su salida por bot
        // y ciclo. Binance además rechaza el duplicado por `newClientOrderId`.
        const idempotencyKey = `${bot.id}:${minuteKey}`;
        const size = Math.min(Number(bot.capital), Number(bot.max_capital)) * 0.02;

        let side: "buy" | "sell";
        let quantity: number;
        let price = 0;
        let pnlDelta = 0;
        let execStatus: "filled" | "simulated" | "error";
        let execError: string | null = null;
        let hitStopLoss = false;
        let hitTakeProfit = false;
        let note: string;

        if (bot.mode === "real") {
          // Orden MARKET real en Binance (testnet primero): el P&L sale del precio
          // real de ejecución, nunca de un número aleatorio.
          const outcome = await realCycleOrder(db, bot, size, minuteKey);
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
        } else {
          // Demo: simulación interna con dinero falso. Nunca toca Binance.
          const stopLossAmount = (size * Number(bot.stop_loss_pct)) / 100;
          const rawPnl = (Math.random() - 0.45) * size * 0.05;
          pnlDelta = Number(Math.max(rawPnl, -stopLossAmount).toFixed(2));
          hitStopLoss = rawPnl < -stopLossAmount;
          side = pnlDelta >= 0 ? "buy" : "sell";
          quantity = Number(size.toFixed(4));
          execStatus = "simulated";
          note = "ciclo demo simulado";
        }

        const insert = await db.from("bot_executions").insert({
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
        });

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

        // Orden rechazada por Binance: no se altera el P&L del bot ni se cuenta la
        // operación como creada (la ejecución queda registrada con su error).
        if (execStatus === "error") {
          errors++;
          await audit(db, "bot.real_order_rejected", bot.id, {
            symbol: bot.pair,
            side,
            error: execError,
          });
          continue;
        }
        ordersCreated++;

        const newPnl = Number((Number(bot.pnl) + pnlDelta).toFixed(2));
        const peak = Math.max(Number(bot.peak_pnl ?? 0), newPnl);
        dailyLoss = Number((dailyLoss + Math.max(0, -pnlDelta)).toFixed(2));
        weeklyLoss = Number((weeklyLoss + Math.max(0, -pnlDelta)).toFixed(2));
        tradesToday += 1;
        globalDailyLoss += Math.max(0, -pnlDelta);
        globalWeeklyLoss += Math.max(0, -pnlDelta);

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
                !/42703|does not exist|could not find/i.test(`${error.code ?? ""} ${error.message}`)
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
      }
    }

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

    // Límite global de pérdida diaria → kill switch automático
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

    return await finish(
      {
        status: "completed",
        botsProcessed,
        ordersCreated,
        errors,
        retries,
        notes: realAllowed
          ? "Ciclo completado (real autorizado)"
          : "Ciclo completado (solo demo/testnet)",
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
  await audit(db, "risk.limit_reached", botName, { reason, ...details });
  await raise(
    "risk",
    "critical",
    `Bot detenido por límite de riesgo: ${botName}`,
    `Motivo: ${reason}. Detalles: ${JSON.stringify(details)}. No quedan órdenes pendientes: el ciclo se cierra antes de abrir nuevas posiciones.`,
    botId,
  );
}

async function stopAllBots(db: Db, reason: string) {
  const { data: bots } = await db.from("bots").select("id, name").eq("status", "running");
  for (const bot of bots ?? []) {
    await stopBot(db, bot.id, bot.name, reason, {});
  }
}
