// Reportes periódicos de performance y política de capital (server-only).
// La entrega por email queda en estado "pendiente_dominio" mientras no exista
// un dominio de envío verificado: no se simulan entregas.

import { raiseAlert } from "./alerts.server";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function buildReports(period: "daily" | "weekly") {
  const client = await db();
  const end = new Date();
  const start = new Date(end.getTime() - (period === "daily" ? 1 : 7) * 86_400_000);

  const { data: settings } = await client
    .from("automation_settings")
    .select("notify_email, notify_email_enabled")
    .limit(1)
    .maybeSingle();
  const emailStatus =
    settings?.notify_email_enabled && settings.notify_email
      ? "pendiente_dominio_verificado"
      : "no_configurado";

  const { data: bots } = await client.from("bots").select("name,pnl,capital,win_rate,mode,status");
  const { data: executions } = await client
    .from("bot_executions")
    .select("pnl,created_at")
    .gte("created_at", start.toISOString());
  const { data: workers } = await client
    .from("mining_workers")
    .select("hash_rate,estimated_daily_earnings,status");
  const { data: payouts } = await client
    .from("mining_payouts")
    .select("usd_value,paid_at")
    .gte("paid_at", start.toISOString());

  const squadPnl = (executions ?? []).reduce((s, e) => s + Number(e.pnl), 0);
  const squadCapital = (bots ?? []).reduce((s, b) => s + Number(b.capital), 0);
  const winRate =
    (bots ?? []).reduce((s, b) => s + Number(b.win_rate), 0) / ((bots ?? []).length || 1);
  const runningBots = (bots ?? []).filter((b) => b.status === "running").length;

  const activeWorkers = (workers ?? []).filter((w) => w.status === "mining");
  const hashTotal = activeWorkers.reduce((s, w) => s + Number(w.hash_rate), 0);
  const payoutTotal = (payouts ?? []).reduce((s, p) => s + Number(p.usd_value), 0);
  const dailyEarnings = (workers ?? []).reduce(
    (s, w) => s + Number(w.estimated_daily_earnings),
    0,
  );

  const rows = [
    {
      period,
      scope: "squad",
      period_start: day(start),
      period_end: day(end),
      metrics: {
        pnl: Number(squadPnl.toFixed(2)),
        capital: Number(squadCapital.toFixed(2)),
        win_rate: Number(winRate.toFixed(2)),
        bots_running: runningBots,
        executions: (executions ?? []).length,
      } as never,
      summary: `Escuadrón: P&L ${squadPnl.toFixed(2)} en ${(executions ?? []).length} ejecuciones, ${runningBots} bots activos, win rate medio ${winRate.toFixed(1)}%.`,
      email_status: emailStatus,
    },
    {
      period,
      scope: "mining",
      period_start: day(start),
      period_end: day(end),
      metrics: {
        hash_rate_total: Number(hashTotal.toFixed(2)),
        workers_active: activeWorkers.length,
        payouts_usd: Number(payoutTotal.toFixed(2)),
        estimated_daily_usd: Number(dailyEarnings.toFixed(2)),
      } as never,
      summary: `Enjambre: ${activeWorkers.length} workers activos, hash rate ${hashTotal.toFixed(2)}, pagos ${payoutTotal.toFixed(2)} USD en el periodo.`,
      email_status: emailStatus,
    },
  ];

  const { error } = await client.from("performance_reports").insert(rows);
  if (error) throw new Error(error.message);

  await raiseAlert(client, {
    category: "report",
    severity: "info",
    title: `Reporte ${period === "daily" ? "diario" : "semanal"} generado`,
    message: rows.map((r) => r.summary).join(" "),
    entity: "performance_report",
  });

  return { ok: true, reports: rows.length, emailStatus };
}

/** Reserva o reinvierte la ganancia semanal según la política configurada. */
export async function profitSweep() {
  const client = await db();
  const { data: settings } = await client
    .from("automation_settings")
    .select("id, profit_policy, profit_reserve_pct, last_profit_sweep_on")
    .limit(1)
    .maybeSingle();
  if (!settings) throw new Error("No hay configuración del motor");

  const today = day(new Date());
  if (settings.last_profit_sweep_on === today) {
    return { ok: true, skipped: "ya_ejecutado_hoy" as const, moved: 0 };
  }

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: executions } = await client
    .from("bot_executions")
    .select("pnl")
    .gte("created_at", weekAgo);
  const weeklyProfit = (executions ?? []).reduce((s, e) => s + Number(e.pnl), 0);

  let moved = 0;
  if (settings.profit_policy === "reserve" && weeklyProfit > 0) {
    moved = Number(((weeklyProfit * Number(settings.profit_reserve_pct)) / 100).toFixed(2));
    const { data: account } = await client
      .from("fund_accounts")
      .select("id,available_balance,in_use_balance")
      .limit(1)
      .maybeSingle();
    if (account && moved > 0) {
      const inUse = Math.max(0, Number(account.in_use_balance) - moved);
      await client
        .from("fund_accounts")
        .update({
          available_balance: Number(account.available_balance) + moved,
          in_use_balance: inUse,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);
      await client.from("fund_transactions").insert({
        account_id: account.id,
        kind: "deposit",
        method: "transfer",
        amount: moved,
        status: "completed",
        reference: `RESERVA-SEMANAL-${today}`,
      });
    }
  }

  await client
    .from("automation_settings")
    .update({ last_profit_sweep_on: today, updated_at: new Date().toISOString() })
    .eq("id", settings.id);

  await client.from("audit_events").insert({
    action: "capital.profit_sweep",
    entity: "fund_account",
    entity_id: null,
    details: {
      policy: settings.profit_policy,
      weekly_profit: Number(weeklyProfit.toFixed(2)),
      moved,
    } as never,
    actor: "cron",
  });

  await raiseAlert(client, {
    category: "funds",
    severity: "info",
    title: "Barrido de ganancias ejecutado",
    message:
      settings.profit_policy === "reserve"
        ? `Se reservaron ${moved} USDT como saldo disponible (${settings.profit_reserve_pct}% de la ganancia semanal). No se realizan retiros externos automáticos.`
        : "Política de reinversión activa: las ganancias permanecen asignadas a los bots.",
    entity: "fund_account",
  });

  return { ok: true, moved, policy: settings.profit_policy };
}
