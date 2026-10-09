// Selector automático de activo por bot (Fase 3 · Auto).
//
// Server-only. No toca flags de trading real ni binance_trading_env (el
// entorno activo solo se LEE). No toca src/lib/strategies ni el tamaño de
// las operaciones: solo decide el PAR y lo aplica por la misma validación
// que updateBotStrategy (decidirCambioPar + par válido en el entorno).
//
// Datos: reutiliza el snapshot de listarMercados (ticker 24hr, caché 60 s).
// Nunca llama a klines por símbolo.

import type { ParMercado } from "./markets.server";

/* -------------------------------- CONSTANTES ------------------------------ */

/** Recorrido 24 h (tanto por uno) a partir del cual la volatilidad deja de sumar. */
export const TOPE_VOLATILIDAD = 0.15;
/** Cambio 24 h (puntos %) que equivale a momentum máximo. */
export const TOPE_MOMENTUM = 20;
/** Pesos de la puntuación (suman 1). */
export const PESO_VOLUMEN = 0.5;
export const PESO_VOLATILIDAD = 0.3;
export const PESO_MOMENTUM = 0.2;
/** El retador debe superar al par actual por este margen para cambiar. */
export const MARGEN_HISTÉRESIS = 0.05;
/** Intervalo mínimo entre cambios aplicados por el tick (el "Aplicar" manual lo salta). */
export const INTERVALO_MIN_MS = 60 * 60 * 1000;
/** Volumen 24 h mínimo (quote) cuando engine_config no existe o no responde. */
export const MIN_VOLUMEN_DEFAULT = 500_000;
/** Volumen mínimo por entorno cuando engine_config no responde (testnet mueve menos). */
export const MIN_VOLUMEN_POR_ENTORNO: Record<"testnet" | "production", number> = {
  testnet: 50_000,
  production: MIN_VOLUMEN_DEFAULT,
};
/** Solo esta cotización en v1 (operable con minNotional en USDT). */
export const QUOTE_AUTO = "USDT";
/** Cuántos mejores por score pasan el filtro de minNotional (evita N llamadas). */
export const TOP_REGLAS = 10;
/** Caché de reglas de símbolo (minutos): evita getBinanceSymbolRules por tick. */
export const REGLAS_CACHE_MS = 5 * 60 * 1000;

/* ---------------------------------- TIPOS --------------------------------- */

export type ComponentesScore = { volumen: number; volatilidad: number; momentum: number };

export type Candidato = {
  symbol: string;
  price: number;
  score: number;
  componentes: ComponentesScore;
};

export type MotivoSeleccion =
  | "mejor_candidato"
  | "par_actual_no_elegible"
  | "mantiene_actual"
  | "sin_candidatos"
  | "posicion_abierta"
  | "auto_apagado"
  | "intervalo_minimo"
  | "sin_mejora_suficiente"
  | "validacion_fallida";

export type ResultadoSeleccion = {
  elegido: Candidato | null;
  actual: Candidato | null;
  /** true si hay que aplicar el cambio (o ya se aplicó). */
  cambiar: boolean;
  motivo: MotivoSeleccion;
  detalle: string;
};

/* ------------------------------ PUNTUACIÓN ------------------------------- */

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Puntuación 0..1 = volumen 24 h normalizado + volatilidad con tope (un pump
 * extremo no domina) + momentum. El volumen se normaliza contra el máximo del
 * snapshot actual: la comparación SIEMPRE usa el mismo snapshot.
 */
export function puntuarPar(
  ticker: Pick<ParMercado, "quoteVolume" | "volatility" | "changePct">,
  maxQuoteVolume: number,
): { score: number; componentes: ComponentesScore } {
  const volumen = maxQuoteVolume > 0 ? clamp01(ticker.quoteVolume / maxQuoteVolume) : 0;
  const volatilidad = clamp01(ticker.volatility / TOPE_VOLATILIDAD);
  const momentum = clamp01(
    (Math.max(-TOPE_MOMENTUM, Math.min(TOPE_MOMENTUM, ticker.changePct)) / TOPE_MOMENTUM + 1) / 2,
  );
  const score = PESO_VOLUMEN * volumen + PESO_VOLATILIDAD * volatilidad + PESO_MOMENTUM * momentum;
  return { score, componentes: { volumen, volatilidad, momentum } };
}

/* -------------------------------- FILTROS --------------------------------- */

const STABLES = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "DAI",
  "USDP",
  "AEUR",
  "EUR",
  "GBP",
  "BRL",
  "ARS",
  "USDD",
  "XUSD",
]);

const SUFIJOS_APALANCADOS = ["UP", "DOWN", "BULL", "BEAR"];

/**
 * Excluye stablecoins/fiat (como base o como quote distinta de USDT) y pares
 * apalancados (BTCUPUSDT, ETHBEARUSDT...). Solo quote USDT en v1.
 */
export function esParElegible(symbol: string, base: string, quote: string): boolean {
  const s = symbol.toUpperCase();
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (q !== QUOTE_AUTO) return false;
  if (STABLES.has(b)) return false;
  for (const suf of SUFIJOS_APALANCADOS) {
    if (b.endsWith(suf)) return false;
    // Por si el exchangeInfo no trae base/quote: el nombre también delata.
    if (s.endsWith(`${suf}${QUOTE_AUTO}`)) return false;
  }
  return true;
}

