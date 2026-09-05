// Gestión de riesgo, kill switch, alertas, validación Demo→Real,
// política de capital y reportes de performance.
//
// Los flujos sensibles (retiro de fondos y paso Demo→Real) exigen sesión
// autenticada real con 2FA verificada (AAL2). No hay simulación de 2FA:
// sin sesión con segundo factor, esos flujos quedan bloqueados.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
  actor = "operator",
) {
  const db = await admin();
  await db.from("audit_events").insert({
    action,
    entity,
    entity_id: entityId,
    details: details as never,
    actor,
  });
}

function assertTwoFactor(claims: Record<string, unknown>) {
  if (claims['aal'] !== "aal2") {
    throw new Error(
      "Se requiere verificación 2FA (TOTP) en la sesión actual. Configura y verifica tu segundo factor en Acceso y seguridad.",
    );
  }
}

/* ----------------------------- RIESGO POR BOT ---------------------------- */

export const saveBotRisk = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        automationEnabled: z.boolean(),
        stopLossPct: z.number().min(0.1).max(100),
        takeProfitPct: z.number().min(0.1).max(500),
        maxDailyLoss: z.number().nonnegative(),
        maxDrawdownPct: z.number().min(0).max(100),
        maxWeeklyDrawdownPct: z.number().min(0).max(100),
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
        stop_loss_pct: data.stopLossPct,
        take_profit_pct: data.takeProfitPct,
        max_daily_loss: data.maxDailyLoss,
        max_drawdown_pct: data.maxDrawdownPct,
        max_weekly_drawdown_pct: data.maxWeeklyDrawdownPct,
        max_capital: data.maxCapital,
        max_trades_per_day: data.maxTradesPerDay,
        auto_stop_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit("risk.bot_limits_updated", "bot", data.botId, { ...data });
    return { ok: true };
  });

/* --------------------- RIESGO GLOBAL DEL ESCUADRÓN ----------------------- */

export const saveSquadRisk = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        globalMaxDailyLoss: z.number().nonnegative(),
        globalMaxDrawdownPct: z.number().min(0).max(100),
        globalMaxWeeklyDrawdownPct: z.number().min(0).max(100),
        globalMaxCapital: z.number().nonnegative(),
        maxPairConcentrationPct: z.number().min(1).max(100),
        minDemoDays: z.number().int().min(0).max(365),
        minDemoTrades: z.number().int().min(0).max(10000),
        requireBenchmarkOutperformance: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: settings } = await db.from("automation_settings").select("id").limit(1).maybeSingle();
    if (!settings) throw new Error("No hay configuración del motor");
    const { error } = await db
      .from("automation_settings")
      .update({
        global_max_daily_loss: data.globalMaxDailyLoss,
        global_max_drawdown_pct: data.globalMaxDrawdownPct,
        global_max_weekly_drawdown_pct: data.globalMaxWeeklyDrawdownPct,
        global_max_capital: data.globalMaxCapital,
        max_pair_concentration_pct: data.maxPairConcentrationPct,
        min_demo_days: data.minDemoDays,
        min_demo_trades: data.minDemoTrades,
        require_benchmark_outperformance: data.requireBenchmarkOutperformance,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    if (error) throw new Error(error.message);
    await audit("risk.squad_limits_updated", "automation_settings", settings.id, { ...data });
    return { ok: true };
  });

/* --------------------------- POLÍTICA DE CAPITAL -------------------------- */

export const saveCapitalPolicy = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        profitPolicy: z.enum(["reinvest", "reserve"]),
        profitReservePct: z.number().min(0).max(100),
        notifyEmail: z.string().email().or(z.literal("")),
        notifyEmailEnabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: settings } = await db.from("automation_settings").select("id").limit(1).maybeSingle();
    if (!settings) throw new Error("No hay configuración del motor");
    const { error } = await db
      .from("automation_settings")
      .update({
        profit_policy: data.profitPolicy,
        profit_reserve_pct: data.profitReservePct,
        notify_email: data.notifyEmail || null,
        notify_email_enabled: data.notifyEmailEnabled && !!data.notifyEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    if (error) throw new Error(error.message);
    await audit("capital.policy_updated", "automation_settings", settings.id, { ...data });
    return { ok: true };
  });

/* ------------------------------ KILL SWITCH ------------------------------ */

