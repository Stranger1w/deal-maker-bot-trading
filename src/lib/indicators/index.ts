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
import { emaCruzamiento } from "./ema-cruzamiento";
import { macd } from "./macd";
import { precioJusto } from "./precio-justo";
import { rsi } from "./rsi";
import { stochastic } from "./stochastic";
import { takerFlow, topTraders } from "./traders";
import type { IndicatorDef, IndicatorTipo, PriceSeries, SignalDirection } from "./types";

export const INDICADORES: IndicatorDef[] = [
  aiIndicator,
  topTraders,
  takerFlow,
  precioJusto,
  macd,
  stochastic,
  bollinger,
  rsi,
  cci,
  emaCruzamiento,
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
 * Combina varias senales con umbral de consenso.
 *
 * En lugar de exigir que TODOS los indicadores coincidan (AND estricto), se
 * requiere que al menos `umbral` (0 a 1) de los indicadores con senal no nula
 * estén de acuerdo. Esto permite usar varios indicadores sin que se maten
 * entre si: por ejemplo, con 3 indicadores y umbral 0.66, bastan 2 de 3 para
 * emitir senal.
 *
 * Los indicadores que devuelven null (sin senal) no cuentan ni a favor ni en
 * contra: solo se considera la proporcion de los que tienen opinion.
 *
 * @param senales - senales de cada indicador (pueden ser null)
 * @param umbral - proporcion minima de acuerdo requerida (0.5 = mayoria, 1.0 = unanimidad)
 * @returns "buy" si el umbral de buy se cumple, "sell" si el de sell, null si ninguno
 */
export function combinarSenalesConUmbral(
  senales: SignalDirection[],
  umbral: number = 0.66,
): SignalDirection {
  if (senales.length === 0) return null;
  if (umbral <= 0 || umbral > 1) throw new Error("umbral debe estar entre 0 y 1");

  const conSenal = senales.filter((s) => s !== null);
  if (conSenal.length === 0) return null;

  const buyCount = conSenal.filter((s) => s === "buy").length;
  const sellCount = conSenal.filter((s) => s === "sell").length;
  const total = conSenal.length;

  const umbralBuy = Math.ceil(total * umbral);
  const umbralSell = Math.ceil(total * umbral);

  if (buyCount >= umbralBuy) return "buy";
  if (sellCount >= umbralSell) return "sell";
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
 *
 * @param umbralConsenso - proporcion minima de indicadores que deben estar de
 *   acuerdo para emitir senal (0.5 = mayoria simple, 1.0 = unanimidad).
 *   Si no se indica, se usa unanimidad (comportamiento anterior).
 */
export function senalDe(
  ids: string[],
  series: PriceSeries,
  paramsPorIndicador: Record<string, Record<string, number>> = {},
  umbralConsenso?: number,
): SignalDirection {
  if (ids.length === 0) return null;
  const senales: SignalDirection[] = [];
  for (const id of ids) {
    const def = buscarIndicador(id);
    if (!def) continue;
    senales.push(def.signal(series, paramsPorIndicador[id] ?? {}));
  }
  if (senales.length === 0) return null;
  if (umbralConsenso !== undefined) {
    return combinarSenalesConUmbral(senales, umbralConsenso);
  }
  return combineSignals(senales);
}

export type { IndicatorDef, IndicatorTipo, PriceSeries, SignalDirection };
export {
  aiIndicator,
  bollinger,
  cci,
  closePrice,
  emaCruzamiento,
  macd,
  precioJusto,
  rsi,
  stochastic,
  takerFlow,
  topTraders,
};
export { cerradas, desviacionPoblacional, ema, media, sma, ultimos } from "./helpers";
export {
  AUX_TRADERS_GLOBAL,
  AUX_PRECIO_FAIR,
  AUX_TRADERS_TAKER,
  AUX_TRADERS_TOP,
  alinearSerie,
  unirAux,
  ultimoValor,
  ultimosUtiles,
} from "./auxiliares";
