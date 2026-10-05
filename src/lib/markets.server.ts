// Mercados (Fase 2 · UI): lectura pública de Binance para la pestaña Mercados.
//
// Reglas de este módulo:
//  - Solo lectura: /api/v3/ticker/24hr no necesita API key y aquí nunca se firma
//    ni se escribe nada en Binance. No toca flags de trading real ni
//    binance_trading_env (el entorno activo solo se LEE con resolveBinanceTradingEnv).
//  - La petición sin símbolo pesa 80 en el contador de peso de Binance, así que
//    el resultado se cachea 60 s por entorno activo.
//  - Los pares se recortan al entorno activo (testnet o producción): el ticker y
//    exchangeInfo se piden al host del entorno (BINANCE_HOSTS) y se cruzan allí
//    mismo, de modo que solo se muestran pares que existen y están TRADING en ese
//    entorno. El cruce usa el mismo exchangeInfo que consulta
//    getBinanceSymbolRules (1 petición masiva en lugar de N individuales) y
//    getBinanceSymbolRules se usa aparte para validar el par concreto al
//    asignarlo a un bot (validarParMercado).
//  - Sin favoritos ni selector automático: eso es Fase 3 (market_favorites queda
//    intacta).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Par de 24 h normalizado para la tabla de Mercados. */
export type ParMercado = {
  symbol: string;
  base: string;
  quote: string;
  /** Último precio (lastPrice). */
  price: number;
  /** Cambio 24 h en puntos porcentuales (Binance ya lo devuelve en %). */
  changePct: number;
  /** Volumen 24 h en activo de cotización (quoteVolume). */
  quoteVolume: number;
  high: number;
  low: number;
  /** (high − low) / price en tanto por uno (0.043 = 4,3 % de recorrido). */
  volatility: number;
};

/** Instantánea que devuelve la pestaña Mercados. */
export type MercadosSnapshot = {
  env: "testnet" | "production";
  /** Momento de la lectura; la caché reutiliza la primera dentro de los 60 s. */
  fetchedAt: string;
  rows: ParMercado[];
  /** Aviso legible cuando Binance no respondió o no devolvió pares. */
  aviso: string | null;
};

/** Caducidad de la caché: el ticker sin símbolo pesa 80, no se refresca a cada render. */
export const TICKER_CACHE_MS = 60_000;

type TickerCrudo = {
  symbol: string;
  price: number;
  changePct: number;
  quoteVolume: number;
  high: number;
  low: number;
};

type InfoSimbolo = { base: string; quote: string };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Normaliza un par al formato que usan bots, motor y Binance: MAYÚSCULAS sin
 * separador ("BTCUSDT", no "BTC/USDT" ni "btc-usdt"). Quito espacios, barras,
 * guiones y guiones bajos para que "BTC/USDT", "btc-usdt" o " btcusdt "
 * asignen igual que "BTCUSDT".
 */
export function normalizarSimbolo(par: string): string {
  return par.toUpperCase().replace(/[\s/\-_]/g, "");
}

/**
 * Decisión pura del guard de cambio de par (sin BD ni red): si el par
 * normalizado no cambia, el cambio es válido; si cambia con posición abierta,
 * se bloquea con el motivo a mostrar; si cambia sin posición abierta, es válido.
 */
export function decidirCambioPar(
  parActual: string,
  parNuevo: string,
  posicionAbierta: boolean,
): { valido: boolean; motivo: string | null } {
  const actual = normalizarSimbolo(parActual);
  const nuevo = normalizarSimbolo(parNuevo);
  if (actual === nuevo) return { valido: true, motivo: null };
  if (posicionAbierta) {
    return {
      valido: false,
      motivo: `El bot tiene una posición abierta en ${actual}: cierra la posición antes de cambiar al par ${nuevo}`,
    };
  }
  return { valido: true, motivo: null };
}

/** Recorrido 24 h sobre el precio; 0 si el precio no es usable. */
export function calcularVolatilidad(high: number, low: number, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.max(0, high - low) / price;
}

/** Convierte la respuesta (array) de /api/v3/ticker/24hr en tickers crudos válidos. */
export function leerTickers(body: unknown): TickerCrudo[] {
  if (!Array.isArray(body)) return [];
  const out: TickerCrudo[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const symbol = typeof raw["symbol"] === "string" ? raw["symbol"] : "";
    const price = num(raw["lastPrice"]);
    if (!symbol || !Number.isFinite(price) || price <= 0) continue;
    out.push({
      symbol,
      price,
      changePct: num(raw["priceChangePercent"]) || 0,
      quoteVolume: num(raw["quoteVolume"]) || 0,
      high: num(raw["highPrice"]) || 0,
      low: num(raw["lowPrice"]) || 0,
    });
  }
  return out;
}

/**
 * Índice de pares del entorno activo desde /api/v3/exchangeInfo: solo status
 * TRADING, con base/quote reales (no se infieren del nombre del símbolo).
 */
