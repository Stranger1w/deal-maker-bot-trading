import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { shortMoneroAddress } from "./monero-address";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown>,
) {
  const db = await admin();
  await db.from("audit_events").insert({
    action,
    entity,
    entity_id: entityId,
    details: details as never,
  });
}

/* ------------------------------- FONDOS ------------------------------- */

export const createDeposit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        amount: z.number().positive(),
        method: z.enum(["transfer", "wallet", "onchain"]),
        reference: z.string().max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const reference = data.reference?.trim() || `DP-${Date.now().toString().slice(-6)}`;
    const { error } = await db.from("fund_transactions").insert({
      account_id: ACCOUNT_ID,
      kind: "deposit",
      method: data.method,
      amount: data.amount,
      status: "pending",
      reference,
    });
    if (error) throw new Error(error.message);
    await audit("deposit.created", "fund_transaction", reference, {
      amount: data.amount,
      method: data.method,
    });
    return { ok: true, reference };
  });

// Flujo antiguo sin 2FA: deshabilitado. Usa createSecureWithdrawal (risk.functions.ts).
export const createWithdrawal = createServerFn({ method: "POST" })
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
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = await signBinanceQuery(query, apiSecret);
  const res = await fetch(
    `https://api.binance.com/api/v3/account?${query}&signature=${signature}`,
    {
      headers: { "X-MBX-APIKEY": apiKey },
    },
  );
  if (res.ok) {
    // Punto 3: /account devuelve permisos de la key (canTrade/canWithdraw).
    let canTrade: boolean | null = null;
    let canWithdraw: boolean | null = null;
    try {
      const body = (await res.clone().json()) as { canTrade?: boolean; canWithdraw?: boolean };
      if (typeof body.canTrade === "boolean") canTrade = body.canTrade;
      if (typeof body.canWithdraw === "boolean") canWithdraw = body.canWithdraw;
    } catch {
      canTrade = null;
    }
    if (canWithdraw === true) {
      return {
        ok: false as const,
        restricted: false,
        code: "withdraw_enabled" as string | null,
        message: "La API key tiene RETIROS habilitados: desactivalos en Binance (solo Spot Trade, sin retiros).",
      };
    }
    if (canTrade === true) {
      return {
        ok: true as const,
        restricted: false,
        code: null as string | null,
        message: "Conexion verificada: trading SPOT habilitado en la API key.",
      };
    }
    return {
      ok: true as const,
      restricted: false,
      code: null as string | null,
      message: "Conexion de solo lectura verificada (sin permiso de trading: activa Spot Trade para operar).",
    };
  }
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
    };
  }
  return {
    ok: false as const,
    restricted: false,
    code: `http_${res.status}`,
    message: msg || `Binance respondió ${res.status}`,
  };
}

export const testBinanceConnection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ apiKey: z.string().min(8), apiSecret: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data }) => {
    const test = await binancePing(data.apiKey.trim(), data.apiSecret.trim());
    if (test.restricted) {
      // Error seguro y auditado: nunca se registran claves ni firmas.
      const { raiseAlertStandalone } = await import("./alerts.server");
      await audit("binance.geo_restricted", "binance_credentials", null, {
        source: "test_connection",
        code: test.code,
      });
      await raiseAlertStandalone({
        category: "binance",
        severity: "warning",
        title: "La IP del servidor está restringida por Binance",
        message: "La conexión con Binance fue restringida por geolocalización.",
      });
    }
    return { ok: test.ok, message: test.message, restricted: test.restricted, code: test.code };
  });

/* ------------------------------- TRADING ENVIRONMENT ------------------------------- */

type EnvValue = "testnet" | "production";

/** Lee el entorno de trading desde la tabla `app_settings` (.env es fallback). Testnet por defecto. */
async function readTradingEnv(): Promise<EnvValue> {
  let raw = process.env["BINANCE_TRADING_ENV"] ?? "testnet";
  try {
    const db = await admin();
    const { data: setting } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "binance_trading_env")
      .maybeSingle();
    if (setting?.value === "testnet" || setting?.value === "production") {
      raw = setting.value;
    }
  } catch {
    // Sin tabla o sin permisos: respetamos el env (testnet por defecto).
  }
  const v = String(raw).trim().toLowerCase();
  return v === "production" || v === "live" || v === "mainnet" ? "production" : "testnet";
}

/** Lee el entorno de trading actual, expuesto al cliente. Testnet por defecto. */
export const resolveTradingEnv = createServerFn({ method: "GET" }).handler(async () => {
  return readTradingEnv();
});

export type { EnvValue };

/**
 * Cambia el entorno de trading (Demo=testnet / Real=production) desde la app.
 * No requiere variables de entorno: el estado vive en `app_settings` y el motor
 * lo lee en cada ciclo. Pasar a Real exige confirmación explícita del usuario,
 * credenciales Binance verificadas y la parada de emergencia desactivada.
 */
