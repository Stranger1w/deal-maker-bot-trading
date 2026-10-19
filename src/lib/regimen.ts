/**
 * Filtro de regimen de mercado.
 *
 * QUE PROBLEMA RESUELVE
 * Una estrategia de reversion (RSI, Bollinger, Estocastico) pierde dinero
 * cuando el mercado esta en tendencia fuerte: compra en la caida de una
 * tendencia Bajista y el precio sigue bajando. Y ninguna estrategia
 * funciona bien con volatilidad extrema: el slippage real se dispara y el
 * stop se salta.
 *
 * El filtro NO predice el mercado. Solo dice en que REGIMEN esta el precio
 * ahora (tendencia, lateral o volatilidad extrema) para que el motor no
 * fuerce la estrategia en un contexto que no le favorece. Es un freno, no
 * una bola de cristal.
 *
 * Todo aqui es PURO y se puede testear con series sintéticas.
 */

import { atrPct } from "./riesgo-tamano";

export type Regimen = "tendencia_alcista" | "tendencia_bajista" | "lateral" | "volatilidad_extrema";

export type VelaOHLC = { high: number; low: number; close: number };

export type OpcionesRegimen = {
  /** Ventana para medir la tendencia. */
  ventana?: number;
  /** Volatilidad relativa (ATR %) por encima de la cual no se opera. */
  umbralVolatilidadPct?: number;
  /** Cambio minimo del precio en la ventana para hablar de tendencia (%). */
  umbralTendenciaPct?: number;
};

/** Volatilidad relativa media de las velas: quanto se mueve el precio. */
export function volatilidadPct(velas: readonly VelaOHLC[], periodo = 14): number | null {
  return atrPct(velas, periodo);
}

/**
 * Cambia relative de la ventana en porcentaje: positivo = sube, negativo = baja.
 */
export function cambioPct(velas: readonly VelaOHLC[], ventana = 20): number | null {
  if (velas.length < 2) return null;
  const cierre = velas[velas.length - 1]!.close;
  const inicio = velas[Math.max(0, velas.length - ventana)]!.close;
  if (!(cierre > 0) || !(inicio > 0)) return null;
  return ((cierre - inicio) / inicio) * 100;
}

/** Detecta el regimen actual del mercado. */
export function detectarRegimen(
  velas: readonly VelaOHLC[],
  opciones: OpcionesRegimen = {},
): { regimen: Regimen; volatilidadPct: number | null; cambioPct: number | null; detalle: string } {
  const ventana = opciones.ventana ?? 20;
  const umbralVol = opciones.umbralVolatilidadPct ?? 4;
  const umbralTendencia = opciones.umbralTendenciaPct ?? 1.5;

  const vol = volatilidadPct(velas);
  const cambio = cambioPct(velas, ventana);

  if (vol !== null && vol >= umbralVol) {
    return {
      regimen: "volatilidad_extrema",
      volatilidadPct: vol,
      cambioPct: cambio,
      detalle: `Volatilidad del ${vol.toFixed(2)} % (ATR), por encima del límite de ${umbralVol} %: el slippage real se dispara y el stop se salta.`,
    };
  }
  if (cambio !== null && cambio >= umbralTendencia) {
    return {
      regimen: "tendencia_alcista",
      volatilidadPct: vol,
      cambioPct: cambio,
      detalle: `Tendencia alcista: el precio ha subido un ${cambio.toFixed(2)} % en las últimas ${ventana} velas.`,
    };
  }
  if (cambio !== null && cambio <= -umbralTendencia) {
    return {
      regimen: "tendencia_bajista",
      volatilidadPct: vol,
      cambioPct: cambio,
      detalle: `Tendencia bajista: el precio ha bajado un ${Math.abs(cambio).toFixed(2)} % en las últimas ${ventana} velas.`,
    };
  }
  return {
    regimen: "lateral",
    volatilidadPct: vol,
    cambioPct: cambio,
    detalle: "Mercado lateral: sin tendencia dominante.",
  };
}

/**
 * Tipo de la seleccion de indicadores: define si la estrategia compra
 * buscando reversiones (RSI, Bollinger, Estocastico, CCI) o siguiendo
 * tendencias (MACD, precio de cierre).
 *
 * - "filtro": solo hay indicadores de filtro (AI Indicator): no generan
 *   entradas por si mismos, asi que el regimen no las restringe.
 * - "tendencia": hay alguno de tendencia.
 * - "reversion": todos son de reversion.
 */
export function tipoDeIndicadores(
  ids: readonly string[],
  tipoDe: (id: string) => "tendencia" | "reversion" | "filtro" | null,
): "tendencia" | "reversion" | "filtro" {
  let hayTendencia = false;
  let hayReversion = false;
  for (const id of ids) {
    const tipo = tipoDe(id);
    if (tipo === "tendencia") hayTendencia = true;
    else if (tipo === "reversion") hayReversion = true;
  }
  if (hayTendencia) return "tendencia";
  if (hayReversion) return "reversion";
  return "filtro";
}

/**
 * ¿Se puede operar en este regimen con esta estrategia?
 *
 * `tipoEstrategia`:
 *  - "reversion" (RSI, Bollinger, Estocastico, CCI): NO debe operar en
 *    tendencia fuerte (compra en la caida de una tendencia).
 *  - "tendencia" (MACD, precio de cierre): puede operar en tendencia; en
 *    tendencia contraria NO (el precio va en contra).
 */
export function operarEnRegimen(args: {
  regimen: Regimen;
  tipoEstrategia: "tendencia" | "reversion" | "filtro";
  /** Si es falso, el filtro no bloquea (esta apagado). */
  activo: boolean;
}): { permitido: boolean; motivo: string } {
  if (!args.activo) return { permitido: true, motivo: "Filtro de régimen desactivado." };
  if (args.regimen === "volatilidad_extrema") {
    return {
      permitido: false,
      motivo:
        "Volatilidad extrema: no se abre posicion (el slippage real se dispara y el stop se salta).",
    };
  }
  if (args.tipoEstrategia === "filtro") {
    return { permitido: true, motivo: "El indicador es un filtro, no genera entradas." };
  }
  if (args.tipoEstrategia === "reversion" && args.regimen.startsWith("tendencia")) {
    return {
      permitido: false,
      motivo: `Estrategia de reversion en ${args.regimen}: comprar en contra-tendencia es la forma tipica de perder dinero.`,
    };
  }
  if (args.tipoEstrategia === "tendencia" && args.regimen === "tendencia_bajista") {
    return {
      permitido: false,
      motivo:
        "Estrategia de tendencia en tendencia bajista: no se abre posicion a contra-tendencia.",
    };
  }
  return { permitido: true, motivo: "Régimen compatible con la estrategia." };
}
