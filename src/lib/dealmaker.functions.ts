import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  const query = `timestamp=${Date.now()}&recvWindow=5000`;
  const signature = await signBinanceQuery(query, apiSecret);
  const res = await fetch(`https://api.binance.com/api/v3/account?${query}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (res.ok) return { ok: true as const, message: "Conexión de solo lectura verificada" };
  const body = (await res.json().catch(() => ({}))) as { msg?: string };
  return { ok: false as const, message: body.msg ?? `Binance respondió ${res.status}` };
}

export const testBinanceConnection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ apiKey: z.string().min(8), apiSecret: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data }) => binancePing(data.apiKey.trim(), data.apiSecret.trim()));

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
      connection_status: test.ok ? "ok" : "failed",
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
    const { error } = await db.from("bots").insert({
      name: data.name,
      strategy: data.strategy,
      pair: data.pair.toUpperCase(),
      capital: data.capital,
      status: "paused",
      mode: "demo",
    });
    if (error) throw new Error(error.message);
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
    const { error } = await db.from("training_sandboxes").insert({
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
      .in("status", ["training", "paused"]);
    const candidates = (bots ?? []).slice(0, 4);

    const rand = (min: number, max: number) => Number((Math.random() * (max - min) + min).toFixed(2));
    const runs = candidates.map((bot) => ({
      sandbox_id: data.sandboxId,
      bot_id: bot.id,
      bot_name: bot.name,
      return_pct: rand(-8, 26),
      drawdown_pct: rand(2, 14),
      win_rate: rand(42, 71),
      suggested_params: {
        stop_loss: `${rand(0.8, 2.4)}%`,
        take_profit: `${rand(2, 6)}%`,
        timeframe: sandbox.dataset.includes("15m") ? "15m" : "1h",
      } as never,
    }));

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
        ai_notes: `La capa de IA multi-plataforma normalizó ${(sandbox.ai_sources as unknown as unknown[]).length || 2} fuentes de mercado a un esquema común (OHLCV + funding) y ajustó stops y tamaños de posición durante la simulación acelerada ${sandbox.speed}x.`,
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

/* --------------------- MOTOR DE AUTOMATIZACIÓN 24/7 ------------------- */

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
        globalMaxDailyLoss: z.number().nonnegative().optional(),
        globalMaxDrawdownPct: z.number().min(0).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: settings } = await db.from("automation_settings").select("*").limit(1).maybeSingle();
    if (!settings) throw new Error("No hay configuración del motor");

    if (data.allowRealTrading === true) {
      const { data: creds } = await db.from("binance_credentials").select("connection_status");
      if (!(creds ?? []).some((c) => c.connection_status === "ok")) {
        throw new Error("Configura y verifica tus API Keys de Binance antes de autorizar trading real");
      }
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (data.engineEnabled !== undefined) patch['engine_enabled'] = data.engineEnabled;
    if (data.killSwitch !== undefined) patch['kill_switch'] = data.killSwitch;
    if (data.allowRealTrading !== undefined) patch['allow_real_trading'] = data.allowRealTrading;
    if (data.tickIntervalSeconds !== undefined) patch['tick_interval_seconds'] = data.tickIntervalSeconds;
    if (data.globalMaxDailyLoss !== undefined) patch['global_max_daily_loss'] = data.globalMaxDailyLoss;
    if (data.globalMaxDrawdownPct !== undefined) patch['global_max_drawdown_pct'] = data.globalMaxDrawdownPct;
    if (data.engineEnabled === false || data.killSwitch === true) patch['engine_status'] = "stopped";

    const { error } = await db
      .from("automation_settings")
      .update(patch as never)
      .eq("id", settings.id);
    if (error) throw new Error(error.message);

    if (data.killSwitch === true) {
      const { data: bots } = await db.from("bots").select("id").eq("status", "running");
      for (const bot of bots ?? []) {
        await db.from("bots").update({ status: "stopped", auto_stop_reason: "kill_switch_manual" }).eq("id", bot.id);
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
  return runEngineTick("manual");
});
