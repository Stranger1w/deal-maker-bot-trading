/**
 * INDICADORES DE "COPY TRADING" DE TRADERS REALES.
 *
 * QUE SON
 * - `top_traders`: el posicionamiento de las cuentas con las posiciones MAS
 *   GRANDES de Binance Futures (la API publica de Binance lo llama "top
 *   trader long/short ratio"). Si los grandes estan claramente comprados, la
 *   idea es acompanarlos; si estan vendidos, cerrar.
 * - `taker_flow`: el flujo real de ordenes: cuanto volumen se compro de
 *   forma agresiva (contra la oferta) frente a cuanto se vendio. Es dinero
 *   real moviendose, no un calculo matematico sobre el precio.
 *
 * POR QUE NO ES MAGIA
 * Copiar a los grandes puede ser rentable o no: eso lo decide el backtest
 * con datos reales, y la respuesta hasta ahora es que no (no superan al
 * mercado ni a la referencia aleatoria). Estos indicadores solo aportan la
 * senal; el veredicto lo pone la medicion.
 *
 * REGLAS
 * - Si no hay datos de traders, NO hay senal (nunca se inventa).
 * - Solo se mira lo que ya se sabia en la apertura de la vela (nada de futuro).
 */

import { AUX_TRADERS_TAKER, AUX_TRADERS_TOP, ultimoValor, ultimosUtiles } from "./auxiliares";
import { sma } from "./helpers";
import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

/**
 * Posicionamiento de los traders grandes.
 *
 * Compra cuando el ratio long/short de las cuentas grandes esta por encima
 * del umbral (estan netamente comprados) y no se esta debilitando.
 * Vende (cierra) cuando esta por debajo del inverso del umbral.
 */
export const topTraders: IndicatorDef = {
  id: "top_traders",
  nombre: "Posicionamiento de los traders grandes",
  tipo: "tendencia",
  descripcionCorta: "Sigue la posición de las cuentas más grandes de Binance.",
  detalles: {
    queMide:
      "El ratio long/short de las cuentas con las posiciones más grandes (dato público de Binance Futures: 'top trader long/short ratio').",
    comoSenala:
      "Compra cuando están claramente comprados (ratio por encima del umbral) y el dato no se está debilitando; cierra cuando están claramente vendidos.",
    cuandoFalla:
      "Si no hay datos de traders para ese par o periodo, no hay señal (no se rellena con nada).",
    aviso:
      "Copiar a los grandes puede ser rentable o no: el backtest lo dice con números. No presupongas que funciona.",
  },
  parametros: [
    {
      key: "umbral",
      label: "Umbral long/short",
      value: 1.15,
      min: 1.01,
      max: 3,
      step: 0.05,
      help: "Por encima de este ratio los grandes están comprados; por debajo de su inverso, vendidos.",
    },
    {
      key: "ventana",
      label: "Lecturas para confirmar",
      value: 3,
      min: 1,
      max: 12,
      step: 1,
      help: "Cuántas lecturas seguidas deben ir en la misma dirección.",
    },
  ],
  minSamples: 3,
  signal: (series: PriceSeries, params: Record<string, number>): SignalDirection => {
    const datos = series.aux?.[AUX_TRADERS_TOP];
    if (!datos) return null;
    const ultimos = ultimosUtiles(datos, Math.max(1, Math.round(params["ventana"] ?? 3)));
    if (ultimos.length < Math.max(1, Math.round(params["ventana"] ?? 3))) return null;
    const actual = ultimos[ultimos.length - 1]!;
    const umbral = Math.max(1.01, params["umbral"] ?? 1.15);

    // ¿La tendencia de las ultimas lecturas va en la misma direccion?
    const primero = ultimos[0]!;
    const subiendo = actual >= primero;
    const bajando = actual <= primero;

    if (actual > umbral && subiendo) return "buy";
    if (actual < 1 / umbral && bajando) return "sell";
    return null;
  },
  diagnose: (series: PriceSeries, params: Record<string, number>) => {
    const datos = series.aux?.[AUX_TRADERS_TOP];
    if (!datos) {
      return { failure: "datos_insuficientes", detalle: "Sin datos de los traders grandes." };
    }
    const actual = ultimoValor(datos);
    if (actual === null) {
      return { failure: "datos_insuficientes", detalle: "Sin datos de los traders grandes." };
    }
    const umbral = Math.max(1.01, params["umbral"] ?? 1.15);
    if (actual > umbral) {
      return {
        failure: "ninguno",
        detalle: `Los grandes estan claramente comprados (ratio ${actual.toFixed(2)}).`,
      };
    }
    if (actual < 1 / umbral) {
      return {
        failure: "ninguno",
        detalle: `Los grandes estan vendidos (ratio ${actual.toFixed(2)}).`,
      };
    }
    return {
      failure: "ruido",
      detalle: `Los grandes estan en zona neutra (ratio ${actual.toFixed(2)}).`,
    };
  },
};

