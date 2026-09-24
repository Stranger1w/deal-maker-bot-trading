// Ingesta de datos públicos de mercado de los exchanges conectados (server-only).
// Sin credenciales: solo endpoints públicos de velas. Se usa en el Campo de
// Entrenamiento para que la capa de IA no dependa únicamente de Binance.
//
// Cada exchange usa su propio formato de símbolo (BTCUSDT vs BTC-USD vs XBTUSDT),
// por eso aquí se centraliza la traducción a su esquema y la normalización a
// `ohlcv_v1` (close/volume) que consume el módulo de IA.

import type { ExchangeId } from "./exchanges";

export type MarketPoint = {
  source: string;
  symbol: string;
  metric: string;
  value: number;
  observedAt: string;
};

export type ExchangeIngestResult = {
  id: ExchangeId;
  source: string;
  points: MarketPoint[];
  status: "connected" | "error" | "not_supported" | "no_pairs";
};

/** Exchanges con velas públicas disponibles (sin claves). eToro no las ofrece. */
export const PUBLIC_MARKET_EXCHANGES: Record<ExchangeId, string> = {
  binance: "Binance Spot Klines",
  coinbase: "Coinbase Spot Candles",
  kraken: "Kraken Spot OHLC",
  bybit: "Bybit Spot Klines",
  okx: "OKX Spot Candles",
  kucoin: "KuCoin Spot Candles",
  etoro: "eToro Market Data (solo lectura)",
};

const QUOTES = ["USDT", "USDC", "USD", "BTC", "ETH", "EUR"];

/** Separa un par del bot (BTCUSDT) en base y cotización. */
function splitPair(pair: string): { base: string; quote: string } {
  const upper = pair.toUpperCase();
  for (const quote of QUOTES) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return { base: upper.slice(0, upper.length - quote.length), quote };
    }
  }
  return { base: upper, quote: "USDT" };
}

export function symbolFor(exchange: ExchangeId, pair: string): string | null {
  const { base, quote } = splitPair(pair);
  switch (exchange) {
    case "coinbase":
      return quote.startsWith("USD") ? `${base}-USD` : null;
    case "kraken": {
      if (quote !== "USDT" && quote !== "USD") return null;
      const krakenBase = base === "BTC" ? "XBT" : base;
      return quote === "USD" ? `${krakenBase}USD` : `${krakenBase}USDT`;
    }
    case "bybit":
      return quote === "USDT" || quote === "USDC" ? `${base}${quote}` : null;
    case "okx":
      return quote === "USDT" || quote === "USDC" ? `${base}-${quote}` : null;
    case "kucoin":
      return quote === "USDT" || quote === "USDC" ? `${base}-${quote}` : null;
    case "binance":
      return `${base}${quote}`;
    default:
      return null;
  }
}

const hoursToIso = (value: number) => new Date(value).toISOString();

/** Convierte [time, close, volume] ya extraídos al punto normalizado. */
function toPoints(
  source: string,
  symbol: string,
  rows: { t: number; close: number; volume: number }[],
): MarketPoint[] {
  const points: MarketPoint[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.close) || row.close <= 0) continue;
    const observedAt = hoursToIso(row.t);
    points.push({ source, symbol, metric: "close", value: row.close, observedAt });
    if (Number.isFinite(row.volume) && row.volume > 0) {
      points.push({ source, symbol, metric: "volume", value: row.volume, observedAt });
    }
  }
  return points;
}
type Fetched = { rows: { t: number; close: number; volume: number }[]; ok: boolean };

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

const newestFirst = (rows: { t: number; close: number; volume: number }[]) =>
  rows.sort((a, b) => b.t - a.t);

async function fetchCoinbase(symbol: string, limit: number): Promise<Fetched> {
  const body = await fetchJson(
    `https://api.exchange.coinbase.com/products/${encodeURIComponent(symbol)}/candles?granularity=3600`,
  );
  const rows = Array.isArray(body) ? (body as unknown[][]) : null;
  if (!rows) return { rows: [], ok: false };
  // Formato: [time, low, high, open, close, volume] (más reciente primero).
  return {
    rows: rows.slice(0, limit).map((r) => ({
      t: Number(r[0]) * 1000,
      close: Number(r[4]),
      volume: Number(r[5]),
    })),
    ok: true,
  };
}

