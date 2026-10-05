/**
 * Registro de indicadores.
 *
 * El orden es el que ve el usuario en el modal: el AI primero (arriba, con su
 * boton "Activar"), luego los tecnicos y al final el de cierre, que es el
 * indicador por defecto.
 */

import { aiIndicator } from "./ai-indicator";
import { bollinger } from "./bollinger";
import { closePrice } from "./close-price";
import { cci } from "./cci";
import { macd } from "./macd";
import { rsi } from "./rsi";
import { stochastic } from "./stochastic";
import type { IndicatorDef, IndicatorTipo, PriceSeries, SignalDirection } from "./types";

export const INDICADORES: IndicatorDef[] = [
  aiIndicator,
  macd,
  stochastic,
  bollinger,
  rsi,
  cci,
  closePrice,
];

/** El indicador por defecto si el usuario no elige ninguno. */
export const INDICADOR_POR_DEFECTO = "close_price";

export function buscarIndicador(id: string): IndicatorDef | null {
  return INDICADORES.find((i) => i.id === id) ?? null;
}

/** Ids validos, para validar lo que llega de la base de datos. */
export function idsValidos(): string[] {
  return INDICADORES.map((i) => i.id);
}

/**
 * Combina varias senales: solo se emite si TODAS coinciden.
 *
 * Asi se cumple la regla de la UI: al seleccionar varios indicadores, la senal
 * solo sale cuando todos apuntan al mismo lado. Si uno dice buy y otro sell, no
 * hay senal y el motor mantiene la posicion.
 */
export function combineSignals(senales: SignalDirection[]): SignalDirection {
  if (senales.length === 0) return null;
  const todasBuy = senales.every((s) => s === "buy");
  const todasSell = senales.every((s) => s === "sell");
  if (todasBuy) return "buy";
  if (todasSell) return "sell";
  return null;
}

/**
 * Tipos presentes en una seleccion, para el aviso del modal.
 *
 * Los de tipo `filtro` (AI Indicator) NO cuentan: no generan senal propia, asi
 * que no se oponen a nadie y no deben disparar el aviso de mezcla.
 */
export function tiposDe(seleccion: IndicatorDef[]): {
  tendencia: boolean;
  reversion: boolean;
} {
  const conSenal = seleccion.filter((i) => i.tipo !== "filtro");
  return {
    tendencia: conSenal.some((i) => i.tipo === "tendencia"),
    reversion: conSenal.some((i) => i.tipo === "reversion"),
  };
}

/**
 * Aplica los indicadores seleccionados a una serie y devuelve la senal combinada.
 * Si la seleccion esta vacia, no hay senal (no se inventa un default en caliente).
 */
export function senalDe(
  ids: string[],
  series: PriceSeries,
  paramsPorIndicador: Record<string, Record<string, number>> = {},
): SignalDirection {
  if (ids.length === 0) return null;
  const senales: SignalDirection[] = [];
  for (const id of ids) {
    const def = buscarIndicador(id);
    if (!def) continue;
    senales.push(def.signal(series, paramsPorIndicador[id] ?? {}));
  }
  if (senales.length === 0) return null;
  return combineSignals(senales);
}

export type { IndicatorDef, IndicatorTipo, PriceSeries, SignalDirection };
export { aiIndicator, bollinger, cci, closePrice, macd, rsi, stochastic };
export { cerradas, desviacionPoblacional, ema, media, sma, ultimos } from "./helpers";
