// Lógica de validación de riesgo compartida (server-only).

import type { MetricasDemo } from "./promotion-gate";

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
  /** Metricas reales de las operaciones en demo (paper trading). */
  metricasDemo: MetricasDemo;
  /** Drawdown maximo admitido para el bot (%). */
  maxDrawdownLimitePct: number;
};

/** Compara el bot en demo contra los criterios configurados y el benchmark buy-and-hold. */
export async function evaluatePromotionCore(botId: string): Promise<PromotionCheck> {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  const { data: bot } = await db.from("bots").select("*").eq("id", botId).maybeSingle();
  if (!bot) throw new Error("Bot no encontrado");

  // Los criterios y las credenciales son del DUEÑO del bot: con .limit(1) se
  // usaban los limites de otro usuario y se daba por verificadas las claves
  // de otro (un bot podia promoverse a Real con las claves ajenas).
  const { duenoDe } = await import("./tick-scope");
  const { leerAjustesDeUsuario, leerAjustesPlataforma } = await import("./propietario.server");
  const duenoId = duenoDe(bot);
  let settings = null;
  if (duenoId) {
    settings = await leerAjustesDeUsuario(db, duenoId);
  } else {
    settings = (await leerAjustesPlataforma(db))?.fila ?? null;
  }
  const { data: creds } = duenoId
    ? await db.from("binance_credentials").select("connection_status").eq("user_id", duenoId)
    : { data: [] as { connection_status: string }[] };

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

  const first = prices && prices.length > 0 ? Number(prices[0]!.price) : null;
  const last = prices && prices.length > 0 ? Number(prices[prices.length - 1]!.price) : null;
  const benchmarkReturnPct =
    first && last ? Number((((last - first) / first) * 100).toFixed(2)) : 0;

  const hasStopLoss = Number(bot.stop_loss_pct) > 0;
  const hasTakeProfit = Number(bot.take_profit_pct) > 0;
  const binanceVerified = (creds ?? []).some((c) => c.connection_status === "ok");

  // ── Evidencia real del paper trading ──────────────────────────────────
  // Las operaciones CERRADAS en demo (cada venta trae su P&L). Con esto se
  // miden el P&L neto, el win rate, el profit factor y el drawdown de
  // verdad, en vez de fiarse solo del contador y del P&L acumulado.
  const { metricasDeEjecuciones, evaluarGate } = await import("./promotion-gate");
  const { data: ejecuciones } = await db
    .from("bot_executions")
    .select("side,pnl,created_at,status")
    .eq("bot_id", botId)
    .eq("mode", "demo");
  const metricasDemo = metricasDeEjecuciones(
    (
      (ejecuciones ?? []) as {
        side: string;
        pnl: number | string | null;
        created_at: string;
      }[]
    ).map((e) => ({ ...e, pnl: e.pnl })),
    capital,
  );

  const maxDrawdownLimitePct = Number(bot.max_drawdown_pct ?? 0);
  // Un bot de COBERTURA (carry) juega con otras reglas: compra el spot y
  // vende el perpetuo y los mantiene (una o dos operaciones en semanas), asi
  // que no puede cumplir "50 operaciones" ni tiene que superar al mercado
  // (su gracia es NO depender de la direccion). Lo que se le exige es lo
  // importante: tiempo suficiente, P&L positivo, drawdown bajo y claves
  // verificadas.
  const esCobertura = String(bot.modo_operacion ?? "direccional") === "cobertura";
  const gate = evaluarGate(
    {
      dias: demoDays,
      minDias: minDemoDays,
      minOperaciones: esCobertura ? 1 : minDemoTrades,
      maxDrawdownPct: maxDrawdownLimitePct,
      exigirBenchmark: esCobertura ? false : benchmarkRequired,
      botReturnPct,
      benchmarkReturnPct,
      stopLossPct: esCobertura ? 1 : Number(bot.stop_loss_pct ?? 0),
      takeProfitPct: esCobertura ? 1 : Number(bot.take_profit_pct ?? 0),
      binanceVerificado: binanceVerified,
      capital,
    },
    metricasDemo,
  );

  return {
    ok: gate.ok,
    reasons: gate.razones,
    demoDays,
    demoTrades: metricasDemo.operaciones,
    minDemoDays,
    minDemoTrades,
    botReturnPct,
    benchmarkReturnPct,
    benchmarkRequired,
    hasStopLoss,
    hasTakeProfit,
    binanceVerified,
    metricasDemo,
    maxDrawdownLimitePct,
  };
}
