/**
 * Costes reales de operar y el minimo que debe cubrir el take-profit.
 *
 * POR QUE
 * Con comisiones del 0,1 % por lado y algo de slippage, una operacion que
 * gana un 0,2 % sale en PERDIDA: el spread se come la ganancia. Un bot con
 * take-profit de 0,3 % no es una estrategia Conservative, es un generador
 * de commissions. Por eso el take-profit tiene que superar el coste de ida
 * y vuelta CON MARGEN.
 *
 * No es una recomendacion de mercado: es aritmetica minima para no perder
 * dinero por la via de los costes.
 */

/** Comision de Binance spot por lado (0,1 % de lo negociado). */
export const COMISION_SPOT = 0.001;
/** Slippage esperado por lado (0,05 %). Es una estimacion conservadora. */
export const SLIPPAGE_ESPERADO = 0.0005;
/** Descuento por pagar la comision con BNB (10 %). */
export const DESCUENTO_BNB = 0.1;
/** Margen minimo sobre el coste: el TP debe ser 2 veces el coste. */
export const MARGEN_SOBRE_COSTE = 2;

export type ModeloCostes = {
  comision?: number;
  slippage?: number;
  descuentoBnb?: number;
  /** Margen minimo sobre el coste. */
  margen?: number;
};

/** Coste total de entrar y salir, en fraccion (0,003 = 0,3 %). */
export function costeIdaYVuelta(modelo: ModeloCostes = {}): number {
  const comision = modelo.comision ?? COMISION_SPOT;
  const slippage = modelo.slippage ?? SLIPPAGE_ESPERADO;
  const descuento = modelo.descuentoBnb ?? DESCUENTO_BNB;
  const margen = modelo.margen ?? MARGEN_SOBRE_COSTE;
  const idaYVuelta = comision * (1 - descuento) * 2 + slippage * 2;
  return idaYVuelta * margen;
}

export type VeredictoTakeProfit = {
  /** true si el take-profit cubre el coste con margen. */
  ok: boolean;
  /** Coste de ida y vuelta con margen, en porcentaje. */
  costePct: number;
  /** Take-profit minimo aceptable, en porcentaje. */
  minimoPct: number;
  /** Motivo (para explicarlo en la UI y en los logs). */
  motivo: string;
};

/**
 * Comprueba si un take-profit cubre el coste de ida y vuelta.
 *
 * `takeProfitPct` en porcentaje (4 = 4 %).
 */
export function tpCubreCostes(
  takeProfitPct: number,
  modelo: ModeloCostes = {},
): VeredictoTakeProfit {
  const coste = costeIdaYVuelta(modelo);
  const costePct = coste * 100;
  const minimoPct = costePct;
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0) {
    return {
      ok: false,
      costePct: Number(costePct.toFixed(4)),
      minimoPct: Number(minimoPct.toFixed(4)),
      motivo: "El take-profit debe ser mayor que cero.",
    };
  }
  if (takeProfitPct < minimoPct) {
    return {
      ok: false,
      costePct: Number(costePct.toFixed(4)),
      minimoPct: Number(minimoPct.toFixed(4)),
      motivo: `El take-profit (${takeProfitPct} %) no cubre el coste de ida y vuelta con margen (${minimoPct.toFixed(2)} %: comisiones + slippage). Con ese take-profit se pierde dinero aunque el precio se mueva a favor.`,
    };
  }
  return {
    ok: true,
    costePct: Number(costePct.toFixed(4)),
    minimoPct: Number(minimoPct.toFixed(4)),
    motivo: `El take-profit cubre el coste de ida y vuelta (${minimoPct.toFixed(2)} %).`,
  };
}
