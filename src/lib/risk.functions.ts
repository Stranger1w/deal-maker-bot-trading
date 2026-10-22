// Gestión de riesgo, kill switch, alertas, validación Demo→Real,
// política de capital y reportes de performance.
//
// Los flujos sensibles (retiro de fondos y paso Demo→Real) exigen sesión
// autenticada real con 2FA verificada (AAL2). No hay simulación de 2FA:
// sin sesión con segundo factor, esos flujos quedan bloqueados.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";
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
  userId: string | null = null,
) {
  const db = await admin();
  // types.ts aun no incluye audit_events.user_id (columna anadida a mano): cast.
  await db.from("audit_events").insert({
    action,
    entity,
    entity_id: entityId,
    details: details as never,
    actor,
    user_id: userId,
  } as never);
}

function assertTwoFactor(claims: Record<string, unknown>) {
  if (claims["aal"] !== "aal2") {
    throw new Error(
      "Se requiere verificación 2FA (TOTP) en la sesión actual. Configura y verifica tu segundo factor en Acceso y seguridad.",
    );
  }
}

/* ----------------------------- RIESGO POR BOT ---------------------------- */

export const saveBotRisk = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    // El take-profit tiene que cubrir el coste de ida y vuelta (comisiones +
    // slippage) con margen: con un take-profit mas pequeno se pierde dinero
    // aunque el precio se mueva a favor.
    const { tpCubreCostes } = await import("./costes");
    const veredicto = tpCubreCostes(data.takeProfitPct);
    if (!veredicto.ok) throw new Error(veredicto.motivo);

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
    await audit(
      "risk.bot_limits_updated",
      "bot",
      data.botId,
      { ...data },
      "operator",
      context.userId,
    );
    return { ok: true };
  });

/* --------------------- RIESGO GLOBAL DEL ESCUADRÓN ----------------------- */

export const saveSquadRisk = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    // Los limites globales son los de la FILA DEL ADMINISTRADOR: con
    // .limit(1) se escribian en la fila de otro usuario.
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
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
      .eq("id", settings.id as string);
    if (error) throw new Error(error.message);
    await audit(
      "risk.squad_limits_updated",
      "automation_settings",
      settings.id,
      { ...data },
      "operator",
      context.userId,
    );
    return { ok: true };
  });

/* --------------------------- POLÍTICA DE CAPITAL -------------------------- */

export const saveCapitalPolicy = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
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
      .eq("id", settings.id as string);
    if (error) throw new Error(error.message);
    await audit(
      "capital.policy_updated",
      "automation_settings",
      settings.id,
      { ...data },
      "operator",
      context.userId,
    );
    return { ok: true };
  });

/* ------------------------------ KILL SWITCH ------------------------------ */

export const triggerKillSwitch = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { raiseAlert } = await import("./alerts.server");
    // El kill switch global vive en la fila del administrador.
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
    if (!settings) throw new Error("No hay configuración del motor");
    const now = new Date().toISOString();

    const { error } = await db
      .from("automation_settings")
      .update({
        kill_switch: data.active,
        engine_enabled: false,
        engine_status: data.active ? "halted" : "stopped",
        kill_switch_reason: data.reason,
        kill_switch_actor: data.actor,
        kill_switch_at: now,
        updated_at: now,
      })
      .eq("id", settings.id as string);
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
        userId: context.userId,
      });
    } else {
      await raiseAlert(db, {
        category: "security",
        severity: "warning",
        title: "Kill switch desactivado",
        message: `${data.actor}: ${data.reason}. Los bots y workers siguen detenidos hasta reactivarlos manualmente.`,
        entity: "automation",
        userId: context.userId,
      });
    }

    await audit(
      data.active ? "security.kill_switch_activated" : "security.kill_switch_released",
      "automation",
      settings.id,
      { reason: data.reason, bots_stopped: botsStopped, workers_stopped: workersStopped, at: now },
      data.actor,
      context.userId,
    );

    return { ok: true, botsStopped, workersStopped };
  });

