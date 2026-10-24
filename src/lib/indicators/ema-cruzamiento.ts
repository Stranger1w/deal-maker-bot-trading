/**
 * EMA Cruzamiento - Estrategia de tendencia.
 *
 * QUE PROBLEMA RESUELVE
 * El RSI es de reversión (compra en sobreventa, vende en sobrecompra). En
 * tendencias fuertes el RSI se queda pegado a un extremo y da señales
 * prematuras o ninguna. Un cruce de EMAs (rápida/lenta) sigue la tendencia:
 * cuando la EMA rápida cruza por encima de la lenta, la tendencia es alcista;
 * cuando cruza por debajo, es bajista.
 *
 * Complementa al RSI: en mercados laterales el RSI funciona mejor; en
 * tendencias fuertes el EMA cruzamiento funciona mejor.
 *
 * COMO SEÑALA
 * - buy: EMA rápida cruza POR ENCIMA de la EMA lenta (cruce alcista)
 * - sell: EMA rápida cruza POR DEBAJO de la EMA lenta (cruce bajista)
 * - Sin cruce en la vela actual: null (no hay señal)
 *
 * TODO ES PURO: solo usa closes de velas cerradas.
 */

import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_EMA_RAPIDA = 12;
export const DEFAULT_EMA_LENTA = 26;

/** EMA exponencial: da más peso a los precios recientes. */
function ema(cierres: number[], periodo: number): number[] {
  const resultado: number[] = [];
  const k = 2 / (periodo + 1);
  for (let i = 0; i < cierres.length; i++) {
    const valor = cierres[i]!; // Siempre existe: i < cierres.length
    if (i === 0) {
      resultado.push(valor);
    } else {
      const prev = resultado[i - 1]!; // Siempre existe: i > 0
      const nuevo = valor * k + prev * (1 - k);
      resultado.push(nuevo);
    }
  }
  return resultado;
}

export const emaCruzamiento: IndicatorDef = {
  id: "ema_cruzamiento",
  nombre: "EMA Cruzamiento",
  tipo: "tendencia",
  descripcionCorta:
    "Estrategia de tendencia basada en el cruce de dos medias móviles exponenciales (EMA rápida y lenta). Cuando la EMA rápida cruza por encima de la lenta, señala alcista; cuando cruza por debajo, es bajista.",
  detalles: {
    queMide:
      "La relación entre dos EMAs de periodos distintos. La EMA rápida reacciona más rápido a cambios de precio; la lenta filtra el ruido.",
    comoSenala:
      "Compra (buy) cuando la EMA rápida cruza por encima de la EMA lenta en la vela cerrada más reciente. Vende (sell) cuando cruza por debajo. Si no hay cruce, no hay señal.",
    cuandoFalla:
      "En mercados laterales (sin tendencia clara) las EMAs se cruzan constantemente y generan señales falsas (whipsaws). Funciona mejor en tendencias claras.",
  },
  parametros: [
    {
      key: "periodoRapida",
      label: "EMA rápida (periodo)",
      value: DEFAULT_EMA_RAPIDA,
      min: 5,
      max: 50,
      step: 1,
    },
    {
      key: "periodoLenta",
      label: "EMA lenta (periodo)",
      value: DEFAULT_EMA_LENTA,
      min: 10,
      max: 100,
      step: 1,
    },
  ],
  minSamples: DEFAULT_EMA_LENTA + 1,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    const periodoRapida = params["periodoRapida"] ?? DEFAULT_EMA_RAPIDA;
    const periodoLenta = params["periodoLenta"] ?? DEFAULT_EMA_LENTA;

    if (periodoRapida >= periodoLenta) return null; // parámetros incoherentes

    const cierres = series.closes;
    if (cierres.length < periodoLenta + 1) return null;

    const emaRapida = ema(cierres, periodoRapida);
    const emaLenta = ema(cierres, periodoLenta);
    const n = cierres.length;
    const rapidaAnterior = emaRapida[n - 2]!;
    const lentaAnterior = emaLenta[n - 2]!;
    const rapidaActual = emaRapida[n - 1]!;
    const lentaActual = emaLenta[n - 1]!;

    // Cruce alcista: la rápida estaba por debajo y ahora está por encima
    if (rapidaAnterior <= lentaAnterior && rapidaActual > lentaActual) {
      return "buy";
    }
    // Cruce bajista: la rápida estaba por encima y ahora está por debajo
    if (rapidaAnterior >= lentaAnterior && rapidaActual < lentaActual) {
      return "sell";
    }

    return null;
  },

  diagnose(
    series: PriceSeries,
    params: Record<string, number>,
  ): {
    failure: "datos_insuficientes" | "ninguno";
    detalle: string;
  } {
    const periodoRapida = params["periodoRapida"] ?? DEFAULT_EMA_RAPIDA;
    const periodoLenta = params["periodoLenta"] ?? DEFAULT_EMA_LENTA;
    const cierres = series.closes;

    if (cierres.length < periodoLenta + 1) {
      return {
        failure: "datos_insuficientes",
        detalle: `Hacen falta ${periodoLenta + 1} cierres y hay ${cierres.length}.`,
      };
    }

    if (periodoRapida >= periodoLenta) {
      return {
        failure: "ninguno",
        detalle: "La EMA rápida debe ser menor que la lenta.",
      };
    }

    const emaRapida = ema(cierres, periodoRapida);
    const emaLenta = ema(cierres, periodoLenta);
    const n = cierres.length;
    const rapidaAnterior = emaRapida[n - 2]!;
    const lentaAnterior = emaLenta[n - 2]!;
    const rapidaActual = emaRapida[n - 1]!;
    const lentaActual = emaLenta[n - 1]!;

    if (rapidaAnterior <= lentaAnterior && rapidaActual > lentaActual) {
      return { failure: "ninguno", detalle: "Cruce alcista detectado." };
    }
    if (rapidaAnterior >= lentaAnterior && rapidaActual < lentaActual) {
      return { failure: "ninguno", detalle: "Cruce bajista detectado." };
    }

    const distancia = ((rapidaActual - lentaActual) / lentaActual) * 100;
    return {
      failure: "ninguno",
      detalle: `Sin cruce. EMA rápida ${rapidaActual.toFixed(2)} vs lenta ${lentaActual.toFixed(2)} (diferencia ${distancia.toFixed(2)} %).`,
    };
  },
};
