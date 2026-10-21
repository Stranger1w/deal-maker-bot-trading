import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown>,
  userId: string | null = null,
) {
  const db = await admin();
  // types.ts aun no incluye audit_events.user_id (columna anadida a mano): cast.
  await db.from("audit_events").insert({
    action,
    entity,
    entity_id: entityId,
    details: details as never,
    user_id: userId,
  } as never);
}

/* ------------------------------ BINANCE ------------------------------- */

/**
 * Estado de las credenciales de Binance de ESTE usuario.
 *
 * POR QUE ES UNA FUNCION DE SERVIDOR Y NO UNA CONSULTA DEL NAVEGADOR
 * La tabla binance_credentials esta bloqueada por RLS (el navegador recibe un
 * 403). Consultarla desde el cliente hacia que la app dijera "todavia no hay
 * credenciales guardadas" aunque estuvieran guardadas y verificadas: el
 * dueno veia su cuenta como vacia.
 *
 * Aqui solo se devuelven campos SEGUROS: los ultimos 4 caracteres y el
 * estado. El secreto cifrado no sale jamas del servidor.
 */
export const leerCredencialesBinance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { data, error } = await db
      .from("binance_credentials")
      .select(
        "id, api_key_last4, api_secret_last4, market_mode, connection_status, last_tested_at, geo_restricted, last_error_code, last_error_message",
      )
      .eq("user_id", context.userId)
      .limit(1);
    if (error) throw new Error(error.message);
    const fila = (data ?? [])[0] as
      | {
          id: string;
          api_key_last4: string;
          api_secret_last4: string;
          market_mode: string;
          connection_status: string;
          last_tested_at: string | null;
          geo_restricted: boolean;
          last_error_code: string | null;
          last_error_message: string | null;
        }
      | undefined;
    if (!fila) return null;
    return {
      id: fila.id,
      api_key_last4: fila.api_key_last4,
      api_secret_last4: fila.api_secret_last4,
      market_mode: fila.market_mode,
      connection_status: fila.connection_status,
      last_tested_at: fila.last_tested_at,
      geo_restricted: fila.geo_restricted,
      last_error_code: fila.last_error_code,
      last_error_message: fila.last_error_message,
    };
  });

/* ------------------------------- FONDOS ------------------------------- */

export const createDeposit = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        amount: z.number().positive(),
        method: z.enum(["transfer", "wallet", "onchain"]),
        reference: z.string().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const reference = data.reference?.trim() || `DP-${Date.now().toString().slice(-6)}`;
    // El deposito va a la cuenta del usuario que lo hace (no a una cuenta
    // global compartida: con .limit(1) o con el id fijo, el saldo de un
    // usuario movia el del otro).
    const { leerCuentaDeUsuario } = await import("./propietario.server");
    const account = await leerCuentaDeUsuario(db, context.userId);
    if (!account) throw new Error("No hay cuenta de fondos configurada");
    const { error } = await db.from("fund_transactions").insert({
      account_id: account.id,
      kind: "deposit",
      method: data.method,
      amount: data.amount,
      status: "pending",
      reference,
    });
    if (error) throw new Error(error.message);
    await audit(
      "deposit.created",
      "fund_transaction",
      reference,
      { amount: data.amount, method: data.method },
      context.userId,
    );
    return { ok: true, reference };
  });

// Flujo antiguo sin 2FA: deshabilitado. Usa createSecureWithdrawal (risk.functions.ts).
export const createWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        amount: z.number().positive(),
        method: z.enum(["transfer", "wallet", "onchain"]),
      })
      .parse(input),
  )
  .handler(async () => {
    throw new Error(
      "Los retiros exigen sesión autenticada con 2FA verificada. Usa el flujo protegido de Fondos.",
    );
  });

/* ------------------------------- BINANCE ------------------------------ */