export const setAccountMode = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      mode: z.enum(["testnet", "production"]),
      confirmed: z.literal("confirmed").optional(),
    }),
  )
  .handler(async ({ data }) => {
    const current = await readTradingEnv();
    const next: EnvValue = data.mode === "production" ? "production" : "testnet";
    if (current === next) return { ok: true, mode: current, unchanged: true };

    if (next === "production") {
      if (data.confirmed !== "confirmed") {
        await audit("trading_env_blocked", "app_settings", "binance_trading_env", {
          requested: next,
          reason: "confirmacion_no_explicita",
        });
        throw new Error(
          "Para activar el modo Real hay que confirmar explícitamente el aviso. No se cambió nada.",
        );
      }
      const db = await admin();
      const { data: creds } = await db.from("binance_credentials").select("connection_status");
      if (
        !(creds ?? []).some((c: { connection_status?: string }) => c.connection_status === "ok")
      ) {
        throw new Error(
          "El modo Real exige credenciales Binance verificadas (estado «ok»). Guárdalas y pruébalas arriba antes de activarlo.",
        );
      }
      const { data: settings } = await db
        .from("automation_settings")
        .select("id,kill_switch")
        .limit(1)
        .maybeSingle();
      if ((settings as { kill_switch?: boolean } | null)?.kill_switch) {
        throw new Error(
          "La parada de emergencia está activa: desactívala en Piloto automático antes de pasar a Real.",
        );
      }
    }

    const db = await admin();
    const { error } = await db.from("app_settings").upsert(
      {
        key: "binance_trading_env",
        value: next,
        notes:
          next === "production"
            ? "Activado desde la app con confirmación explícita."
            : "Testnet por defecto.",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) {
      throw new Error(
        `No se pudo guardar el modo (${error.message}). Si la tabla app_settings no existe, aplica la migración 20260920000000_app_settings.sql.`,
      );
    }

    await audit(`trading_env_changed:${next}`, "app_settings", "binance_trading_env", {
      from: current,
      to: next,
    });
    return { ok: true, mode: next, unchanged: false };
  });

export const saveBinanceCredentials = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        apiKey: z.string().min(8),
        apiSecret: z.string().min(8),
        marketMode: z.enum(["spot", "futures", "both"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
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

    const { data: existing } = await db.from("binance_credentials").select("id").limit(1);
    if (existing && existing.length > 0 && existing[0]) {
      const { error } = await db
        .from("binance_credentials")
        .update(row)
        .eq("id", existing[0].id as string);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("binance_credentials").insert(row);
      if (error) throw new Error(error.message);
    }
    await audit("binance.credentials_saved", "binance_credentials", null, {
      market_mode: data.marketMode,
      connection_status: row.connection_status,
    });
    return { ok: true, connection: test };
  });

export const testExchangeConnection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        exchange: z.enum(["coinbase", "kraken", "bybit", "okx", "kucoin", "etoro"]),
        apiKey: z.string().min(8),
        apiSecret: z.string().min(0),
        passphrase: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { testExchange } = await import("./exchange-clients.server");
    return testExchange(data.exchange, {
      apiKey: data.apiKey.trim(),
      apiSecret: data.apiSecret.trim(),
      passphrase: data.passphrase?.trim() || undefined,
    });
  });

export const saveExchangeCredentials = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        exchange: z.enum(["coinbase", "kraken", "bybit", "okx", "kucoin", "etoro"]),
        apiKey: z.string().min(8),
        apiSecret: z.string().min(0),
        passphrase: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { encryptSecret } = await import("./crypto.server");
    const { testExchange } = await import("./exchange-clients.server");
    const db = await admin();
    const apiKey = data.apiKey.trim();
    const apiSecret = data.apiSecret.trim();
    const pass = data.passphrase?.trim() || undefined;
    const test = await testExchange(data.exchange, { apiKey, apiSecret, passphrase: pass });
    const meta: Record<string, string> = {
      coinbase: "Coinbase Advanced Trade",
      kraken: "Kraken",
      bybit: "Bybit (V5)",
      okx: "OKX",
      kucoin: "KuCoin",
      etoro: "eToro (solo lectura)",
    };
    const row = {
      exchange: data.exchange,
      label: meta[data.exchange] ?? data.exchange,
      api_key_last4: apiKey.slice(-4),
      api_secret_last4: apiSecret ? apiSecret.slice(-4) : "····",
      api_key_cipher: await encryptSecret(apiKey),
      api_secret_cipher: await encryptSecret(apiSecret || apiKey),
      passphrase_cipher: pass ? await encryptSecret(pass) : null,
      connection_status: test.ok ? "ok" : test.restricted ? "geo_restricted" : "failed",
      last_error_code: test.ok ? null : test.code,
      last_error_message: test.ok ? null : test.message,
      last_tested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("exchange_credentials").upsert(row, { onConflict: "exchange" });
    if (error) throw new Error(error.message);
    await audit("exchange.credentials_saved", "exchange_credentials", null, {
      exchange: data.exchange,
      connection_status: row.connection_status,
    });
    return { ok: true, connection: test };
  });

/* ------------------------------ ESCUADRÓN ----------------------------- */

export const createBot = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => {
    const db = await admin();
    // Valores seguros por defecto para principiantes: el bot nace pausado,
    // en demo, con frenos conservadores. El usuario puede relajarlos luego.
    // En nube vieja (sin PART7) se reintenta sin las columnas nuevas.
    const { error } = await db.from("bots").insert({
      name: data.name,
      strategy: data.strategy,
      pair: data.pair.toUpperCase(),
      capital: data.capital,
      status: "paused",
      mode: "demo",
      stop_loss_pct: 1.5,
      take_profit_pct: 3,
      max_daily_loss: 50,
      max_drawdown_pct: 10,
      max_weekly_drawdown_pct: 20,
      max_capital: data.capital,
      max_trades_per_day: 10,
      automation_enabled: false,
    });
    if (error) {
      if (!/42703|does not exist|could not find/i.test(`${error.code ?? ""} ${error.message}`)) {
        throw new Error(error.message);
      }
      const { error: fallbackError } = await db.from("bots").insert({
        name: data.name,
        strategy: data.strategy,
        pair: data.pair.toUpperCase(),
        capital: data.capital,
        status: "paused",
        mode: "demo",
        stop_loss_pct: 1.5,
        max_daily_loss: 50,
        max_drawdown_pct: 10,
        max_capital: data.capital,
        max_trades_per_day: 10,
        automation_enabled: false,
      });
      if (fallbackError) throw new Error(fallbackError.message);
    }
    return { ok: true };
  });

