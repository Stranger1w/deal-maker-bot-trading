/**
 * DATOS REALES DE TRADERS (Binance Futures, endpoints publicos).
 *
 * QUE SON
 *  - `topLongShortPositionRatio`: el ratio long/short de las CUENTAS CON LAS
 *    POSICIONES MAS GRANDES. Es exactamente el "copy trading" de traders
 *    reales: lo que hacen las cuentas grandes.
 *  - `takerlongshortRatio`: el volumen agresivo de compra frente al de venta
 *    (dinero real moviendose).
 *  - `globalLongShortAccountRatio`: el ratio de TODAS las cuentas, para
 *    contrastar (a veces los grandes van en contra de la multitud).
 *
 * DE DONDE SALEN
 * La API publica de Binance Futures (fapi.binance.com/futures/data/...).
 * Sin claves y sin credenciales. Da unos 30 dias de historico y se pagina
 * con `endTime`.
 *
 * POR QUE FUTURES Y NO SPOT
 * Estos datos son de futuros y el precio con el que se compara tambien: si
 * se mezclaran precios de spot con flujo de futuros, la medicion seria
 * incoherente.
 */

import {
  AUX_TRADERS_GLOBAL,
  AUX_TRADERS_TAKER,
  AUX_TRADERS_TOP,
  alinearSerie,
  unirAux,
  type DatoTraders,
  type SeriesTraders,
} from "./indicators/auxiliares";

const HOST = "https://fapi.binance.com/futures/data";

/** Periodos validos de la API. */
export type PeriodoTraders = "5m" | "15m" | "30m" | "1h" | "2h" | "4h" | "6h" | "12h" | "1d";

/** Cuantos datos trae la API por peticion. */
const LIMITE_PETICION = 500;

/** Cache en memoria (los datos cambian cada hora como mucho). */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { series: SeriesTraders; at: number }>();

type FilaCruda = {
  timestamp: number;
  longShortRatio?: string;
  buySellRatio?: string;
};

/** Descarga una pagina del endpoint indicado. */
async function pagina(
  endpoint: string,
  simbolo: string,
  periodo: PeriodoTraders,
  endTime: number,
): Promise<FilaCruda[]> {
  const url = `${HOST}/${endpoint}?symbol=${encodeURIComponent(simbolo)}&period=${periodo}&limit=${LIMITE_PETICION}&endTime=${endTime}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return [];
  const cuerpo = (await res.json()) as FilaCruda[];
  return Array.isArray(cuerpo) ? cuerpo : [];
}

/** Convierte las filas crudas en datos con tiempo y valor. */
function aDatos(filas: FilaCruda[], campo: "longShortRatio" | "buySellRatio"): DatoTraders[] {
  const datos: DatoTraders[] = [];
  for (const fila of filas) {
    const valor = Number(fila[campo]);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    datos.push({ time: Number(fila.timestamp), valor });
  }
  return datos.sort((a, b) => a.time - b.time);
}

/**
 * Descarga (con paginacion) toda la serie disponible de traders.
 *
 * @param simbolo par (BTCUSDT...)
 * @param periodo resolucion de los datos
 * @param maximoPuntos tope de puntos por serie (para no abusear de la API)
 */
export async function obtenerSeriesTraders(
  simbolo: string,
  periodo: PeriodoTraders = "1h",
  maximoPuntos = 1000,
): Promise<SeriesTraders> {
  const clave = `${simbolo}:${periodo}:${maximoPuntos}`;
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.at < CACHE_MS) return guardado.series;

  const vacias: SeriesTraders = { top: [], taker: [], global: [] };
  let fin = Date.now();
  let puntos = 0;

  const top: DatoTraders[] = [];
  const taker: DatoTraders[] = [];
  const global: DatoTraders[] = [];

  // Se pagina hacia atras con endTime hasta llenar el maximo o no quedar mas.
  for (let paginaActual = 0; paginaActual < 6 && puntos < maximoPuntos; paginaActual++) {
    const [filasTop, filasTaker, filasGlobal] = await Promise.all([
      pagina("topLongShortPositionRatio", simbolo, periodo, fin),
      pagina("takerlongshortRatio", simbolo, periodo, fin),
      pagina("globalLongShortAccountRatio", simbolo, periodo, fin),
    ]);
    if (!filasTop.length && !filasTaker.length && !filasGlobal.length) break;
    top.unshift(...aDatos(filasTop, "longShortRatio"));
    taker.unshift(...aDatos(filasTaker, "buySellRatio"));
    global.unshift(...aDatos(filasGlobal, "longShortRatio"));
    const masAntigua = Math.min(
      ...[filasTop, filasTaker, filasGlobal]
        .flat()
        .map((f) => Number(f.timestamp))
        .filter((t) => Number.isFinite(t)),
    );
    if (!Number.isFinite(masAntigua)) break;
    fin = masAntigua - 1;
    puntos = Math.max(top.length, taker.length, global.length);
  }

  const series: SeriesTraders = {
    top: top.slice(-maximoPuntos),
    taker: taker.slice(-maximoPuntos),
    global: global.slice(-maximoPuntos),
  };
  cache.set(clave, { series, at: Date.now() });
  return series;
}

/**
 * Alinea las series de traders con unas velas concretas (por tiempo).
 * Devuelve el mapa `aux` que entiende el motor.
 */
export function alinearTradersConVelas(
  velas: ReadonlyArray<{ time: number }>,
  series: SeriesTraders,
): Record<string, number[]> {
  return unirAux([
    alinearSerie(velas, series.top, AUX_TRADERS_TOP),
    alinearSerie(velas, series.taker, AUX_TRADERS_TAKER),
    alinearSerie(velas, series.global, AUX_TRADERS_GLOBAL),
  ]);
}

/** ¿Este par tiene datos de traders disponibles? */
export function soportaTraders(simbolo: string): boolean {
  // Los endpoints de Binance Futures cubren los pares de futuros perpetuos.
  return /^[A-Z]{2,10}USDT$/.test(simbolo.toUpperCase());
}