async function binancePing(apiKey: string, apiSecret: string) {
  const { signBinanceQuery } = await import("./crypto.server");
  const { isBinanceGeoRestricted, safeBinanceError, GEO_RESTRICTED_MESSAGE, GEO_RESTRICTED_CODE } =
    await import("./binance-region");
  // Valida contra el host del entorno configurado: en testnet las claves de
  // testnet se comprueban contra testnet.binance.vision y no contra
  // produccion, donde nunca serian validas.
  const { BINANCE_HOSTS, resolveBinanceTradingEnv } = await import("./binance-trading.server");
  const env = await resolveBinanceTradingEnv();
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = await signBinanceQuery(query, apiSecret);
  const res = await fetch(`${BINANCE_HOSTS[env]}/api/v3/account?${query}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (res.ok)
    return {
      ok: true as const,
      restricted: false,
      code: null as string | null,
      message: `Conexión verificada contra ${env}`,
      env,
    };
  const raw = await res.text().catch(() => "");
  let msg = "";
  try {
    msg = (JSON.parse(raw) as { msg?: string }).msg ?? "";
  } catch {
    msg = "";
  }
  if (isBinanceGeoRestricted(res.status, raw)) {
    return {
      ok: false as const,
      restricted: true,
      code: GEO_RESTRICTED_CODE,
      message: GEO_RESTRICTED_MESSAGE,
      detail: safeBinanceError(res.status, msg || raw),
      env,
    };
  }
  return {
    ok: false as const,
    restricted: false,
    code: `http_${res.status}`,
    message: msg || `Binance respondió ${res.status}`,
    env,
  };
}

export const testBinanceConnection = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ apiKey: z.string().min(8), apiSecret: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const test = await binancePing(data.apiKey.trim(), data.apiSecret.trim());
    if (test.restricted) {
      // Error seguro y auditado: nunca se registran claves ni firmas.
      const { raiseAlertStandalone } = await import("./alerts.server");
      await audit(
        "binance.geo_restricted",
        "binance_credentials",
        null,
        {
          source: "test_connection",
          code: test.code,
          detail: "detail" in test ? test.detail : null,
        },
        context.userId,
      );
      await raiseAlertStandalone({
        category: "binance",
        severity: "critical",
        title: "Binance bloqueado por región del servidor",
        message: test.message,
        entity: "binance",
        userId: context.userId,
      });
    }
    return test;
  });

export const saveBinanceCredentials = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        apiKey: z.string().min(8),
        apiSecret: z.string().min(8),
        marketMode: z.enum(["spot", "futures", "both"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { encryptSecret } = await import("./crypto.server");
    const db = await admin();
    const apiKey = data.apiKey.trim();
    const apiSecret = data.apiSecret.trim();
    const test = await binancePing(apiKey, apiSecret);
    const row = {
      api_key_last4: apiKey.slice(-4),
      api_secret_last4: apiSecret.slice(-4),
      api_key_cipher: await encryptSecret(apiKey),
      api_secret_cipher: await encryptSecret(apiSecret),
      market_mode: data.marketMode,
      connection_status: test.ok ? "ok" : test.restricted ? "geo_restricted" : "failed",
      geo_restricted: test.restricted,
      last_error_code: test.ok ? null : test.code,
      last_error_message: test.ok ? null : test.message,
      last_tested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Las credenciales son de quien las guarda (una fila por usuario). Con
    // .limit(1) se actualizaba la fila de OTRO usuario: sus claves se
    // pisaban con las del admin y ese usuario acababa operando con ellas.
    const { data: existing } = await db
      .from("binance_credentials")
      .select("id")
      .eq("user_id", context.userId)
      .limit(1);
    if (existing && existing.length > 0 && existing[0]) {
      const { error } = await db
        .from("binance_credentials")
        .update(row)
        .eq("id", existing[0].id as string);
      if (error) throw new Error(error.message);
    } else {
      // Sin cast: el compilador exige el dueño (user_id es NOT NULL).
      const { error } = await db
        .from("binance_credentials")
        .insert({ ...row, user_id: context.userId });
      if (error) throw new Error(error.message);
    }
    await audit(
      "binance.credentials_saved",
      "binance_credentials",
      null,
      { market_mode: data.marketMode, connection_status: row.connection_status },
      context.userId,
    );
    return { ok: true, connection: test };
  });

/* ------------------------------ ESCUADRÓN ----------------------------- */

export const createBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(60),
        strategy: z.string().min(2),
        pair: z.string().min(3).max(20),
        capital: z.number().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    // Siempre demo y pausado: el paso a Real solo existe en promoteBotToReal (admin + 2FA).
    // types.ts aun no incluye bots.user_id: cast.
    const { error } = await db.from("bots").insert({
      name: data.name,
      strategy: data.strategy,
      pair: data.pair.toUpperCase(),
      capital: data.capital,
      status: "paused",
      mode: "demo",
      user_id: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setBotStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        status: z.enum(["running", "paused", "stopped", "training"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { exigirBotPropio } = await import("./ownership.server");
    await exigirBotPropio(context.supabase, data.botId);
    const db = await admin();
    const { error } = await db
      .from("bots")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    await db.from("bot_logs").insert({
      bot_id: data.botId,
      level: "info",
      message: `Estado cambiado a ${data.status}`,
    });
    return { ok: true };
  });

export const updateBotStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        strategy: z.string().min(2),
        pair: z.string().min(3),
        capital: z.number().nonnegative(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { exigirBotPropio } = await import("./ownership.server");
    const bot = await exigirBotPropio(context.supabase, data.botId);
    const db = await admin();
    const { normalizarSimbolo, decidirCambioPar } = await import("./markets.server");
    const parNuevo = normalizarSimbolo(data.pair);
    // Cambiar de par con posición abierta dejaría la posición huérfana (el Cierre
    // de Posición en Pérdida vende en el par del bot): se bloquea el cambio y se
    // muestra el motivo. Si el par no cambia, la edición sigue siendo válida.
    // La comparación usa pares normalizados (BTC/USDT === BTCUSDT).
    const parActual = bot.pair ? normalizarSimbolo(bot.pair) : "";
    if (bot.pair && parActual !== parNuevo) {
      const { botTienePosicionAbierta } = await import("./engine-sessions.server");
      const decision = decidirCambioPar(
        parActual,
        parNuevo,
        await botTienePosicionAbierta(db, { id: data.botId, pair: parActual }),
      );
      if (!decision.valido) throw new Error(decision.motivo ?? "Cambio de par bloqueado");
      // El par se valida contra el entorno activo (testnet o producción) con
      // getBinanceSymbolRules: aquí vale para cualquier pantalla que llame a
      // updateBotStrategy, no solo para Mercados (que lo pre-valida solo como ayuda).
      const { getBinanceSymbolRules, resolveBinanceTradingEnv } =
        await import("./binance-trading.server");
      const env = await resolveBinanceTradingEnv();
      const rules = await getBinanceSymbolRules(parNuevo, env);
      if (rules.fallback) {
        throw new Error(
          `Binance no reconoce ${parNuevo} en ${env}: no existe en el entorno activo`,
        );
      }
    }
    const { error } = await db
      .from("bots")
      .update({
        strategy: data.strategy,
        pair: parNuevo,
        capital: data.capital,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setBotMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        mode: z.literal("demo"),
        confirmed: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!data.confirmed) {
      throw new Error("Se requiere confirmación explícita para cambiar el modo del bot");
    }
    const { exigirBotPropio } = await import("./ownership.server");
    const bot = await exigirBotPropio(context.supabase, data.botId);
    const db = await admin();
    // El paso a Real vive en promoteBotToReal (risk.functions.ts): exige criterios y 2FA.
    const { error } = await db
      .from("bots")
      .update({
        mode: data.mode,
        status: "paused",
        demo_since: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit(
      "bot.mode_changed",
      "bot",
      bot.name ?? data.botId,
      { from: bot.mode ?? "demo", to: data.mode },
      context.userId,
    );
    return { ok: true };
  });

/* --------------------- CAMPO DE ENTRENAMIENTO + IA -------------------- */

export const createSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2),
        dataset: z.string().min(2),
        dateFrom: z.string(),
        dateTo: z.string(),
        pairs: z.array(z.string()).min(1),
        simulatedCapital: z.number().positive(),
        speed: z.number().int().min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    // types.ts aun no incluye training_sandboxes.user_id: cast del objeto completo.
    const { error } = await db.from("training_sandboxes").insert({
      user_id: context.userId,
      name: data.name,
      dataset: data.dataset,
      date_from: data.dateFrom,
      date_to: data.dateTo,
      pairs: data.pairs.map((p) => p.toUpperCase()),
      simulated_capital: data.simulatedCapital,
      speed: data.speed,
      status: "ready",
      ai_sources: [
        { source: "Binance Spot Klines", range: `${data.dateFrom} → ${data.dateTo}` },
        { source: "Binance Futures Funding", range: `${data.dateFrom} → ${data.dateTo}` },
      ] as never,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Simulación acelerada sin fondos reales. La capa de IA normaliza las fuentes
// conectadas y devuelve parámetros sugeridos junto al reporte.
export const runSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sandboxId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { exigirSandboxPropio } = await import("./ownership.server");
    const propio = await exigirSandboxPropio(context.supabase, data.sandboxId);
    const duenoId = propio.user_id ?? null;
    if (!duenoId) throw new Error("El sandbox no tiene dueño asignado");

    const db = await admin();
    const { data: sandbox } = await db
      .from("training_sandboxes")
      .select("*")
      .eq("id", data.sandboxId)
      .single();
    if (!sandbox) throw new Error("Sandbox no encontrado");

    // Solo los bots del dueño del sandbox (antes entraban los de todos).
    const { data: bots } = await db
      .from("bots")
      .select("id, name, pair, capital, stop_loss_pct, take_profit_pct")
      .in("status", ["training", "paused"])
      // types.ts aun no incluye bots.user_id: cast.
      .eq("user_id", duenoId);
    const candidates = (bots ?? []).slice(0, 4);

    // Capa de IA multi-plataforma (módulo independiente): normaliza las fuentes
    // conectadas y el dataset del Escuadrón de Reconocimiento, y ajusta los
    // parámetros en lugar de repetir el histórico.
    const { buildMarketSnapshot, suggestStrategyParams, MARKET_DATA_LAYER_VERSION } =
      await import("@/lib/market-data.server");
    const pairs = (sandbox.pairs as string[]) ?? [];
    const snapshot = await buildMarketSnapshot(db, {
      symbols: pairs,
      from: new Date(sandbox.date_from).toISOString(),
      to: new Date(sandbox.date_to).toISOString(),
      liveIngest: true,
    });
    const usedSources = snapshot.sources.filter((s) => s.points > 0);

    // ── ANTES AQUI SE INVENTABAN LOS NUMEROS (Math.random) ──
    // Ahora se mide de verdad: mismas velas, mismo motor y mismos costes que
    // el backtest del CLI y que el motor en vivo (src/lib/sandbox.server.ts).
    const { evaluarEstrategia } = await import("@/lib/sandbox.server");
    const { buscarEstrategia } = await import("@/lib/strategies/index");
    const { leerConfigSenales } = await import("@/lib/senal-motor.server");

    // Los indicadores de la plataforma (si un bot no tiene los suyos).
    const cfgPlataforma = await leerConfigSenales(db, duenoId);
    const indicadoresPlataforma = cfgPlataforma?.ids ?? ["close_price"];

    // Cuantas velas cubre el rango del sandbox (1 h por vela), con topes.
    const desde = Date.parse(sandbox.date_from);
    const hasta = Date.parse(sandbox.date_to);
    const horas =
      Number.isFinite(desde) && Number.isFinite(hasta)
        ? Math.round((hasta - desde) / 3_600_000)
        : 1000;
    const limiteVelas = Math.min(Math.max(horas > 0 ? horas : 1000, 200), 5000);

    const runs: Array<{
      sandbox_id: string;
      bot_id: string;
      bot_name: string;
      return_pct: number;
      drawdown_pct: number;
      win_rate: number;
      suggested_params: Json;
    }> = [];
    const sinEvaluar: string[] = [];
    let evaluados = 0;
    for (const [i, bot] of candidates.entries()) {
      const simbolo = (bot.pair || pairs[i % Math.max(1, pairs.length)] || "BTCUSDT").toUpperCase();
      const params = suggestStrategyParams(snapshot, simbolo, sandbox.dataset);
      // La config del bot (si tiene): antes se usaba la del primer bot para
      // todos, asi que se media a bots que no eran los que se creian.
      const { data: cfgBot } = await db
        .from("engine_strategies")
        .select("indicator_ids, strategy_id")
        .eq("bot_id", bot.id)
        .limit(1);
      const estrategiaId = (cfgBot?.[0]?.strategy_id as string | undefined) ?? "fixed";
      const idsBot = (cfgBot?.[0]?.indicator_ids as string[] | undefined) ?? [];
      const indicadoresUsados = idsBot.length ? idsBot : indicadoresPlataforma;
      const evaluacion = await evaluarEstrategia({
        simbolo,
        intervalo: "1h",
        limite: limiteVelas,
        // El periodo que eligio el dueno en el sandbox: sin esto se
        // medirian los ultimos minutos, no el rango pedido.
        hasta: hasta || Date.now(),
        capital: Number(bot.capital ?? 1000),
        stopLossPct: Number(bot.stop_loss_pct ?? 2),
        takeProfitPct: Number(bot.take_profit_pct ?? 4),
        estrategiaId,
        indicadores: indicadoresUsados,
      });
      if (evaluacion.sinDatos) {
        // Las columnas de training_runs no admiten null: un bot sin datos NO
        // se guarda (con un 0 pareceria un resultado real). Se explica en las
        // notas del sandbox.
        sinEvaluar.push(`${bot.name} (${evaluacion.motivo ?? "sin datos"})`);
        continue;
      }
      evaluados++;
      runs.push({
        sandbox_id: data.sandboxId,
        bot_id: bot.id,
        bot_name: bot.name,
        return_pct: evaluacion.retornoPct,
        drawdown_pct: evaluacion.drawdownPct,
        win_rate: evaluacion.winRatePct,
        suggested_params: {
          ...params,
          symbol: simbolo,
          layer: MARKET_DATA_LAYER_VERSION,
          backtestReal: {
            desde: evaluacion.desde,
            hasta: evaluacion.hasta,
            velas: evaluacion.velas,
            operaciones: evaluacion.operaciones,
            profitFactor: evaluacion.profitFactor,
            costePct: evaluacion.costePct,
            benchmarkPct: evaluacion.benchmarkPct,
            superaBenchmark: evaluacion.superaBenchmark,
            estrategia: estrategiaId,
            indicadores: indicadoresUsados,
            intervalo: "1h",
            avisos: evaluacion.avisos,
            referencia: evaluacion.referencia,
          },
        },
      });
    }

    await db.from("training_runs").delete().eq("sandbox_id", data.sandboxId);
    if (runs.length) await db.from("training_runs").insert(runs);

    const avg = (key: "return_pct" | "drawdown_pct" | "win_rate") =>
      runs.length
        ? Number((runs.reduce((s, r) => s + Number(r[key] ?? 0), 0) / runs.length).toFixed(2))
        : null;

    const { error } = await db
      .from("training_sandboxes")
      .update({
        status: "completed",
        return_pct: avg("return_pct"),
        drawdown_pct: avg("drawdown_pct"),
        win_rate: avg("win_rate"),
        ai_sources: (usedSources.length
          ? usedSources.map((s) => ({
              source: s.source,
              range: s.range,
              points: s.points,
              status: s.status,
              kind: s.kind,
            }))
          : (sandbox.ai_sources as unknown as unknown[])) as never,
        ai_notes:
          `Backtest REAL con el mismo motor que el motor en vivo: ${evaluados} bot(s) evaluados sobre ` +
          `velas de Binance (1 h), con comisiones (0,1 %/lado), slippage (0,05 %/lado), stop, take-profit ` +
          `y tamaño de la estrategia. ` +
          (sinEvaluar.length
            ? `Sin datos (no se inventa ningun resultado): ${sinEvaluar.join("; ")}. `
            : "") +
          `Capa de IA ${MARKET_DATA_LAYER_VERSION}: ${snapshot.points.length} puntos de ` +
          `${usedSources.length || 0} fuente(s) normalizados al esquema ${snapshot.schema}. ` +
          `Fuentes: ${
            usedSources.map((s) => `${s.source} (${s.range})`).join("; ") || "sin datos nuevos"
          }. ` +
          `Ojo: un resultado en un periodo pasado NO demuestra que vaya a funcionar, y con pocas ` +
          `operaciones es ruido. Mide con walk-forward y contra la referencia aleatoria antes de creerte nada.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sandboxId);
    if (error) throw new Error(error.message);
    return { ok: true, runs: runs.length, evaluados, sinDatos: sinEvaluar.length };
  });