async function fetchKraken(symbol: string, limit: number): Promise<Fetched> {
  const body = await fetchJson(`https://api.kraken.com/0/public/OHLC?pair=${symbol}&interval=60`);
  const payload = body as { error?: string[]; result?: Record<string, unknown> } | null;
  if (!payload || (payload.error && payload.error.length) || !payload.result)
    return { rows: [], ok: false };
  const series = Object.entries(payload.result).find(([key]) => key !== "last");
  const list = series?.[1];
  if (!Array.isArray(list)) return { rows: [], ok: false };
  // Formato: [time(seg), open, high, low, close, vwap, volume, count].
  return {
    rows: (list as unknown[][])
      .slice(-limit)
      .map((r) => ({ t: Number(r[0]) * 1000, close: Number(r[4]), volume: Number(r[6]) })),
    ok: true,
  };
}

async function fetchBybit(symbol: string, limit: number): Promise<Fetched> {
  const body = await fetchJson(
    `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=60&limit=${limit}`,
  );
  const list = (body as { result?: { list?: unknown[][] } } | null)?.result?.list;
  if (!Array.isArray(list)) return { rows: [], ok: false };
  // Formato: [start, open, high, low, close, volume, turnover] (más reciente primero).
  return {
    rows: list.map((r) => ({ t: Number(r[0]), close: Number(r[4]), volume: Number(r[5]) })),
    ok: true,
  };
}

async function fetchOkx(symbol: string, limit: number): Promise<Fetched> {
  const body = await fetchJson(
    `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=1H&limit=${limit}`,
  );
  const payload = body as { code?: string; data?: unknown[][] } | null;
  if (!payload || payload.code !== "0" || !Array.isArray(payload.data))
    return { rows: [], ok: false };
  // Formato: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm].
  return {
    rows: payload.data.map((r) => ({ t: Number(r[0]), close: Number(r[4]), volume: Number(r[5]) })),
    ok: true,
  };
}

async function fetchKucoin(symbol: string, limit: number): Promise<Fetched> {
  const body = await fetchJson(
    `https://api.kucoin.com/api/v1/market/candles?type=1hour&symbol=${symbol}`,
  );
  const payload = body as { code?: string; data?: unknown[][] } | null;
  if (!payload || payload.code !== "200000" || !Array.isArray(payload.data))
    return { rows: [], ok: false };
  // Formato: [time(seg), open, close, high, low, volume, turnover] (más reciente primero).
  return {
    rows: payload.data.slice(0, limit).map((r) => ({
      t: Number(r[0]) * 1000,
      close: Number(r[2]),
      volume: Number(r[5]),
    })),
    ok: true,
  };
}

const FETCHERS: Partial<Record<ExchangeId, (s: string, l: number) => Promise<Fetched>>> = {
  coinbase: fetchCoinbase,
  kraken: fetchKraken,
  bybit: fetchBybit,
  okx: fetchOkx,
  kucoin: fetchKucoin,
};
/**
 * Ingesta pública de un exchange conectado. Nunca usa credenciales ni firmas.
 * `status` explica en el reporte por qué una fuente aporta 0 puntos.
 */
export async function ingestExchangePublic(
  exchange: ExchangeId,
  pairs: string[],
  limit = 72,
): Promise<ExchangeIngestResult> {
  const source = PUBLIC_MARKET_EXCHANGES[exchange];
  const fetcher = FETCHERS[exchange];
  if (!fetcher) return { id: exchange, source, points: [], status: "not_supported" };

  const mapped = pairs
    .slice(0, 4)
    .map((pair) => ({ pair: pair.toUpperCase(), symbol: symbolFor(exchange, pair) }))
    .filter((m): m is { pair: string; symbol: string } => Boolean(m.symbol));
  if (!mapped.length) return { id: exchange, source, points: [], status: "no_pairs" };

  const points: MarketPoint[] = [];
  let failures = 0;
  for (const { pair, symbol } of mapped) {
    const result = await fetcher(symbol, limit);
    if (!result.ok) {
      failures++;
      continue;
    }
    points.push(...toPoints(source, pair, newestFirst(result.rows)));
  }
  const status = points.length ? "connected" : failures ? "error" : "no_pairs";
  return { id: exchange, source, points, status };
}