export function leerSimbolosEntorno(body: unknown): Map<string, InfoSimbolo> {
  const out = new Map<string, InfoSimbolo>();
  const symbols =
    body && typeof body === "object" ? (body as Record<string, unknown>)["symbols"] : undefined;
  if (!Array.isArray(symbols)) return out;
  for (const item of symbols) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    if (raw["status"] !== "TRADING") continue;
    const symbol = typeof raw["symbol"] === "string" ? raw["symbol"] : "";
    const base = typeof raw["baseAsset"] === "string" ? raw["baseAsset"] : "";
    const quote = typeof raw["quoteAsset"] === "string" ? raw["quoteAsset"] : "";
    if (!symbol || !base || !quote) continue;
    out.set(symbol, { base, quote });
  }
  return out;
}

/**
 * Cruza tickers con los pares del entorno: lo que no exista (o no esté TRADING)
 * en el entorno activo no se muestra. Devuelve también la volatilidad.
 */
export function normalizarMercado(
  tickers: TickerCrudo[],
  simbolos: Map<string, InfoSimbolo>,
): ParMercado[] {
  const out: ParMercado[] = [];
  for (const t of tickers) {
    const info = simbolos.get(t.symbol);
    // Sin intersección no hay fila; precio no usable (0, negativo, NaN) tampoco:
    // la fila no sirve para operar ni para la volatilidad (divide por precio).
    if (!info || !(t.price > 0)) continue;
    out.push({
      symbol: t.symbol,
      base: info.base,
      quote: info.quote,
      price: t.price,
      changePct: t.changePct,
      quoteVolume: t.quoteVolume,
      high: t.high,
      low: t.low,
      volatility: calcularVolatilidad(t.high, t.low, t.price),
    });
  }
  return out;
}

/* ------------------------------- CACHÉ 60 s ------------------------------- */

const cache = new Map<string, { at: number; snapshot: MercadosSnapshot }>();

/* ---------------------------- SERVER FUNCTIONS ---------------------------- */

/**
 * Pares con ticker 24 h del entorno activo (testnet o producción), recortados a
 * los que existen realmente en ese entorno. Público: sin API key.
 */
export const listarMercados = createServerFn({ method: "POST" }).handler(
  async (): Promise<MercadosSnapshot> => {
    const { BINANCE_HOSTS, resolveBinanceTradingEnv } = await import("./binance-trading.server");
    const { GEO_RESTRICTED_MESSAGE, isBinanceGeoRestricted, safeBinanceError } =
      await import("./binance-region");
    const env = await resolveBinanceTradingEnv();

    const hit = cache.get(env);
    if (hit && Date.now() - hit.at < TICKER_CACHE_MS) return hit.snapshot;

    const host = BINANCE_HOSTS[env];
    const fetchedAt = new Date().toISOString();
    try {
      const [tickersRes, infoRes] = await Promise.all([
        fetch(`${host}/api/v3/ticker/24hr`, { signal: AbortSignal.timeout(15_000) }),
        fetch(`${host}/api/v3/exchangeInfo`, { signal: AbortSignal.timeout(15_000) }),
      ]);
      for (const res of [tickersRes, infoRes]) {
        if (res.ok) continue;
        const body = await res.text();
        if (isBinanceGeoRestricted(res.status, body)) throw new Error(GEO_RESTRICTED_MESSAGE);
        throw new Error(`Binance respondió ${res.status}: ${safeBinanceError(res.status, body)}`);
      }
      const tickers = leerTickers(await tickersRes.json());
      const simbolos = leerSimbolosEntorno(await infoRes.json());
      const rows = normalizarMercado(tickers, simbolos);
      const snapshot: MercadosSnapshot = {
        env,
        fetchedAt,
        rows,
        aviso: rows.length
          ? null
          : "Binance no devolvió pares con datos en este entorno; se reintenta en la próxima lectura.",
      };
      // Solo se cachea el éxito: un error no debe congelar la página 60 s.
      cache.set(env, { at: Date.now(), snapshot });
      return snapshot;
    } catch (e) {
      return {
        env,
        fetchedAt,
        rows: [],
        aviso: e instanceof Error ? e.message : "No se pudieron leer los mercados de Binance.",
      };
    }
  },
);

/**
 * Valida un par concreto contra el entorno activo con getBinanceSymbolRules
 * (exchangeInfo del host del entorno, sin credenciales). Se usa al asignar el
 * par a un bot para no aplicar pares que no existan en el entorno activo.
 */
export const validarParMercado = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ symbol: z.string().min(3).max(24) }).parse(input))
  .handler(async ({ data }) => {
    const { getBinanceSymbolRules, resolveBinanceTradingEnv } =
      await import("./binance-trading.server");
    const symbol = data.symbol.toUpperCase();
    const env = await resolveBinanceTradingEnv();
    const rules = await getBinanceSymbolRules(symbol, env);
    // fallback === Binance no reconoció el símbolo (o la red falló): no se puede
    // confirmar que el par exista en el entorno activo.
    const ok = !rules.fallback;
    return {
      env,
      ok,
      motivo: ok
        ? null
        : `Binance no reconoce ${symbol} en ${env} (o no respondió): el par no existe en el entorno activo`,
    };
  });
