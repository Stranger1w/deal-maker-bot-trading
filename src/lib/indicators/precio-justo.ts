/**
 * INDICADOR DE "PRECIO JUSTO" (multi-mercado).
 *
 * QUE MIDE
 * La diferencia entre el precio del mercado donde se opera (Binance) y la
 * MEDIANA del precio del mismo par en el resto de mercados. Si un mercado se
 * va de precio respecto a todos los demas, normalmente vuelve: es un
 * arbitraje entre mercados y una reversión a la media, con datos de verdad
 * (13 mercados: Binance, Bybit, OKX, Hyperliquid, Kraken, Coinbase,
 * Bitstamp, KuCoin, Gate.io, Bitfinex, Crypto.com y Bitget).
 *
 * POR QUE ES INTERESANTE
 * - No necesita volumen ni indicadores: mira el precio de otros mercados.
 * - Es un dato publico y de libre acceso: cualquiera lo puede replicar.
 * - Se puede MEDIR: el backtest dice si de verdad funciona o no. La
 *   respuesta hasta ahora: casi nada (ver el veredicto del backtest).
 *
 * REGLAS
 * - Si no hay datos de otros mercados, NO hay senal (nunca se inventa).
 * - Solo se mira lo que ya se sabia en la apertura de la vela (nada de futuro).
 */

import { ultimoValor, ultimosUtiles } from "./auxiliares";
import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

/** Clave de la serie auxiliar con la desviacion (en %) frente a la mediana. */
export const AUX_PRECIO_FAIR = "precio_desviacion_pct";

/**
 * Desviacion del precio del mercado frente a la mediana de los demas.
 *
 * Compra cuando el precio esta MAS BARATO que la mediana (se espera que
 * suba) y vende cuando esta mas caro (se espera que baje).
 */
export const precioJusto: IndicatorDef = {
  id: "precio_justo",
  nombre: "Precio justo (otros mercados)",
  tipo: "reversion",
  descripcionCorta: "Compara el precio con la mediana de los otros mercados.",
  detalles: {
    queMide:
      "La diferencia en % entre el precio del par en el mercado donde operas y la mediana del mismo par en 12 mercados mas. Es dinero real: si un mercado se aleja del resto, suele volver.",
    comoSenala:
      "Compra cuando el precio esta por debajo de la mediana (umbral negativo) y vende cuando esta por encima (umbral positivo).",
    cuandoFalla:
      "Si no hay datos de los otros mercados para ese par o periodo, no hay señal (no se rellena con nada).",
    aviso:
      "La reversión a la media funciona a largo plazo, no en cada movimiento: los costes de cada operación se comen el margen. Mídelo antes de fiarte.",
  },
  parametros: [
    {
      key: "umbral",
      label: "Desviación típica (z)",
      value: 1.5,
      min: 0.5,
      max: 4,
      step: 0.1,
      help: "A 1,5 el precio esta 1,5 desviaciones tipicas por encima o por debajo de su media: se compra en el extremo bajo y se vende en el alto.",
    },
    {
      key: "ventana",
      label: "Ventana de lectura (velas)",
      value: 60,
      min: 10,
      max: 240,
      step: 10,
      help: "Cuántas velas se usan para medir la prima media y su desviación.",
    },
  ],
  minSamples: 30,
  signal: (series: PriceSeries, params: Record<string, number>): SignalDirection => {
    const datos = series.aux?.[AUX_PRECIO_FAIR];
    if (!datos) return null;
    const ventana = Math.max(10, Math.round(params["ventana"] ?? 60));
    const ultimos = ultimosUtiles(datos, ventana);
    if (ultimos.length < Math.min(ventana, 30)) return null;
    const actual = ultimos[ultimos.length - 1]!;
    // La prima se mide contra SU PROPIA media: el mercado de referencia suele
    // cotizar un pelo por encima de la mediana de los demas (desviacion
    // sistemica), asi que un umbral sobre cero no daria senal de compra nunca.
    const media = ultimos.reduce((s, v) => s + v, 0) / ultimos.length;
    const varianza = ultimos.reduce((s, v) => s + (v - media) * (v - media), 0) / ultimos.length;
    const desv = Math.sqrt(varianza);
    if (!(desv > 0)) return null;
    const z = (actual - media) / desv;
    const umbral = Math.max(0.5, params["umbral"] ?? 1.5);
    // El z-score ya dice si la prima esta alta o baja: no hace falta
    // exigir ademas que este bajando (eso dejaba la senal en nada).
    if (z <= -umbral) return "buy";
    if (z >= umbral) return "sell";
    return null;
  },
};

/** El ultimo valor util de la serie (para la interfaz). */
export function ultimaDesviacion(series: PriceSeries): number | null {
  return ultimoValor(series.aux?.[AUX_PRECIO_FAIR]);
}
