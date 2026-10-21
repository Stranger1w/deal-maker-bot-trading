/**
 * SERIES EXTRA: datos que NO vienen del precio.
 *
 * Los indicadores tecnicos (RSI, MACD...) solo necesitan velas. Los de
 * "seguir a los traders grandes" necesitan OTRA cosa: lo que estan haciendo
 * las cuentas grandes y el flujo real de ordenes. Eso llega en series
 * alineadas con las velas, y viaja en `PriceSeries.aux`.
 *
 * Se mantiene el diseno de indicadores puros: la serie llega ya alineada y
 * el indicador solo la lee. Si no hay datos, el indicador devuelve null
 * (no inventa).
 */

/** Claves de las series auxiliares. */
export const AUX_TRADERS_TOP = "traders_top_long_short";
export const AUX_TRADERS_TAKER = "traders_taker_buy_sell";
export const AUX_TRADERS_GLOBAL = "traders_global_long_short";
/** Desviacion del precio frente a la mediana de los otros mercados (%). */
export const AUX_PRECIO_FAIR = "precio_desviacion_pct";

/** Un dato de traders con su marca de tiempo. */
export type DatoTraders = {
  /** Milisegundos epoch. */
  time: number;
  /** Valor (ratio long/short, o ratio de compra/venta). */
  valor: number;
};

/** Serie de datos de traders por clave, ordenada de mas antigua a mas reciente. */
export type SeriesTraders = {
  /** Ratio long/short de las cuentas con las posiciones mas grandes. */
  top: DatoTraders[];
  /** Ratio de volumen de compra agresiva frente a venta agresiva. */
  taker: DatoTraders[];
  /** Ratio long/short de TODAS las cuentas (para contrastar). */
  global: DatoTraders[];
};

/**
 * Alinea una serie de traders con las velas: para cada vela se toma el
 * ultimo dato conocido ANTERIOR o IGUAL a la apertura de la vela (nunca se
 * mira el futuro).
 *
 * @param velas velas con su `time` (ms epoch)
 * @param datos serie de traders
 * @param clave clave en la que se guarda
 */
export function alinearSerie(
  velas: ReadonlyArray<{ time: number }>,
  datos: readonly DatoTraders[],
  clave: string,
): Record<string, number[]> {
  const alineados: number[] = [];
  let cursor = 0;
  let ultimo: number | null = null;
  for (const vela of velas) {
    while (cursor < datos.length && (datos[cursor]?.time ?? 0) <= vela.time) {
      ultimo = datos[cursor]?.valor ?? ultimo;
      cursor++;
    }
    alineados.push(ultimo ?? Number.NaN);
  }
  return { [clave]: alineados };
}

/** Une varias alineaciones en un solo mapa. */
export function unirAux(partes: Array<Record<string, number[]>>): Record<string, number[]> {
  const salida: Record<string, number[]> = {};
  for (const parte of partes) {
    for (const [clave, valores] of Object.entries(parte)) salida[clave] = valores;
  }
  return salida;
}

/**
 * Ultimo valor util de una serie auxiliar (los NaN son "aun no hay dato").
 * Devuelve null si no hay ninguno.
 */
export function ultimoValor(serie: number[] | undefined): number | null {
  if (!serie || serie.length === 0) return null;
  for (let i = serie.length - 1; i >= 0; i--) {
    const v = serie[i];
    if (v !== undefined && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Ultimos `n` valores utiles (los NaN se descartan, pero se conserva el
 * orden). Devuelve menos de `n` si no hay suficientes.
 */
export function ultimosUtiles(serie: number[] | undefined, n: number): number[] {
  if (!serie) return [];
  const utiles = serie.filter((v) => Number.isFinite(v));
  return utiles.length <= n ? utiles : utiles.slice(-n);
}