/* -------------------------------- ALERTAS -------------------------------- */

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        alertId: z.string().uuid().optional(),
        all: z.boolean().default(false),
        /** Categorias a marcar. Sin valor: todas. */
        categories: z.array(z.string().max(40)).max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const query = db.from("alerts").update({ acknowledged: true });
    if (data.alertId) {
      const { error } = await query.eq("id", data.alertId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    // "Marcar todas" marcaba TODAS las alertas, incluso las de otras
    // secciones que no se estaban viendo. Ahora se puede limitar a las
    // categorias que se esta mostrando.
    let filtrada = query.eq("acknowledged", false);
    if (data.categories && data.categories.length > 0) {
      filtrada = filtrada.in("category", data.categories);
    }
    const { error } = await filtrada;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------ VALIDACIÓN DEMO → REAL -------------------------- */

export type { PromotionCheck } from "./risk.server";

export const evaluatePromotion = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({ botId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { evaluatePromotionCore } = await import("./risk.server");
    return evaluatePromotionCore(data.botId);
  });

/** Paso Demo→Real: exige sesión autenticada con 2FA verificada (AAL2). */
export const promoteBotToReal = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ botId: z.string().uuid(), confirmed: z.literal(true) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    assertTwoFactor(context.claims as unknown as Record<string, unknown>);
    const db = await admin();
    // Aviso de riesgo: nadie puede poner un bot en Real sin haber leido y
    // aceptado el aviso de que se puede perder TODO el capital.
    const { avisoAceptado } = await import("./aviso-riesgo.server");
    if (!(await avisoAceptado(db, context.userId))) {
      throw new Error(
        "Antes de activar un bot en Real tienes que leer y aceptar el aviso de riesgo (puedes perder todo el capital).",
      );
    }
    const { evaluatePromotionCore } = await import("./risk.server");
    const check = await evaluatePromotionCore(data.botId);
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
    // La alerta va a nombre del dueño del bot (puede no ser quien promovió).
    const { duenoDe } = await import("./tick-scope");
    const { data: filaBot } = await db
      .from("bots")
      .select("user_id")
      .eq("id", data.botId)
      .maybeSingle();
    await raiseAlert(db, {
      category: "security",
      severity: "warning",
      title: "Bot promovido a modo REAL",
      message: `El bot pasó a operar con fondos reales tras validar criterios demo y 2FA. Queda en pausa para revisión.`,
      entity: "bot",
      entityId: data.botId,
      userId: duenoDe(filaBot) ?? context.userId,
    });
    await audit(
      "security.bot_mode_real",
      "bot",
      data.botId,
      { two_factor: "aal2_verified", ...check },
      context.userId,
      context.userId,
    );
    return { ok: true };
  });

/* ------------------------- RETIRO PROTEGIDO CON 2FA ----------------------- */

export const createSecureWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
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
    // La cuenta es la del usuario que pide el retiro: con .limit(1) se
    // descontaba el saldo de la cuenta de otro usuario.
    const { leerCuentaDeUsuario } = await import("./propietario.server");
    const account = await leerCuentaDeUsuario(db, context.userId);
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
      userId: context.userId,
    });
    await audit(
      "funds.withdrawal_requested",
      "fund_transaction",
      account.id,
      { amount: data.amount, method: data.method, two_factor: "aal2_verified" },
      context.userId,
      context.userId,
    );
    return { ok: true };
  });

/* ------------------------- AVISO DE RIESGO -------------------------------- */

/**
 * Estado del aviso de riesgo del usuario actual (para la UI).
 * No exige ser admin: cada uno acepta el aviso por su cuenta.
 */
export const estadoAvisoRiesgo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { leerEstadoAviso } = await import("./aviso-riesgo.server");
    return leerEstadoAviso(db, context.userId);
  });

/** Registra que el usuario ha leido y aceptado el aviso de riesgo. */
export const aceptarAvisoRiesgo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { registrarAceptacion, leerEstadoAviso } = await import("./aviso-riesgo.server");
    await registrarAceptacion(db, context.userId);
    await audit(
      "risk.notice_accepted",
      "user",
      context.userId,
      { version: (await leerEstadoAviso(db, context.userId)).version },
      "operator",
      context.userId,
    );
    return { ok: true };
  });

/* -------------------- REPORTES PERIÓDICOS Y BARRIDO DE GANANCIAS ---------- */

export const generateReports = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ period: z.enum(["daily", "weekly"]) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { buildReports } = await import("./reports.server");
    return buildReports(data.period);
  });

export const runProfitSweep = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { profitSweep } = await import("./reports.server");
    return profitSweep();
  });