export const triggerKillSwitch = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        active: z.boolean(),
        reason: z.string().min(3).max(300),
        actor: z.string().min(1).max(120).default("operator"),
        confirmed: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { raiseAlert } = await import("./alerts.server");
    const { data: settings } = await db.from("automation_settings").select("id").limit(1).maybeSingle();
    if (!settings) throw new Error("No hay configuración del motor");
    const now = new Date().toISOString();

    const { error } = await db
      .from("automation_settings")
      .update({
        kill_switch: data.active,
        engine_enabled: data.active ? false : undefined,
        engine_status: data.active ? "halted" : "stopped",
        kill_switch_reason: data.reason,
        kill_switch_actor: data.actor,
        kill_switch_at: now,
        updated_at: now,
      })
      .eq("id", settings.id);
    if (error) throw new Error(error.message);

    let botsStopped = 0;
    let workersStopped = 0;

    if (data.active) {
      const { data: bots } = await db.from("bots").select("id,name").neq("status", "stopped");
      for (const bot of bots ?? []) {
        await db
          .from("bots")
          .update({ status: "stopped", auto_stop_reason: "kill_switch", updated_at: now })
          .eq("id", bot.id);
        await db.from("bot_logs").insert({
          bot_id: bot.id,
          level: "error",
          message: `Kill switch global activado por ${data.actor}: ${data.reason}. Bot detenido y sin nuevas órdenes.`,
        });
        botsStopped++;
      }
      const { data: workers } = await db.from("mining_workers").select("id").neq("status", "idle");
      for (const worker of workers ?? []) {
        await db
          .from("mining_workers")
          .update({ status: "idle", hash_rate: 0, updated_at: now })
          .eq("id", worker.id);
        workersStopped++;
      }
      await raiseAlert(db, {
        category: "security",
        severity: "critical",
        title: "Kill switch global activado",
        message: `${data.actor}: ${data.reason}. ${botsStopped} bots detenidos y ${workersStopped} workers apagados.`,
        entity: "automation",
      });
    } else {
      await raiseAlert(db, {
        category: "security",
        severity: "warning",
        title: "Kill switch desactivado",
        message: `${data.actor}: ${data.reason}. Los bots y workers siguen detenidos hasta reactivarlos manualmente.`,
        entity: "automation",
      });
    }

    await audit(
      data.active ? "security.kill_switch_activated" : "security.kill_switch_released",
      "automation",
      settings.id,
      { reason: data.reason, bots_stopped: botsStopped, workers_stopped: workersStopped, at: now },
      data.actor,
    );

    return { ok: true, botsStopped, workersStopped };
  });

/* -------------------------------- ALERTAS -------------------------------- */

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ alertId: z.string().uuid().optional(), all: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const query = db.from("alerts").update({ acknowledged: true });
    const { error } = data.alertId
      ? await query.eq("id", data.alertId)
      : await query.eq("acknowledged", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------ VALIDACIÓN DEMO → REAL -------------------------- */

export type PromotionCheck = {
  ok: boolean;
  reasons: string[];
  demoDays: number;
  demoTrades: number;
  minDemoDays: number;
  minDemoTrades: number;
  botReturnPct: number;
  benchmarkReturnPct: number;
  benchmarkRequired: boolean;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
  binanceVerified: boolean;
};

export const evaluatePromotion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ botId: z.string().uuid() }).parse(input))
  .handler(async ({ data }): Promise<PromotionCheck> => {
    const db = await admin();
    const { data: bot } = await db.from("bots").select("*").eq("id", data.botId).maybeSingle();
    if (!bot) throw new Error("Bot no encontrado");
    const { data: settings } = await db.from("automation_settings").select("*").limit(1).maybeSingle();
    const { data: creds } = await db.from("binance_credentials").select("connection_status");

    const minDemoDays = Number(settings?.min_demo_days ?? 14);
    const minDemoTrades = Number(settings?.min_demo_trades ?? 50);
    const benchmarkRequired = settings?.require_benchmark_outperformance !== false;

    const since = bot.demo_since ? new Date(bot.demo_since) : new Date(bot.created_at);
    const demoDays = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86_400_000));
    const demoTrades = Number(bot.demo_trades ?? 0);

    const capital = Number(bot.capital) || 1;
    const botReturnPct = Number(((Number(bot.pnl) / capital) * 100).toFixed(2));

    const { data: prices } = await db
      .from("market_prices")
      .select("price,recorded_on")
      .eq("symbol", bot.pair)
      .gte("recorded_on", since.toISOString().slice(0, 10))
      .order("recorded_on", { ascending: true });
    const first = prices?.[0]?.price ? Number(prices[0].price) : null;
    const last = prices?.length ? Number(prices[prices.length - 1]!.price) : null;
    const benchmarkReturnPct =
      first && last ? Number((((last - first) / first) * 100).toFixed(2)) : 0;

    const hasStopLoss = Number(bot.stop_loss_pct) > 0;
    const hasTakeProfit = Number(bot.take_profit_pct) > 0;
    const binanceVerified = (creds ?? []).some((c) => c.connection_status === "ok");

    const reasons: string[] = [];
    if (!hasStopLoss) reasons.push("Falta stop-loss obligatorio.");
    if (!hasTakeProfit) reasons.push("Falta take-profit obligatorio.");
    if (demoDays < minDemoDays)
      reasons.push(`Solo ${demoDays} de ${minDemoDays} días mínimos en demo.`);
    if (demoTrades < minDemoTrades)
      reasons.push(`Solo ${demoTrades} de ${minDemoTrades} operaciones demo mínimas.`);
    if (benchmarkRequired && botReturnPct <= benchmarkReturnPct)
      reasons.push(
        `El bot (${botReturnPct}%) no supera el benchmark buy-and-hold de ${bot.pair} (${benchmarkReturnPct}%).`,
      );
    if (!binanceVerified) reasons.push("Las API Keys de Binance no están verificadas.");

    return {
      ok: reasons.length === 0,
      reasons,
      demoDays,
      demoTrades,
      minDemoDays,
      minDemoTrades,
      botReturnPct,
      benchmarkReturnPct,
      benchmarkRequired,
      hasStopLoss,
      hasTakeProfit,
      binanceVerified,
    };
  });

