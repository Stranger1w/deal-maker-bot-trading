/**
 * RSI - Relative Strength Index.
 *
 * "Indicador de la velocidad y del movimiento de precios. Oscilador 0-100 con
 * ganancias/perdidas medias de N velas: <30 sobreventa (compra), >70
 * sobrecompra (venta)."
 *
 * Implementacion fiel a TradingView: suavizado de WILDER, no una media simple.
 * La diferencia importa: la media simple reacciona de golpe a cada vela y da
 * lecturas distintas de las que muestra el grafico.
 */

import type { IndicatorDef, PriceSeries, SignalDirection } from "./types";

export const DEFAULT_PERIODO = 14;
export const DEFAULT_SOBREVENTA = 30;
export const DEFAULT_SOBRECOMPRA = 70;

/**
 * RSI con suavizado de Wilder.
 *
 * Devuelve `null` (no hay senal) si:
 *  - hay menos de `periodo + 1` cierres,
 *  - la serie es totalmente plana (ganancia y perdida medias 0),
 *  - el resultado no es finito.
 *
 * Si no hay perdidas medias pero si ganancias (subida perfecta), devuelve 100:
 * es un valor legitimo, no una division por cero.
 */
export function rsiWilder(cierres: number[], periodo = DEFAULT_PERIODO): number | null {
  if (!Number.isFinite(periodo) || periodo < 1) return null;
  if (cierres.length < periodo + 1) return null;

  let sumaGan = 0;
  let sumaPer = 0;
  // Primera media: promedio simple de los primeros `periodo` cambios.
  for (let i = 1; i <= periodo; i++) {
    const cambio = (cierres[i] ?? 0) - (cierres[i - 1] ?? 0);
    if (cambio > 0) sumaGan += cambio;
    else sumaPer -= cambio;
  }
  let mediaGan = sumaGan / periodo;
  let mediaPer = sumaPer / periodo;

  // Resto de la serie con el suavizado de Wilder.
  for (let i = periodo + 1; i < cierres.length; i++) {
    const cambio = (cierres[i] ?? 0) - (cierres[i - 1] ?? 0);
    const gan = cambio > 0 ? cambio : 0;
    const per = cambio < 0 ? -cambio : 0;
    mediaGan = (mediaGan * (periodo - 1) + gan) / periodo;
    mediaPer = (mediaPer * (periodo - 1) + per) / periodo;
  }

  // Serie plana: no hay informacion. Se devuelve null en vez de 50 inventado.
  if (mediaGan === 0 && mediaPer === 0) return null;
  // Subida perfecta: RSI 100 es el valor correcto, no hay que dividir por cero.
  if (mediaPer === 0) return 100;

  const rs = mediaGan / mediaPer;
  const valor = 100 - 100 / (1 + rs);
  return Number.isFinite(valor) ? valor : null;
}

export const rsi: IndicatorDef = {
  id: "rsi",
  nombre: "RSI",
  tipo: "reversion",
  descripcionCorta:
    "Indicador de la velocidad y del movimiento de precios. Oscilador 0-100 con ganancias/perdidas medias de N velas: <30 sobreventa (compra), >70 sobrecompra (venta).",
  detalles: {
    queMide:
      "El equilibrio entre subidas y bajadas de precio, medido como porcentaje entre 0 y 100. Usa el suavizado de Wilder (el mismo que TradingView).",
    comoSenala:
      "Por debajo del nivel de sobreventa se interpreta como posible rebote al alza. Por encima del nivel de sobrecompra, como posible caida. En la zona intermedia no hay senal.",
    cuandoFalla:
      "En tendencias fuertes da senales prematuras: en una subida sostenida el RSI se pegue a 100 y marcara sobrecompra mientras el precio sigue subiendo. Por eso el RSI se usa mejor como aviso de agotamiento que como entrada.",
  },
  parametros: [
    { key: "periodo", label: "Periodo", value: DEFAULT_PERIODO, min: 2, max: 50, step: 1 },
    {
      key: "sobreventa",
      label: "Nivel de sobreventa",
      value: DEFAULT_SOBREVENTA,
      min: 5,
      max: 45,
      step: 1,
    },
    {
      key: "sobrecompra",
      label: "Nivel de sobrecompra",
      value: DEFAULT_SOBRECOMPRA,
      min: 55,
      max: 95,
      step: 1,
    },
  ],
  minSamples: DEFAULT_PERIODO + 1,

  signal(series: PriceSeries, params: Record<string, number>): SignalDirection {
    const periodo = params["periodo"] ?? DEFAULT_PERIODO;
    const sobreventa = params["sobreventa"] ?? DEFAULT_SOBREVENTA;
    const sobrecompra = params["sobrecompra"] ?? DEFAULT_SOBRECOMPRA;
    const valor = rsiWilder(series.closes, periodo);
    if (valor === null) return null;
    if (sobreventa >= sobrecompra) return null; // parametros incoherentes
    if (valor < sobreventa) return "buy";
    if (valor > sobrecompra) return "sell";
    return null;
  },

  diagnose(series: PriceSeries, params: Record<string, number>) {
    const periodo = params["periodo"] ?? DEFAULT_PERIODO;
    const c = series.closes;
    if (c.length < periodo + 1) {
      return {
        failure: "datos_insuficientes" as const,
        detalle: `Hacen falta ${periodo + 1} cierres y hay ${c.length}.`,
      };
    }
    const valor = rsiWilder(c, periodo);
    if (valor === null) {
      return {
        failure: "ninguno" as const,
        detalle: "El precio no se ha movido en el periodo: el RSI no significa nada aqui.",
      };
    }
    // Tendencia fuerte: el RSI lleva many candles pegado a un extremo.
    const cola = c.slice(-periodo);
    const rises = cola.filter((v, i) => i > 0 && v > (cola[i - 1] ?? v)).length;
    const caidas = cola.filter((v, i) => i > 0 && v < (cola[i - 1] ?? v)).length;
    const dominante = Math.max(rises, caidas) / (periodo - 1 || 1);
    if (dominante > 0.9 && (valor > 70 || valor < 30)) {
      return {
        failure: "tendencia_fuerte" as const,
        detalle:
          "El precio va en una sola direccion y el RSI esta en un extremo: en tendencia fuerte esta senal suele ser prematura.",
      };
    }
    return {
      failure: "ninguno" as const,
      detalle: `RSI en ${valor.toFixed(1)}, dentro de rango util.`,
    };
  },
};