export const promoteRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { exigirRunPropio, exigirBotPropio } = await import("./ownership.server");
    const run = await exigirRunPropio(context.supabase, data.runId);
    // El bot del resultado tambien debe ser visible para quien llama.
    if (run.bot_id) await exigirBotPropio(context.supabase, run.bot_id);
    const db = await admin();
    await db.from("training_runs").update({ promoted: true }).eq("id", data.runId);
    if (run.bot_id) {
      await db
        .from("bots")
        .update({ mode: "demo", status: "paused", updated_at: new Date().toISOString() })
        .eq("id", run.bot_id);
    }
    await audit(
      "bot.promoted_to_demo",
      "bot",
      run.bot_name,
      { source: "training_ground" },
      context.userId,
    );
    return { ok: true };
  });

/* -------------------------------- MINERÍA ----------------------------- */

export const createWorker = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2),
        coin: z.string().min(2),
        pool: z.string().min(2),
        rigId: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    // Capacidad del enjambre: todos los equipos comparten el mismo CPU, asi
    // que mas equipos no dan mas hash rate. El limite es de 6.
    const { CAPACIDAD_ENJAMBRE } = await import("./mineria/modelo");
    const { data: actuales } = await db
      .from("mining_workers")
      .select("id")
      .eq("user_id", context.userId);
    if ((actuales ?? []).length >= CAPACIDAD_ENJAMBRE) {
      throw new Error(
        `El enjambre ya tiene ${CAPACIDAD_ENJAMBRE} equipos (su tope). Todos comparten el mismo CPU: uno mas no daria mas hash rate, solo partiria el mismo.`,
      );
    }
    // types.ts aun no incluye mining_workers.user_id: cast.
    const { error } = await db.from("mining_workers").insert({
      name: data.name,
      coin: data.coin.toUpperCase(),
      pool: data.pool,
      rig_id: data.rigId,
      status: "idle",
      user_id: context.userId,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setWorkerStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        workerId: z.string().uuid().optional(),
        action: z.enum(["start", "stop", "restart"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const status = data.action === "stop" ? "idle" : "mining";
    const patch = { status, updated_at: new Date().toISOString() };
    const query = db.from("mining_workers").update(patch);
    const { error } = data.workerId
      ? await query.eq("id", data.workerId)
      : await query.neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* --------------------- MOTOR DE AUTOMATIZACIÓN 24/7 ------------------- */

export const updateBotRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        automationEnabled: z.boolean(),
        maxDailyLoss: z.number().nonnegative(),
        stopLossPct: z.number().min(0).max(100),
        maxDrawdownPct: z.number().min(0).max(100),
        maxCapital: z.number().nonnegative(),
        maxTradesPerDay: z.number().int().min(0).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { exigirBotPropio } = await import("./ownership.server");
    await exigirBotPropio(context.supabase, data.botId);
    const db = await admin();
    const { error } = await db
      .from("bots")
      .update({
        automation_enabled: data.automationEnabled,
        max_daily_loss: data.maxDailyLoss,
        stop_loss_pct: data.stopLossPct,
        max_drawdown_pct: data.maxDrawdownPct,
        max_capital: data.maxCapital,
        max_trades_per_day: data.maxTradesPerDay,
        auto_stop_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit("risk.limits_updated", "bot", data.botId, { ...data }, context.userId);
    return { ok: true };
  });

export const updateAutomationSettings = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        // engine_enabled ya no se toca aqui: se cambia SOLO desde
        // iniciarMotor/detenerMotor (pestaña Motor). Ver engine.functions.ts.
        killSwitch: z.boolean().optional(),
        allowRealTrading: z.boolean().optional(),
        tickIntervalSeconds: z.number().int().min(30).max(3600).optional(),
        globalMaxDailyLoss: z.number().nonnegative().optional(),
        globalMaxDrawdownPct: z.number().min(0).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    // La configuracion que se cambia es la de la plataforma (fila del
    // administrador): con .limit(1) se tocaba la de otro usuario.
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
    if (!settings) throw new Error("No hay configuración del motor");

    if (data.allowRealTrading === true) {
      // Las credenciales verificadas son las del administrador de la
      // plataforma: si las tiene OTRO usuario, no habilita trading real.
      const creds = plataforma?.adminId
        ? await db
            .from("binance_credentials")
            .select("connection_status")
            .eq("user_id", plataforma.adminId)
        : { data: [] as { connection_status: string }[] };
      if (!(creds.data ?? []).some((c) => c.connection_status === "ok")) {
        throw new Error(
          "Configura y verifica tus API Keys de Binance antes de autorizar trading real",
        );
      }
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.killSwitch !== undefined) patch["kill_switch"] = data.killSwitch;
    if (data.allowRealTrading !== undefined) patch["allow_real_trading"] = data.allowRealTrading;
    if (data.tickIntervalSeconds !== undefined)
      patch["tick_interval_seconds"] = data.tickIntervalSeconds;
    if (data.globalMaxDailyLoss !== undefined)
      patch["global_max_daily_loss"] = data.globalMaxDailyLoss;
    if (data.globalMaxDrawdownPct !== undefined)
      patch["global_max_drawdown_pct"] = data.globalMaxDrawdownPct;
    if (data.killSwitch === true) patch["engine_status"] = "stopped";

    const { error } = await db
      .from("automation_settings")
      .update(patch as never)
      .eq("id", settings.id as string);
    if (error) throw new Error(error.message);

    if (data.killSwitch === true) {
      const { data: bots } = await db.from("bots").select("id").eq("status", "running");
      for (const bot of bots ?? []) {
        await db
          .from("bots")
          .update({ status: "stopped", auto_stop_reason: "kill_switch_manual" })
          .eq("id", bot.id);
        await db.from("bot_logs").insert({
          bot_id: bot.id,
          level: "error",
          message: "Detenido por kill switch global",
        });
      }
    }

    await audit(
      "automation.settings_updated",
      "automation_settings",
      settings.id,
      { ...data },
      context.userId,
    );
    return { ok: true };
  });

// Ejecuta un ciclo manual del mismo motor que corre en el cron 24/7.
export const runEngineNow = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { runEngineTick } = await import("./automation.server");
    return runEngineTick("manual");
  });