/** Paso Demo→Real: exige sesión autenticada con 2FA verificada (AAL2). */
export const promoteBotToReal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ botId: z.string().uuid(), confirmed: z.literal(true) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    assertTwoFactor(context.claims as unknown as Record<string, unknown>);
    const db = await admin();
    const check = await evaluatePromotion({ data: { botId: data.botId } });
    if (!check.ok) throw new Error(check.reasons.join(" "));

    const { error } = await db
      .from("bots")
      .update({
        mode: "real",
        status: "paused",
        auto_stop_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);

    const { raiseAlert } = await import("./alerts.server");
    await raiseAlert(db, {
      category: "security",
      severity: "warning",
      title: "Bot promovido a modo REAL",
      message: `El bot pasó a operar con fondos reales tras validar criterios demo y 2FA. Queda en pausa para revisión.`,
      entity: "bot",
      entityId: data.botId,
    });
    await audit(
      "security.bot_mode_real",
      "bot",
      data.botId,
      { two_factor: "aal2_verified", ...check },
      context.userId,
    );
    return { ok: true };
  });

/* ------------------------- RETIRO PROTEGIDO CON 2FA ----------------------- */

export const createSecureWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        amount: z.number().positive(),
        method: z.enum(["transfer", "wallet", "onchain"]),
        confirmed: z.literal(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    assertTwoFactor(context.claims as unknown as Record<string, unknown>);
    const db = await admin();
    const { data: account } = await db
      .from("fund_accounts")
      .select("id,available_balance")
      .limit(1)
      .maybeSingle();
    if (!account) throw new Error("No hay cuenta de fondos configurada");
    if (Number(account.available_balance) < data.amount)
      throw new Error("Saldo disponible insuficiente para este retiro");

    const { error } = await db.from("fund_transactions").insert({
      account_id: account.id,
      kind: "withdrawal",
      method: data.method,
      amount: data.amount,
      status: "pending",
      reference: `WD-${Date.now()}`,
    });
    if (error) throw new Error(error.message);

    await db
      .from("fund_accounts")
      .update({
        available_balance: Number(account.available_balance) - data.amount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    const { raiseAlert } = await import("./alerts.server");
    await raiseAlert(db, {
      category: "funds",
      severity: "warning",
      title: "Retiro solicitado",
      message: `Retiro de ${data.amount} por ${data.method}, autorizado con 2FA verificada.`,
      entity: "fund_transaction",
    });
    await audit(
      "funds.withdrawal_requested",
      "fund_transaction",
      account.id,
      { amount: data.amount, method: data.method, two_factor: "aal2_verified" },
      context.userId,
    );
    return { ok: true };
  });

/* -------------------- REPORTES PERIÓDICOS Y BARRIDO DE GANANCIAS ---------- */

export const generateReports = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ period: z.enum(["daily", "weekly"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { buildReports } = await import("./reports.server");
    return buildReports(data.period);
  });

export const runProfitSweep = createServerFn({ method: "POST" }).handler(async () => {
  const { profitSweep } = await import("./reports.server");
  return profitSweep();
});
