// Capa de IA multi-plataforma (módulo independiente del sandbox de entrenamiento).
// Responsabilidad única: leer las fuentes conectadas, normalizarlas a un esquema
// común y derivar sugerencias de parámetros. Se puede actualizar sin tocar el
// resto del campo de entrenamiento: la interfaz pública es estable.
//
// Sin secretos: solo usa endpoints públicos y el dataset compartido que alimenta
// el Escuadrón de Reconocimiento.

import { isBinanceGeoRestricted } from "@/lib/binance-region";

export const MARKET_DATA_LAYER_VERSION = "ai-market-layer/1.2.0";
export const NORMALIZED_SCHEMA = "ohlcv_v1";

type Db = {
  from: (table: string) => any;
};

/** Punto normalizado común a todas las plataformas conectadas. */
export type NormalizedPoint = {
  source: string;
  symbol: string;
  metric: "close" | "volume" | "funding" | "depth" | "sentiment" | string;
  value: number;
  observedAt: string;
};

export type SourceUsage = {
  source: string;
  kind: string;
  range: string;
  points: number;
  status: string;
};

export type MarketSnapshot = {
  version: string;
  schema: string;
  points: NormalizedPoint[];
  sources: SourceUsage[];
  symbols: string[];
};

const iso = (d: Date) => d.toISOString();

function rangeLabel(points: NormalizedPoint[]) {
  if (!points.length) return "sin datos";
  const dates = points.map((p) => p.observedAt).sort();
  return `${dates[0]!.slice(0, 10)} → ${dates[dates.length - 1]!.slice(0, 10)}`;
}

