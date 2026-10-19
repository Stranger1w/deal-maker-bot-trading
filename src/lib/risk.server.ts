// Lógica de validación de riesgo compartida (server-only).

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
    ? await db
        .from("binance_credentials")
        .select("connection_status")
        .eq("user_id" as never, duenoId as never)
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
}