/**
 * Candidatos ordenados por score: volumen mínimo, precio usable, elegible,
 * no asignado a otro bot. La intersección con el entorno activo ya viene
 * hecha en rows (listarMercados).
 */
export function filtrarCandidatos(
  rows: ParMercado[],
  opts: { minVolumen: number; paresOcupados: Set<string> },
): Candidato[] {
  const maxVol = rows.reduce((m, r) => Math.max(m, r.quoteVolume), 0);
  const out: Candidato[] = [];
  for (const r of rows) {
    if (!(r.price > 0)) continue;
    if (r.quoteVolume < opts.minVolumen) continue;
    if (!esParElegible(r.symbol, r.base, r.quote)) continue;
    if (opts.paresOcupados.has(r.symbol.toUpperCase())) continue;
    const { score, componentes } = puntuarPar(r, maxVol);
    out.push({ symbol: r.symbol, price: r.price, score, componentes });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/* ------------------------------- HISTÉRESIS ------------------------------- */

/**
 * Decide con el MISMO snapshot: recalcula la puntuación del par actual con los
 * datos actuales (el score guardado NO sirve: la normalización de volumen
 * cambia entre snapshots). Solo cambia si el retador supera al actual por el
 * margen y pasó el intervalo mínimo (el modo manual puede saltar el intervalo).
 */
export function decidirConHisteresis(
  actual: Candidato | null,
  mejor: Candidato | null,
  opts: { ahora: number; ultimoCambioEn: number | null; forzarIntervalo: boolean },
): ResultadoSeleccion {
  if (!mejor) {
    return {
      elegido: null,
      actual,
      cambiar: false,
      motivo: "sin_candidatos",
      detalle: "Sin candidatos: el bot conserva su par actual",
    };
  }
  if (!actual) {
    return {
      elegido: mejor,
      actual,
      cambiar: true,
      motivo: "par_actual_no_elegible",
      detalle: `${mejor.symbol} es el mejor candidato (${mejor.score.toFixed(3)}): el par actual ya no es elegible`,
    };
  }
  if (actual.symbol.toUpperCase() === mejor.symbol.toUpperCase()) {
    return {
      elegido: mejor,
      actual,
      cambiar: false,
      motivo: "mantiene_actual",
      detalle: `${actual.symbol} sigue siendo el mejor (${actual.score.toFixed(3)}): se mantiene`,
    };
  }
  if (mejor.score < actual.score * (1 + MARGEN_HISTÉRESIS)) {
    return {
      elegido: mejor,
      actual,
      cambiar: false,
      motivo: "sin_mejora_suficiente",
      detalle: `${mejor.symbol} (${mejor.score.toFixed(3)}) no supera a ${actual.symbol} (${actual.score.toFixed(3)}) por el margen del ${(MARGEN_HISTÉRESIS * 100).toFixed(0)} %: se mantiene`,
    };
  }
  if (
    !opts.forzarIntervalo &&
    opts.ultimoCambioEn !== null &&
    opts.ahora - opts.ultimoCambioEn < INTERVALO_MIN_MS
  ) {
    return {
      elegido: mejor,
      actual,
      cambiar: false,
      motivo: "intervalo_minimo",
      detalle: `${mejor.symbol} supera a ${actual.symbol}, pero el último cambio fue hace menos de 1 h: se mantiene`,
    };
  }
  return {
    elegido: mejor,
    actual,
    cambiar: true,
    motivo: "mejor_candidato",
    detalle: `${mejor.symbol} (${mejor.score.toFixed(3)}) supera a ${actual.symbol} (${actual.score.toFixed(3)}): cambio`,
  };
}

/* --------------------------- REGLAS CON CACHÉ ----------------------------- */

export type ReglasAuto = {
  stepSize: number;
  minQty: number;
  minNotional: number;
  fallback: boolean;
};

const reglasCache = new Map<string, { at: number; reglas: ReglasAuto }>();

export async function reglasSimbolo(
  symbol: string,
  env: "testnet" | "production",
): Promise<ReglasAuto> {
  const key = `${env}:${symbol.toUpperCase()}`;
  const hit = reglasCache.get(key);
  if (hit && Date.now() - hit.at < REGLAS_CACHE_MS) return hit.reglas;
  const { getBinanceSymbolRules } = await import("./binance-trading.server");
  const r = await getBinanceSymbolRules(symbol, env);
  const reglas: ReglasAuto = {
    stepSize: r.stepSize,
    minQty: r.minQty,
    minNotional: r.minNotional,
    fallback: r.fallback,
  };
  reglasCache.set(key, { at: Date.now(), reglas });
  return reglas;
}

/** El capital del bot debe cubrir minNotional y minQty al precio actual. */
export function cumpleMinNotional(
  capital: number,
  price: number,
  reglas: { stepSize: number; minQty: number; minNotional: number },
): boolean {
  if (!(capital > 0) || !(price > 0)) return false;
  if (capital < reglas.minNotional) return false;
  const qty = Math.floor(capital / price / reglas.stepSize) * reglas.stepSize;
  return qty >= reglas.minQty;
}