/** Ingesta pública de Binance (sin credenciales). Devuelve [] si no está disponible. */
export async function ingestBinancePublic(
  symbols: string[],
  limit = 60,
): Promise<{ points: NormalizedPoint[]; status: string }> {
  const points: NormalizedPoint[] = [];
  let status = "connected";
  for (const symbol of symbols.slice(0, 4)) {
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=${limit}`,
      );
      const body = await res.text();
      if (!res.ok) {
        status = isBinanceGeoRestricted(res.status, body) ? "geo_restricted" : "error";
        continue;
      }
      const rows = JSON.parse(body) as unknown[][];
      for (const row of rows) {
        const observedAt = new Date(Number(row[0])).toISOString();
        points.push({
          source: "Binance Spot Klines",
          symbol,
          metric: "close",
          value: Number(row[4]),
          observedAt,
        });
        points.push({
          source: "Binance Spot Klines",
          symbol,
          metric: "volume",
          value: Number(row[5]),
          observedAt,
        });
      }
    } catch {
      status = status === "connected" ? "error" : status;
    }
  }
  return { points, status };
}

/** Lee el dataset compartido que llena el Escuadrón de Reconocimiento. */
export async function loadReconDataset(
  db: Db,
  symbols: string[],
  since?: string,
): Promise<NormalizedPoint[]> {
  let q = db
    .from("recon_observations")
    .select("source,symbol,metric,value,observed_at")
    .order("observed_at", { ascending: true })
    .limit(2000);
  if (symbols.length) q = q.in("symbol", symbols);
  if (since) q = q.gte("observed_at", since);
  const { data } = await q;
  return (data ?? []).map((r: any) => ({
    source: r.source as string,
    symbol: r.symbol as string,
    metric: r.metric as string,
    value: Number(r.value),
    observedAt: r.observed_at as string,
  }));
}

/**
 * Construye la vista normalizada multi-plataforma: fuentes habilitadas +
 * ingesta pública + dataset del reconocimiento.
 */
export async function buildMarketSnapshot(
  db: Db,
  opts: { symbols: string[]; from?: string; to?: string; liveIngest?: boolean },
): Promise<MarketSnapshot> {
  const symbols = opts.symbols.map((s) => s.toUpperCase());
  const { data: sourceRows } = await db
    .from("market_data_sources")
    .select("name,kind,enabled,status")
    .eq("enabled", true);

  const points: NormalizedPoint[] = [];
  const statusBySource = new Map<string, string>();

  if (opts.liveIngest !== false) {
    const live = await ingestBinancePublic(symbols);
    points.push(...live.points);
    statusBySource.set("Binance Spot Klines", live.status);
    await db
      .from("market_data_sources")
      .update({ status: live.status, last_sync_at: iso(new Date()) })
      .eq("name", "Binance Spot Klines");
  }

  points.push(...(await loadReconDataset(db, symbols, opts.from)));

  const enabled = (sourceRows ?? []) as { name: string; kind: string; status: string }[];
  const sources: SourceUsage[] = enabled.map((s) => {
    const own = points.filter((p) => p.source === s.name);
    return {
      source: s.name,
      kind: s.kind,
      range: rangeLabel(own),
      points: own.length,
      status: statusBySource.get(s.name) ?? s.status,
    };
  });

  return { version: MARKET_DATA_LAYER_VERSION, schema: NORMALIZED_SCHEMA, points, sources, symbols };
}

/** Volatilidad relativa y tendencia por activo a partir de los cierres normalizados. */
export function analyzeSymbol(snapshot: MarketSnapshot, symbol: string) {
  const closes = snapshot.points
    .filter((p) => p.symbol === symbol && p.metric === "close")
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .map((p) => p.value);
  const volumes = snapshot.points
    .filter((p) => p.symbol === symbol && p.metric === "volume")
    .map((p) => p.value);

  if (closes.length < 3) return { volatilityPct: 0, trendPct: 0, volumeRatio: 1, samples: closes.length };

  const returns = closes.slice(1).map((c, i) => (c - closes[i]!) / closes[i]!);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const volatilityPct = Math.sqrt(variance) * 100;
  const trendPct = ((closes[closes.length - 1]! - closes[0]!) / closes[0]!) * 100;
  const avgVol = volumes.length ? volumes.reduce((s, v) => s + v, 0) / volumes.length : 0;
  const lastVol = volumes.length ? volumes[volumes.length - 1]! : 0;

  return {
    volatilityPct: Number(volatilityPct.toFixed(3)),
    trendPct: Number(trendPct.toFixed(2)),
    volumeRatio: avgVol ? Number((lastVol / avgVol).toFixed(2)) : 1,
    samples: closes.length,
  };
}

export type SuggestedParams = {
  stop_loss: string;
  take_profit: string;
  timeframe: string;
  position_size_pct: string;
  bias: "alcista" | "bajista" | "neutral";
  rationale: string;
};

/**
 * Ajusta los parámetros de estrategia con los datos multi-fuente, en lugar de
 * repetir el histórico: la volatilidad fija los stops y la tendencia/volumen el
 * sesgo y el tamaño de posición.
 */
export function suggestStrategyParams(
  snapshot: MarketSnapshot,
  symbol: string,
  dataset: string,
): SuggestedParams {
  const a = analyzeSymbol(snapshot, symbol);
  const base = Math.max(0.6, Math.min(4, a.volatilityPct * 1.6 || 1.2));
  const stop = Number(base.toFixed(2));
  const take = Number((base * (a.trendPct >= 0 ? 2.4 : 1.8)).toFixed(2));
  const size = Number(Math.max(5, Math.min(30, 20 / Math.max(0.5, base))).toFixed(1));
  const bias: SuggestedParams["bias"] =
    a.trendPct > 1.5 ? "alcista" : a.trendPct < -1.5 ? "bajista" : "neutral";

  return {
    stop_loss: `${stop}%`,
    take_profit: `${take}%`,
    timeframe: dataset.includes("15m") ? "15m" : "1h",
    position_size_pct: `${size}%`,
    bias,
    rationale:
      `Volatilidad ${a.volatilityPct}% sobre ${a.samples} muestras normalizadas de ` +
      `${snapshot.sources.filter((s) => s.points > 0).length} fuente(s); tendencia ${a.trendPct}% y ` +
      `volumen ${a.volumeRatio}x respecto a la media.`,
  };
}