/**
 * Flujo agresivo de ordenes: compras frente a ventas.
 *
 * Es dinero real: el volumen que se ejecuto comprando de forma agresiva
 * (golpeando la oferta) frente al que se ejecuto vendiendo.
 */
export const takerFlow: IndicatorDef = {
  id: "taker_flow",
  nombre: "Flujo real de órdenes",
  tipo: "tendencia",
  descripcionCorta: "Volumen agresivo de compra frente a venta (dinero real).",
  detalles: {
    queMide:
      "El ratio entre el volumen comprado de forma agresiva y el vendido (dato público de Binance Futures: 'taker buy/sell volume ratio').",
    comoSenala:
      "Compra cuando el flujo agresivamente comprador supera el umbral Y el precio está por encima de su media; cierra cuando el flujo es vendedor.",
    cuandoFalla: "Si no hay datos de flujo o no hay velas suficientes para la media, no hay señal.",
  },
  parametros: [
    {
      key: "umbral",
      label: "Umbral compra/venta",
      value: 1.05,
      min: 1.01,
      max: 3,
      step: 0.01,
      help: "Por encima de este ratio, el flujo es comprador.",
    },
    {
      key: "periodo",
      label: "Media de precios (velas)",
      value: 20,
      min: 5,
      max: 100,
      step: 1,
      help: "El flujo tiene que ir a favor del precio respecto a su media.",
    },
  ],
  minSamples: 21,
  signal: (series: PriceSeries, params: Record<string, number>): SignalDirection => {
    const datos = series.aux?.[AUX_TRADERS_TAKER];
    if (!datos) return null;
    const actual = ultimoValor(datos);
    if (actual === null) return null;
    const periodo = Math.max(5, Math.round(params["periodo"] ?? 20));
    if (series.closes.length < periodo) return null;
    const media = sma(series.closes, periodo);
    if (media === null) return null;
    const cierre = series.closes[series.closes.length - 1]!;
    const umbral = Math.max(1.01, params["umbral"] ?? 1.05);

    if (actual > umbral && cierre > media) return "buy";
    if (actual < 1 / umbral && cierre < media) return "sell";
    return null;
  },
  diagnose: (series: PriceSeries, params: Record<string, number>) => {
    const datos = series.aux?.[AUX_TRADERS_TAKER];
    const actual = ultimoValor(datos);
    if (actual === null) {
      return { failure: "datos_insuficientes", detalle: "Sin datos de flujo de ordenes." };
    }
    const umbral = Math.max(1.01, params["umbral"] ?? 1.05);
    if (actual > umbral) {
      return { failure: "ninguno", detalle: `El flujo es comprador (ratio ${actual.toFixed(2)}).` };
    }
    if (actual < 1 / umbral) {
      return { failure: "ninguno", detalle: `El flujo es vendedor (ratio ${actual.toFixed(2)}).` };
    }
    return {
      failure: "ruido",
      detalle: `El flujo esta en zona neutra (ratio ${actual.toFixed(2)}).`,
    };
  },
};