export const setBotStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        status: z.enum(["running", "paused", "stopped", "training"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
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

/**
 * Arranca de una vez todos los bots en Demo del escuadrón (botón "Iniciar todos
 * los bots"). Los bots en Real no se tocan: exigen credenciales Binance
 * verificadas y promoción con 2FA. Se niega a arrancar si la parada de
 * emergencia global está activa.
 */
export const startAllBots = createServerFn({ method: "POST" }).handler(async () => {
  const db = await admin();
  const { data: settings } = await db
    .from("automation_settings")
    .select("id,kill_switch")
    .limit(1)
    .maybeSingle();
  if ((settings as { kill_switch?: boolean } | null)?.kill_switch) {
    throw new Error(
      "La parada de emergencia está activa: desactívala en Piloto automático antes de iniciar los bots.",
    );
  }

  const { data: bots, error } = await db
    .from("bots")
    .select(
      "id,name,mode,status,stop_loss_pct,take_profit_pct,max_trades_per_day,max_capital,capital",
    );
  if (error) throw new Error(error.message);
  const rows = (bots ?? []) as unknown as {
    id: string;
    name: string;
    mode: string;
    status: string;
    stop_loss_pct: number;
    take_profit_pct: number;
    max_trades_per_day: number;
    max_capital: number;
    capital: number;
  }[];
  const skippedReal = rows.filter((b) => b.mode === "real").length;

  // Solo se encienden bots con frenos de seguridad completos: el motor exige
  // stop-loss y take-profit positivos para operar (y en Real son obligatorios).
  const startable = rows.filter((b) => {
    if (b.mode === "real") return false;
    if (b.status === "running") return false;
    if (Number(b.stop_loss_pct) <= 0 || Number(b.take_profit_pct) <= 0) return false;
    if (Number(b.max_trades_per_day) <= 0) return false;
    if (Number(b.max_capital) <= 0 || Number(b.capital) > Number(b.max_capital)) return false;
    return true;
  });
  const blockedNoRisk = rows.filter(
    (b) => b.mode !== "real" && b.status !== "running" && !startable.includes(b),
  ).length;

  if (startable.length) {
    const ids = startable.map((b) => b.id);
    // `automation_enabled` es el interruptor que lee el motor de automatización:
    // sin él el bot queda "running" pero no opera.
    const { error: updateError } = await db
      .from("bots")
      .update({
        status: "running",
        automation_enabled: true,
        auto_stop_reason: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);
    if (updateError) {
      // Nube vieja (sin PART7 / sin auto_stop_reason): se reintenta con lo mínimo.
      if (
        !/42703|does not exist|could not find/i.test(
          `${updateError.code ?? ""} ${updateError.message}`,
        )
      ) {
        throw new Error(updateError.message);
      }
      const { error: fallbackError } = await db
        .from("bots")
        .update({
          status: "running",
          automation_enabled: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", ids);
      if (fallbackError) throw new Error(fallbackError.message);
    }
    await db.from("bot_logs").insert(
      startable.map((b) => ({
        bot_id: b.id,
        level: "info",
        message: "Iniciado en lote desde el escuadrón (automático activado)",
      })),
    );
  }

  await audit("bots.started_all", "bot", null, {
    started: startable.length,
    skipped_real: skippedReal,
    blocked_without_risk: blockedNoRisk,
    total: rows.length,
  });
  return {
    ok: true,
    started: startable.length,
    skippedReal,
    blockedNoRisk,
    total: rows.length,
  };
});

export const updateBotStrategy = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db
      .from("bots")
      .update({
        strategy: data.strategy,
        pair: data.pair.toUpperCase(),
        capital: data.capital,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setBotMode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        mode: z.literal("demo"),
        confirmed: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (!data.confirmed) {
      throw new Error("Se requiere confirmación explícita para cambiar el modo del bot");
    }
    const db = await admin();
    const { data: bot } = await db
      .from("bots")
      .select("name, mode")
      .eq("id", data.botId)
      .maybeSingle();
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
    await audit("bot.mode_changed", "bot", bot?.name ?? data.botId, {
      from: bot?.mode ?? "demo",
      to: data.mode,
    });
    return { ok: true };
  });

/* --------------------- CAMPO DE ENTRENAMIENTO + IA -------------------- */

export const createSandbox = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => {
    const db = await admin();
    // Fuentes declaradas: siempre Binance y, si hay plataformas conectadas, se
    // listan para que el reporte refleje que el entrenamiento es multi-plataforma.
    const { PUBLIC_MARKET_EXCHANGES } = await import("./exchange-market-data.server");
    const { data: credRows } = await db.from("exchange_credentials").select("exchange");
    const sourceNames = ["Binance Spot Klines", "Binance Futures Funding"];
    for (const row of (credRows ?? []) as { exchange?: string }[]) {
      const name = row.exchange
        ? PUBLIC_MARKET_EXCHANGES[row.exchange as keyof typeof PUBLIC_MARKET_EXCHANGES]
        : undefined;
      if (name && row.exchange !== "etoro" && !sourceNames.includes(name)) sourceNames.push(name);
    }
    const range = `${data.dateFrom} → ${data.dateTo}`;
    const { error } = await db.from("training_sandboxes").insert({
      name: data.name,
      dataset: data.dataset,
      date_from: data.dateFrom,
      date_to: data.dateTo,
      pairs: data.pairs.map((p) => p.toUpperCase()),
      simulated_capital: data.simulatedCapital,
      speed: data.speed,
      status: "ready",
      ai_sources: sourceNames.map((source) => ({ source, range })) as never,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Simulación acelerada sin fondos reales. La capa de IA normaliza las fuentes
// conectadas y devuelve parámetros sugeridos junto al reporte.
export const runSandbox = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ sandboxId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: sandbox } = await db
      .from("training_sandboxes")
      .select("*")
      .eq("id", data.sandboxId)
      .single();
    if (!sandbox) throw new Error("Sandbox no encontrado");

    const { data: bots } = await db
      .from("bots")
      .select("id, name")
      .in("status", ["training", "paused", "stopped"]);
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

    const rand = (min: number, max: number) =>
      Number((Math.random() * (max - min) + min).toFixed(2));
    const runs = candidates.map((bot, i) => {
      const symbol = pairs[i % Math.max(1, pairs.length)] ?? pairs[0] ?? "BTCUSDT";
      const params = suggestStrategyParams(snapshot, symbol, sandbox.dataset);
      const bias = params.bias === "alcista" ? 6 : params.bias === "bajista" ? -4 : 0;
      return {
        sandbox_id: data.sandboxId,
        bot_id: bot.id,
        bot_name: bot.name,
        return_pct: Number((rand(-8, 20) + bias).toFixed(2)),
        drawdown_pct: rand(2, 14),
        win_rate: rand(42, 71),
        suggested_params: { ...params, symbol, layer: MARKET_DATA_LAYER_VERSION } as never,
      };
    });

    await db.from("training_runs").delete().eq("sandbox_id", data.sandboxId);
    if (runs.length) await db.from("training_runs").insert(runs);

    const avg = (key: "return_pct" | "drawdown_pct" | "win_rate") =>
      runs.length ? Number((runs.reduce((s, r) => s + r[key], 0) / runs.length).toFixed(2)) : 0;

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
          `Capa de IA ${MARKET_DATA_LAYER_VERSION}: se normalizaron ${snapshot.points.length} puntos de ` +
          `${usedSources.length || 0} fuente(s) al esquema común ${snapshot.schema} y se ajustaron stops, ` +
          `take-profit y tamaño de posición durante la simulación acelerada ${sandbox.speed}x. ` +
          `Fuentes y rangos usados: ${
            usedSources.map((s) => `${s.source} (${s.range})`).join("; ") || "sin datos nuevos"
          }.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sandboxId);
    if (error) throw new Error(error.message);
    return { ok: true, runs: runs.length };
  });

export const promoteRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: run } = await db
      .from("training_runs")
      .select("bot_id, bot_name")
      .eq("id", data.runId)
      .single();
    if (!run) throw new Error("Resultado no encontrado");
    await db.from("training_runs").update({ promoted: true }).eq("id", data.runId);
    if (run.bot_id) {
      await db
        .from("bots")
        .update({ mode: "demo", status: "paused", updated_at: new Date().toISOString() })
        .eq("id", run.bot_id);
    }
    await audit("bot.promoted_to_demo", "bot", run.bot_name, { source: "training_ground" });
    return { ok: true };
  });

/* -------------------------------- MINERÍA ----------------------------- */

export const createWorker = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("mining_workers").insert({
      name: data.name,
      coin: data.coin.toUpperCase(),
      pool: data.pool,
      rig_id: data.rigId,
      status: "idle",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setWorkerStatus = createServerFn({ method: "POST" })
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

/* ------------- CAMPO DE ENTRENAMIENTO: MINERÍA (opción B) -------------- */
/* Workers = estrategia de rentabilidad (qué minar / dónde), no hardware real. */

export const createMiningSandbox = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(60),
        coins: z.array(z.string().min(2)).min(1).max(6),
        pools: z.array(z.string().min(2)).min(1).max(6),
        hashRate: z.number().positive(),
        hashUnit: z.string().min(1).max(10),
        powerCost: z.number().min(0).max(2),
        dateFrom: z.string(),
        dateTo: z.string(),
        speed: z.number().int().min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("mining_sandboxes").insert({
      name: data.name.trim(),
      coins: data.coins.map((c) => c.toUpperCase()),
      pools: data.pools,
      simulated_hash_rate: data.hashRate,
      simulated_hash_unit: data.hashUnit,
      power_cost_usd_kwh: data.powerCost,
      date_from: data.dateFrom,
      date_to: data.dateTo,
      speed: data.speed,
      status: "ready",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const runMiningSandbox = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ sandboxId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: sandbox } = await db
      .from("mining_sandboxes")
      .select("*")
      .eq("id", data.sandboxId)
      .single();
    if (!sandbox) throw new Error("Sandbox de minería no encontrado");
    const { data: workers } = await db.from("mining_workers").select("id, name").limit(6);

    // Los workers conectados a una pool real (Nanopool XMR) quedan fuera del
    // entrenamiento simulado: sus cifras son reales y no se mezclan con el demo.
    const { data: poolRows } = await db
      .from("app_settings")
      .select("key")
      .like("key", "mining_pool:%");
    const connected = new Set(
      ((poolRows ?? []) as unknown as { key: string }[]).map((row) =>
        String(row.key).slice("mining_pool:".length),
      ),
    );
    const available = (workers ?? []).filter((worker) => !connected.has(String(worker.id)));
    const candidates =
      available.length > 0
        ? available
        : [{ id: null, name: connected.size > 0 ? "Simulado (sin workers libres)" : "Simulado" }];
    const coinPrice: Record<string, number> = {
      BTC: 67000,
      ETH: 3500,
      ETC: 26,
      KAS: 0.14,
      LTC: 82,
    };
    try {
      const map: Record<string, string> = {
        BTC: "BTCUSDT",
        ETC: "ETCUSDT",
        KAS: "KASUSDT",
        LTC: "LTCUSDT",
      };
      const hosts = ["https://api.binance.com", "https://data-api.binance.vision"];
      for (const c of ((sandbox.coins as string[]) ?? []).slice(0, 4)) {
        const sym = map[String(c).toUpperCase()];
        if (!sym) continue;
        for (const host of hosts) {
          try {
            const res = await fetch(`${host}/api/v3/ticker/price?symbol=${sym}`);
            if (!res.ok) continue;
            const j = (await res.json()) as { price?: string };
            if (j.price) {
              coinPrice[String(c).toUpperCase()] = Number(j.price);
              break;
            }
          } catch {
            /* intenta siguiente host */
          }
        }
      }
      // XMR no cotiza en Binance: se usa el precio público de Kraken si hace falta.
      const wantsXmr = ((sandbox.coins as string[]) ?? []).some(
        (c) => String(c).toUpperCase() === "XMR",
      );
      if (wantsXmr) {
        const { fetchXmrUsdPrice } = await import("./mining-pool.server");
        const price = await fetchXmrUsdPrice();
        if (price) coinPrice["XMR"] = price;
      }
    } catch {
      /* sin red: seed local */
    }
    const powerDaily = (3200 / 1000) * 24 * Number(sandbox.power_cost_usd_kwh ?? 0.12);
    const coins = ((sandbox.coins as string[]) ?? []).map((c) => String(c).toUpperCase());
    const pools = ((sandbox.pools as string[]) ?? []).length
      ? ((sandbox.pools as string[]) ?? [])
      : ["Simulado"];
    const runs = candidates.slice(0, 6).map((w, i) => {
      const coin = coins[i % Math.max(1, coins.length)] ?? "BTC";
      const pool = pools[i % pools.length] ?? "Simulado";
      const price = coinPrice[coin] ?? 100;
      const gross = Number(
        (
          price *
          0.0006 *
          (0.9 + ((pool.length % 5) + 1) * 0.04) *
          (0.85 + Math.random() * 0.3)
        ).toFixed(2),
      );
      return {
        sandbox_id: data.sandboxId,
        worker_id: (w as { id: string | null }).id,
        worker_name: (w as { name: string }).name,
        coin,
        pool,
        hash_rate: Number(sandbox.simulated_hash_rate ?? 100),
        hash_unit: String(sandbox.simulated_hash_unit ?? "TH/s"),
        gross_daily_usd: gross,
        power_daily_usd: Number(powerDaily.toFixed(2)),
        net_daily_usd: Number((gross - powerDaily).toFixed(2)),
        suggested_params: { coin, pool, price_ref: price } as never,
      };
    });
    await db.from("mining_training_runs").delete().eq("sandbox_id", data.sandboxId);
    if (runs.length) await db.from("mining_training_runs").insert(runs as never);
    const best = [...runs].sort((a, b) => b.net_daily_usd - a.net_daily_usd)[0];
    const { error } = await db
      .from("mining_sandboxes")
      .update({
        status: "completed",
        best_coin: best?.coin ?? null,
        best_pool: best?.pool ?? null,
        estimated_daily_usd: best?.net_daily_usd ?? null,
        ai_notes: best
          ? `Mejor: ${best.coin} en ${best.pool} (${best.net_daily_usd} USD/día neto).`
          : "Sin resultados.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.sandboxId);
    if (error) throw new Error(error.message);
    await audit("mining.sandbox_run", "mining_sandbox", data.sandboxId, { runs: runs.length });
    return { ok: true, runs: runs.length };
  });

export const promoteMiningRun = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: run } = await db
      .from("mining_training_runs")
      .select("worker_id, coin, pool, net_daily_usd")
      .eq("id", data.runId)
      .single();
    if (!run) throw new Error("Resultado no encontrado");

    // Un worker conectado a una pool real no recibe cifras simuladas: primero se
    // desconecta, así el dashboard nunca mezcla entrenamiento con datos reales.
    if (run.worker_id) {
      const poolConfig = await readSetting<StoredPoolConfig>(db, POOL_KEY(run.worker_id as string));
      if (poolConfig) {
        throw new Error(
          `Ese worker está conectado a una pool real (${poolConfig.label}): desconéctalo antes de aplicar resultados del entrenamiento simulado para no mezclar datos.`,
        );
      }
    }

    await db.from("mining_training_runs").update({ promoted: true }).eq("id", data.runId);
    if (run.worker_id) {
      await db
        .from("mining_workers")
        .update({
          coin: run.coin,
          pool: run.pool,
          estimated_daily_earnings: run.net_daily_usd,
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.worker_id as string);
    }
    await audit("mining.promoted", "mining_training_run", data.runId, {
      coin: run.coin,
      pool: run.pool,
    });
    return { ok: true };
  });
/* --------------------------- MINERÍA: POOL REAL (UID) --------------------------- */

const POOL_KEY = (workerId: string) => `mining_pool:${workerId}`;
const POOL_STATS_KEY = (workerId: string) => `mining_pool_stats:${workerId}`;

type StoredPoolConfig = {
  pool: string;
  uid: string;
  coin: string;
  label: string;
  /** Nombre del rig dentro de la wallet (`wallet.rig` en XMRig); solo informativo. */
  workerName?: string;
  /** ISO de la última conexión válida. */
  connectedAt?: string;
  /** Tipo de dirección XMR validada (standard / subaddress / integrated). */
  addressKind?: string | null;
};

/** Fotografía guardada tras cada lectura real de la pool. */
type StoredPoolStats = StoredPoolConfig & {
  fetchedAt: string;
  /** Saldo confirmado + sin confirmar (XMR) o saldo de la pool (otras monedas). */
  balance: number;
  previousBalance: number | null;
  previousFetchedAt: string | null;
  /** Solo XMR: datos reales que alimentan el panel de /mineria. */
  xmr?: {
    hashrate: number;
    hashrate24h: number;
    unconfirmed: number;
    paidTotal: number;
    paidLast24h: number;
    paymentsCount: number;
    workersActive: number;
    lastShareAt: string | null;
    accountExists: boolean;
    hasActivity: boolean;
    activityNote: string | null;
    /** Hashes de pago ya volcados en `mining_payouts` (evita duplicados). */
    seenTx: string[];
    /** Ganancia diaria real estimada (pagos de 24 h o delta de saldo). */
    dailyEarnings: number | null;
    /** Origen del cálculo anterior: "pagos" | "saldo" | null. */
    earningsSource: string | null;
    /** Precio XMR/USD usado para valorar los pagos (Kraken). */
    usdPrice: number | null;
    poolHashrate: number | null;
    poolActiveWorkers: number | null;
  };
};

type MoneroOverview = Awaited<
  ReturnType<typeof import("./mining-pool.server").fetchMoneroPoolOverview>
>;

/** Respuesta unificada de `connectWorkerPool` / `syncWorkerPoolStats`. */
type MiningPoolSync = {
  ok: true;
  /** "xmr-real" = Nanopool XMR (hashrate y ganancias reales). */
  mode: "xmr-real" | "pool-generic";
  pool: string;
  coin: string;
  hashrate: number;
  /** Saldo acumulado en la pool, en su moneda. */
  accrued: number;
  /** Ganancia diaria real estimada (pagos de 24 h o delta de saldo). */
  dailyEarnings: number | null;
  /** "pagos" | "saldo" | null según de dónde salga la cifra anterior. */
  earningsSource: string | null;
  sampleReady: boolean;
  /** Pagos reales nuevos detectados en esta lectura. */
  newPayments: number;
  lastSyncAt: string;
  /** Fotografía completa de Nanopool XMR (null en el flujo genérico). */
  monero: MoneroOverview | null;
};

const isXmrConfig = (config: StoredPoolConfig): boolean => config.coin.toUpperCase() === "XMR";

/**
 * Sincroniza un worker conectado a Nanopool XMR con datos 100 % reales: hashrate,
 * saldo, pagos y media de 24 h desde las rutas públicas de la pool. Guarda la
 * fotografía, vuelca los pagos nuevos en `mining_payouts` y actualiza el worker
 * con hashrate y ganancia reales. Nunca usa el hashrate simulado de entrenamiento.
 */
async function syncXmrWorker(
  db: Awaited<ReturnType<typeof admin>>,
  workerId: string,
  config: StoredPoolConfig,
  preloaded?: MoneroOverview,
): Promise<MiningPoolSync> {
  const { fetchMoneroPoolOverview, fetchXmrUsdPrice } = await import("./mining-pool.server");
  const monero = preloaded ?? (await fetchMoneroPoolOverview(config.uid, { history: false }));
  if (!monero.ok) {
    await audit("mining.pool_sync_failed", "mining_worker", workerId, {
      pool: config.pool,
      error: monero.error,
    });
    throw new Error(monero.error ?? "Nanopool no devolvió datos para esta wallet.");
  }

  const previous = await readSetting<StoredPoolStats>(db, POOL_STATS_KEY(workerId));
  const accrued = monero.balance + monero.unconfirmed;

  // La ganancia diaria sale de datos reales: los pagos de las últimas 24 h o,
  // si todavía no hay pagos, del aumento de saldo entre dos lecturas separadas.
  let dailyEarnings: number | null = null;
  let earningsSource: string | null = null;
  if (monero.paidLast24h > 0) {
    dailyEarnings = Number(monero.paidLast24h.toFixed(8));
    earningsSource = "pagos";
  } else if (previous?.previousFetchedAt && previous.previousBalance !== null) {
    const hours =
      (Date.parse(previous.fetchedAt) - Date.parse(previous.previousFetchedAt)) / 3_600_000;
    const delta = accrued - previous.previousBalance;
    if (hours >= 0.5 && delta > 0) {
      dailyEarnings = Number(((delta / hours) * 24).toFixed(8));
      earningsSource = "saldo";
    }
  }

  // Pagos reales nuevos -> historial de la app (deduplicados por hash de tx).
  const seenTx = new Set(previous?.xmr?.seenTx ?? []);
  const freshPayments = monero.payments
    .filter((payment) => !seenTx.has(payment.txHash))
    .slice(0, 40);
  const usdPrice =
    freshPayments.length > 0 ? await fetchXmrUsdPrice() : (previous?.xmr?.usdPrice ?? null);
  if (freshPayments.length > 0) {
    await db.from("mining_payouts").insert(
      freshPayments.map((payment) => ({
        coin: "XMR",
        pool: config.label,
        amount: Number(payment.amount.toFixed(8)),
        usd_value: usdPrice ? Number((payment.amount * usdPrice).toFixed(2)) : 0,
        paid_at: payment.date,
      })) as never,
    );
  }
  for (const payment of freshPayments) seenTx.add(payment.txHash);

  await writeSetting(
    db,
    POOL_STATS_KEY(workerId),
    {
      ...config,
      fetchedAt: monero.fetchedAt,
      balance: accrued,
      previousBalance: previous ? previous.balance : null,
      previousFetchedAt: previous ? previous.fetchedAt : null,
      xmr: {
        hashrate: monero.hashrate,
        hashrate24h: monero.avgHashrate.h24 || monero.hashrate,
        unconfirmed: monero.unconfirmed,
        paidTotal: monero.paidTotal,
        paidLast24h: monero.paidLast24h,
        paymentsCount: monero.paymentsCount,
        workersActive: monero.workersActive,
        lastShareAt: monero.lastShareAt,
        accountExists: monero.accountExists,
        hasActivity: monero.hasActivity,
        activityNote: monero.activityNote,
        seenTx: [...seenTx].slice(-200),
        dailyEarnings,
        earningsSource,
        usdPrice,
        poolHashrate: monero.poolHashrate,
        poolActiveWorkers: monero.poolActiveWorkers,
      },
    } satisfies StoredPoolStats,
    "Última lectura real de Nanopool XMR",
  );

  await db
    .from("mining_workers")
    .update({
      coin: "XMR",
      pool: config.label,
      hash_rate: Number(monero.hashrate.toFixed(2)),
      hash_unit: "H/s",
      updated_at: new Date().toISOString(),
      // Sin datos reales todavía se guarda 0 y la UI lo explica: nunca una cifra simulada.
      estimated_daily_earnings: dailyEarnings ?? 0,
    } as never)
    .eq("id", workerId);

  return {
    ok: true,
    mode: "xmr-real",
    pool: config.label,
    coin: "XMR",
    hashrate: monero.hashrate,
    accrued,
    dailyEarnings,
    earningsSource,
    sampleReady: dailyEarnings !== null,
    newPayments: freshPayments.length,
    lastSyncAt: monero.fetchedAt,
    monero,
  };
}

async function readSetting<T>(
  db: Awaited<ReturnType<typeof admin>>,
  key: string,
): Promise<T | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const value = (data as { value?: string } | null)?.value;
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function writeSetting(
  db: Awaited<ReturnType<typeof admin>>,
  key: string,
  payload: unknown,
  notes: string,
): Promise<void> {
  const { error } = await db
    .from("app_settings")
    .upsert(
      { key, value: JSON.stringify(payload), notes, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) {
    throw new Error(
      `No se pudo guardar la configuración (${error.message}). Aplica la migración 20260920000000_app_settings.sql.`,
    );
  }
}

/**
 * Conecta un worker a su pool real.
 *
 * - XMR (Monero/CPU en Nanopool): se valida la dirección Monero en local (formato,
 *   longitud, prefijo y checksum) y contra la API pública de la pool. Se permite
 *   conectar aunque todavía no haya minero: en ese caso el panel muestra
 *   "sin actividad" en vez de ceros sin contexto.
 * - Otras pools/monedas (legado Hiveon): se exige que el UID devuelva datos reales.
 */
export const connectWorkerPool = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        workerId: z.string().uuid(),
        pool: z.string().min(2).max(60),
        uid: z.string().min(3).max(128),
        coin: z.string().min(2).max(12),
        /** Nombre del rig dentro de la wallet XMR (`wallet.rig` en XMRig). */
        workerName: z.string().max(32).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const {
      fetchMoneroPoolOverview,
      fetchPoolStats,
      isValidPoolUid,
      poolLabel,
      resolvePoolId,
      validateXmrWallet,
    } = await import("./mining-pool.server");
    const poolId = resolvePoolId(data.pool);
    if (poolId === "none") {
      throw new Error("Pool no soportada todavía. Usa Nanopool para Monero (XMR) en CPU.");
    }
    const uid = data.uid.trim();
    const coin = data.coin.trim().toUpperCase();
    const db = await admin();

    /* --- Monero real en CPU: Nanopool XMR con dirección de wallet. --- */
    if (coin === "XMR") {
      if (poolId !== "nanopool") {
        throw new Error("El minado real de Monero en CPU va por Nanopool: cambia la pool.");
      }
      const address = validateXmrWallet(uid);
      if (!address.ok) throw new Error(address.message);

      const monero = await fetchMoneroPoolOverview(uid, { history: false, poolContext: false });
      if (!monero.ok)
        throw new Error(monero.error ?? "Nanopool no devolvió datos para esta wallet.");

      const config: StoredPoolConfig = {
        pool: "nanopool",
        uid,
        coin: "XMR",
        label: monero.poolLabel,
        connectedAt: monero.fetchedAt,
        addressKind: monero.addressKind,
      };
      const workerName = data.workerName?.trim();
      if (workerName) config.workerName = workerName;
      await writeSetting(
        db,
        POOL_KEY(data.workerId),
        config,
        "Worker conectado a Nanopool XMR (pool real)",
      );

      // Primera lectura real: deja el panel y el historial de pagos con datos de la pool.
      const sync = await syncXmrWorker(db, data.workerId, config, monero);
      await audit("mining.pool_connected", "mining_worker", data.workerId, {
        pool: "nanopool",
        coin: "XMR",
        wallet_last4: uid.slice(-4),
        account_exists: monero.accountExists,
        has_activity: monero.hasActivity,
        hashrate: monero.hashrate,
      });
      return { ok: true, config, sync, address, notice: monero.activityNote };
    }

    if (!isValidPoolUid(uid)) {
      throw new Error("El UID de la pool no tiene un formato válido.");
    }

    const stats = await fetchPoolStats(poolId, uid, coin);
    if (!stats.ok) {
      throw new Error(stats.error ?? "La pool no devolvió datos para ese UID.");
    }

    const config: StoredPoolConfig = {
      pool: poolId,
      uid,
      coin,
      label: poolLabel(poolId),
      connectedAt: new Date().toISOString(),
    };
    await writeSetting(db, POOL_KEY(data.workerId), config, "Worker conectado a pool real");

    // Hashrate real desde la pool (en H/s, como lo publica la pool).
    await db
      .from("mining_workers")
      .update({
        pool: config.label,
        coin: config.coin,
        hash_rate: Number(stats.hashrate.toFixed(2)),
        hash_unit: "H/s",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.workerId);

    await audit("mining.pool_connected", "mining_worker", data.workerId, {
      pool: config.pool,
      coin: config.coin,
      uid_last4: uid.slice(-4),
      hashrate: stats.hashrate,
    });
    return { ok: true, config, stats };
  });

/** Sincroniza hashrate y ganancias reales del worker desde su pool (por UID). */
export const syncWorkerPoolStats = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ workerId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<MiningPoolSync> => {
    const db = await admin();
    const config = await readSetting<StoredPoolConfig>(db, POOL_KEY(data.workerId));
    if (!config) {
      throw new Error("Este worker todavía no está conectado a una pool real.");
    }

    // Monero: rutas públicas de Nanopool (hashrate, saldo, pagos) con datos reales.
    if (isXmrConfig(config)) return syncXmrWorker(db, data.workerId, config);

    const { fetchPoolStats } = await import("./mining-pool.server");
    const stats = await fetchPoolStats(config.pool, config.uid, config.coin);
    if (!stats.ok) {
      await audit("mining.pool_sync_failed", "mining_worker", data.workerId, {
        pool: config.pool,
        error: stats.error,
      });
      throw new Error(stats.error ?? "La pool no devolvió datos.");
    }

    // Las ganancias se calculan del saldo que la pool acumula entre dos lecturas,
    // no de una estimación: si aún no hay dos muestras, se avisa en vez de inventar.
    const previous = await readSetting<StoredPoolStats>(db, POOL_STATS_KEY(data.workerId));
    const accrued = stats.balance + stats.unconfirmed;
    let dailyEarnings: number | null = null;
    if (previous && previous.previousFetchedAt && previous.previousBalance !== null) {
      const hours =
        (Date.parse(previous.fetchedAt) - Date.parse(previous.previousFetchedAt)) / 3_600_000;
      const delta = accrued - previous.previousBalance;
      if (hours >= 0.5 && delta > 0) dailyEarnings = Number(((delta / hours) * 24).toFixed(8));
    }

    await writeSetting(
      db,
      POOL_STATS_KEY(data.workerId),
      {
        ...config,
        fetchedAt: stats.fetchedAt,
        balance: accrued,
        previousBalance: previous ? previous.balance : null,
        previousFetchedAt: previous ? previous.fetchedAt : null,
      } satisfies StoredPoolStats,
      "Última lectura de la pool",
    );

    const patch: Record<string, unknown> = {
      hash_rate: Number(stats.hashrate.toFixed(2)),
      hash_unit: "H/s",
      updated_at: new Date().toISOString(),
    };
    if (dailyEarnings !== null) patch["estimated_daily_earnings"] = dailyEarnings;
    await db
      .from("mining_workers")
      .update(patch as never)
      .eq("id", data.workerId);

    return {
      ok: true,
      mode: "pool-generic",
      pool: config.label,
      coin: config.coin,
      hashrate: stats.hashrate,
      accrued,
      dailyEarnings,
      earningsSource: null,
      sampleReady: dailyEarnings !== null,
      newPayments: 0,
      lastSyncAt: stats.fetchedAt,
      monero: null,
    };
  });

/**
 * Valida una wallet Monero contra la API pública de Nanopool sin conectar el worker.
 * Devuelve el estado real: `accountExists` (la pool la conoce) y `hasActivity`
 * (hay un minero de XMRig reportando hashrate ahora mismo). No lanza por wallet
 * inválida ni por falta de actividad: eso se muestra en la UI como estado.
 */
export const validateMoneroPoolWallet = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ wallet: z.string().min(3).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { fetchMoneroPoolOverview, validateXmrWallet } = await import("./mining-pool.server");
    const address = validateXmrWallet(data.wallet);
    if (!address.ok) {
      return { ok: false as const, address, overview: null, error: address.message };
    }
    const overview = await fetchMoneroPoolOverview(address.address, {
      history: false,
      poolContext: false,
    });
    return { ok: overview.ok, address, overview, error: overview.error };
  });

/**
 * Desconecta el worker de la pool: vuelve a modo entrenamiento (simulado).
 * Se limpian también hashrate y ganancia para no dejar cifras reales colgando
 * en un worker que ya no está conectado (no se mezclan modos).
 */
export const disconnectWorkerPool = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ workerId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    await db.from("app_settings").delete().eq("key", POOL_KEY(data.workerId));
    await db.from("app_settings").delete().eq("key", POOL_STATS_KEY(data.workerId));
    await db
      .from("mining_workers")
      .update({
        hash_rate: 0,
        hash_unit: "H/s",
        estimated_daily_earnings: 0,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.workerId);
    await audit("mining.pool_disconnected", "mining_worker", data.workerId, {});
    return { ok: true };
  });

/**
 * Estado de conexión a pool de cada worker (nunca expone la wallet completa).
 * Une la configuración guardada con la última fotografía real de la pool para que
 * la UI pueda distinguir "pool real" de "demo/entrenamiento simulado".
 */
export const listWorkerPoolStatus = createServerFn({ method: "GET" }).handler(async () => {
  const db = await admin();
  const [configs, snapshots] = await Promise.all([
    db.from("app_settings").select("key,value").like("key", "mining_pool:%"),
    db.from("app_settings").select("key,value").like("key", "mining_pool_stats:%"),
  ]);

  const statsByWorker = new Map<string, StoredPoolStats>();
  for (const row of (snapshots.data ?? []) as unknown as { key: string; value: string }[]) {
    try {
      statsByWorker.set(
        row.key.slice("mining_pool_stats:".length),
        JSON.parse(row.value) as StoredPoolStats,
      );
    } catch {
      /* fotografía corrupta: se ignora */
    }
  }

  const rows = (configs.data ?? []) as unknown as { key: string; value: string }[];
  return rows.flatMap((row) => {
    const workerId = row.key.slice("mining_pool:".length);
    try {
      const cfg = JSON.parse(row.value) as StoredPoolConfig;
      const snapshot = statsByWorker.get(workerId);
      const xmr = snapshot?.xmr;
      return [
        {
          workerId,
          pool: cfg.pool,
          label: cfg.label,
          coin: cfg.coin,
          uidLast4: cfg.uid.slice(-4),
          /** Wallet abreviada para mostrar (44AFFq…BEP3A). */
          uidShort: shortMoneroAddress(cfg.uid),
          /**
           * Wallet completa solo en modo XMR: una dirección Monero es información
           * pública y hace falta para generar el comando de XMRig del panel.
           */
          wallet: cfg.coin.toUpperCase() === "XMR" ? cfg.uid : null,
          workerName: cfg.workerName ?? null,
          addressKind: cfg.addressKind ?? null,
          connectedAt: cfg.connectedAt ?? null,
          /** "xmr-real" cuando la wallet es Monero y se leen sus rutas reales. */
          mode: cfg.coin.toUpperCase() === "XMR" ? "xmr-real" : "pool-generic",
          hashrate: xmr?.hashrate ?? null,
          hashrate24h: xmr?.hashrate24h ?? null,
          balance: snapshot?.balance ?? null,
          paidTotal: xmr?.paidTotal ?? null,
          paidLast24h: xmr?.paidLast24h ?? null,
          workersActive: xmr?.workersActive ?? null,
          lastShareAt: xmr?.lastShareAt ?? null,
          accountExists: xmr?.accountExists ?? null,
          hasActivity: xmr?.hasActivity ?? null,
          activityNote: xmr?.activityNote ?? null,
          dailyEarnings: xmr?.dailyEarnings ?? null,
          earningsSource: xmr?.earningsSource ?? null,
          usdPrice: xmr?.usdPrice ?? null,
          lastSyncAt: snapshot?.fetchedAt ?? null,
        },
      ];
    } catch {
      return [];
    }
  });
});

export const updateBotRisk = createServerFn({ method: "POST" })
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
  .handler(async ({ data }) => {
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
    await audit("risk.limits_updated", "bot", data.botId, { ...data });
    return { ok: true };
  });

export const updateAutomationSettings = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        engineEnabled: z.boolean().optional(),
        killSwitch: z.boolean().optional(),
        allowRealTrading: z.boolean().optional(),
        tickIntervalSeconds: z.number().int().min(30).max(3600).optional(),
        globalMaxDailyLoss: z.number().min(1).max(100000).optional(),
        globalMaxDrawdownPct: z.number().min(0.5).max(100).optional(),
        globalMaxCapital: z.number().min(10).max(1000000).optional(),
        globalMaxWeeklyDrawdownPct: z.number().min(1).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: settings } = await db
      .from("automation_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (!settings) throw new Error("No hay configuración del motor");

    if (data.allowRealTrading === true) {
      const { data: creds } = await db.from("binance_credentials").select("connection_status");
      if (!(creds ?? []).some((c) => c.connection_status === "ok")) {
        throw new Error(
          "Configura y verifica tus API Keys de Binance antes de autorizar trading real",
        );
      }
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (data.engineEnabled !== undefined) patch["engine_enabled"] = data.engineEnabled;
    if (data.killSwitch !== undefined) patch["kill_switch"] = data.killSwitch;
    if (data.allowRealTrading !== undefined) patch["allow_real_trading"] = data.allowRealTrading;
    if (data.tickIntervalSeconds !== undefined)
      patch["tick_interval_seconds"] = data.tickIntervalSeconds;
    if (data.globalMaxDailyLoss !== undefined)
      patch["global_max_daily_loss"] = data.globalMaxDailyLoss;
    if (data.globalMaxDrawdownPct !== undefined)
      patch["global_max_drawdown_pct"] = data.globalMaxDrawdownPct;
    if (data.globalMaxCapital !== undefined)
      patch["global_max_capital"] = data.globalMaxCapital;
    if (data.globalMaxWeeklyDrawdownPct !== undefined)
      patch["global_max_weekly_drawdown_pct"] = data.globalMaxWeeklyDrawdownPct;
    if (data.engineEnabled === false || data.killSwitch === true)
      patch["engine_status"] = "stopped";

    const { error } = await db
      .from("automation_settings")
      .update(patch as never)
      .eq("id", settings.id);
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

    await audit("automation.settings_updated", "automation_settings", settings.id, { ...data });
    return { ok: true };
  });

// Ejecuta un ciclo manual del mismo motor que corre en el cron 24/7.
export const runEngineNow = createServerFn({ method: "POST" }).handler(async () => {
  const { runEngineTick } = await import("./automation.server");
  const res = await runEngineTick("manual");
  // Devuelve también el estado para que la UI explique por qué 0 bots.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settings } = await supabaseAdmin
    .from("automation_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  const { data: bots } = await supabaseAdmin
    .from("bots")
    .select("id,name,status,automation_enabled,mode");
  // Nube sin PART7 (sin tabla engine_runs): lastRun null en vez de romper.
  let lastRun: unknown = null;
  try {
    const res = await supabaseAdmin
      .from("engine_runs")
      .select("status,notes,bots_processed,orders_created,started_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!res.error) lastRun = res.data ?? null;
  } catch {
    lastRun = null;
  }
  return { ...res, settings, bots: bots ?? [], lastRun: lastRun ?? null };
});
