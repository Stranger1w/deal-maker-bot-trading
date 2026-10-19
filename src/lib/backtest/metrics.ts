/**
 * Metricas del backtest (puras, sin I/O).
 *
 * Todas se calculan sobre operaciones CERRADAS y sobre la curva de capital:
 * por eso una operacion abierta al final del periodo no cuenta como
 * ganancia, solo como capital mark-to-market.
 *
 * Honestidad: el Sharpe y el Sortino de aqui son simples (retorno medio por
 * operacion / desviacion). No son los de un anuo de gestion professionally
 * descansado: sirven para COMPARAR estrategias entre si, no para decidir si
 * un fondo es rentable.
 */

import type { Metricas, Operacion, ResultadoBacktest, Vela } from "./types";

/** Desviacion tipica poblacional de una serie de numeros. */
export function desviacion(serie: readonly number[]): number {
  if (serie.length === 0) return 0;
  const media = serie.reduce((a, b) => a + b, 0) / serie.length;
  const acc = serie.reduce((a, v) => a + (v - media) * (v - media), 0);
  return Math.sqrt(acc / serie.length);
}

/** Drawdown maximo (en %) de una curva de capital. */
export function maxDrawdownPct(curva: readonly number[]): number {
  let pico = 0;
  let peor = 0;
  for (const valor of curva) {
    if (valor > pico) pico = valor;
    if (pico <= 0) continue;
    const caida = ((pico - valor) / pico) * 100;
    if (caida > peor) peor = caida;
  }
  return Number(peor.toFixed(4));
}

/** Metricas a partir de operaciones cerradas y curva de capital. */
export function calcularMetricas(args: {
  capitalInicial: number;
  capitalFinal: number;
  operaciones: readonly Operacion[];
  curva: readonly number[];
  duracionMs: number;
}): Metricas {
  const { capitalInicial, capitalFinal, operaciones, curva, duracionMs } = args;
  const pnls = operaciones.map((o) => o.pnl);
  const ganadoras = pnls.filter((p) => p > 0);
  const perdedoras = pnls.filter((p) => p < 0);
  const sumaGanadora = ganadoras.reduce((a, p) => a + p, 0);
  const sumaPerdedora = Math.abs(perdedoras.reduce((a, p) => a + p, 0));
  const costeTotal = operaciones.reduce((a, o) => a + o.costes, 0);

  const retornos = pnls.map((p) => (capitalInicial > 0 ? p / capitalInicial : 0));
  const mediaRetorno = retornos.length ? retornos.reduce((a, b) => a + b, 0) / retornos.length : 0;
  const desv = desviacion(retornos);
  const soloPerdedoras = retornos.filter((r) => r < 0);
  const desvNegativa = desviacion(soloPerdedoras);

  return {
    capitalInicial,
    capitalFinal,
    retornoNetoPct:
      capitalInicial > 0 ? ((capitalFinal - capitalInicial) / capitalInicial) * 100 : 0,
    pnlNeto: capitalFinal - capitalInicial,
    maxDrawdownPct: maxDrawdownPct(curva),
    operaciones: operaciones.length,
    ganadoras: ganadoras.length,
    perdedoras: perdedoras.length,
    winRatePct: operaciones.length ? (ganadoras.length / operaciones.length) * 100 : 0,
    expectancy: operaciones.length ? pnls.reduce((a, p) => a + p, 0) / operaciones.length : 0,
    // Sin perdidas, el profit factor es infinito: se devuelve un numero
    // grande y explicito, no Infinity (que romperia el JSON).
    profitFactor: sumaPerdedora > 0 ? sumaGanadora / sumaPerdedora : sumaGanadora > 0 ? 999 : 0,
    costeTotal,
    costePct: capitalInicial > 0 ? (costeTotal / capitalInicial) * 100 : 0,
    sharpe: desv > 0 ? mediaRetorno / desv : 0,
    sortino: desvNegativa > 0 ? mediaRetorno / desvNegativa : 0,
    duracionMs,
  };
}

/** Compra y mantener en el mismo periodo, con los mismos costes de entrada y salida. */
export function comprarYMantener(args: {
  velas: readonly Vela[];
  capitalInicial: number;
  comision: number;
  slippage: number;
  descuentoBnb: number;
}): { retornoPct: number; pnlNeto: number } {
  const { velas, capitalInicial, comision, slippage, descuentoBnb } = args;
  const primera = velas[0];
  const ultima = velas[velas.length - 1];
  if (!primera || !ultima || capitalInicial <= 0) return { retornoPct: 0, pnlNeto: 0 };
  const comisionEfectiva = comision * (1 - descuentoBnb);
  const precioCompra = primera.close * (1 + slippage);
  const precioVenta = ultima.close * (1 - slippage);
  const cantidad = capitalInicial / precioCompra;
  const coste = cantidad * (precioCompra + precioVenta) * comisionEfectiva;
  const bruto = cantidad * (precioVenta - precioCompra);
  const neto = bruto - coste;
  return {
    retornoPct: (neto / capitalInicial) * 100,
    pnlNeto: neto,
  };
}

/**
 * Avisos honestos sobre lo que el resultado NO demuestra.
 *
 * Es la parte mas importante del informe: un backtest con pocas operaciones
 * o con parametros ajustados a mano no demuestra ventaja.
 */
export function avisosHonestos(args: {
  metricas: Metricas;
  benchmark: { retornoPct: number; superar: boolean };
  operacionesMinimas?: number | undefined;
  fueraDeMuestra?: boolean | undefined;
}): string[] {
  const { metricas, benchmark, operacionesMinimas = 100, fueraDeMuestra = false } = args;
  const avisos: string[] = [];

  if (metricas.operaciones < operacionesMinimas) {
    avisos.push(
      `Solo ${metricas.operaciones} operaciones (minimo recomendado: ${operacionesMinimas}): con pocas operaciones el azar domina y el resultado no es estadisticamente significativo.`,
    );
  }
  if (!fueraDeMuestra) {
    avisos.push(
      "Resultado sobre los mismos datos: no es validacion fuera de muestra. Repite con datos que el bot no haya visto (walk-forward).",
    );
  }
  if (metricas.maxDrawdownPct > 20) {
    avisos.push(
      `Drawdown maximo del ${metricas.maxDrawdownPct.toFixed(2)} %: con capital real, un drawdown asi obliga a parar.`,
    );
  }
  if (metricas.costePct > 0) {
    avisos.push(
      `Los costes se comieron el ${metricas.costePct.toFixed(2)} % del capital. Sin contar comisiones y slippage, cualquier estrategia parece rentable.`,
    );
  }
  if (!benchmark.superar) {
    avisos.push(
      `No supera a comprar y mantener (${benchmark.retornoPct.toFixed(2)} %): no hay evidencia de ventaja sobre el mercado.`,
    );
  }
  if (metricas.profitFactor > 0 && metricas.profitFactor < 1) {
    avisos.push(
      `Profit factor de ${metricas.profitFactor.toFixed(2)} (< 1): de media, cada operacion pierde dinero.`,
    );
  }
  return avisos;
}

/** Resultado completo a partir de las piezas (para no repetir el ensamblado). */
export function ensamblarResultado(args: {
  etiqueta: string;
  simbolo: string;
  velas: readonly Vela[];
  operaciones: readonly Operacion[];
  curva: readonly number[];
  capitalInicial: number;
  capitalFinal: number;
  duracionMs: number;
  comision: number;
  slippage: number;
  descuentoBnb: number;
  operacionesMinimas?: number | undefined;
  fueraDeMuestra?: boolean | undefined;
}): ResultadoBacktest {
  const metricas = calcularMetricas({
    capitalInicial: args.capitalInicial,
    capitalFinal: args.capitalFinal,
    operaciones: args.operaciones,
    curva: args.curva,
    duracionMs: args.duracionMs,
  });
  const benchmarkBruto = comprarYMantener({
    velas: args.velas,
    capitalInicial: args.capitalInicial,
    comision: args.comision,
    slippage: args.slippage,
    descuentoBnb: args.descuentoBnb,
  });
  const benchmark = {
    retornoPct: Number(benchmarkBruto.retornoPct.toFixed(4)),
    pnlNeto: Number(benchmarkBruto.pnlNeto.toFixed(4)),
    superar: metricas.retornoNetoPct > benchmarkBruto.retornoPct,
  };
  return {
    etiqueta: args.etiqueta,
    simbolo: args.simbolo,
    velas: args.velas.length,
    desde: args.velas[0]?.time ?? 0,
    hasta: args.velas[args.velas.length - 1]?.time ?? 0,
    metricas,
    operaciones: [...args.operaciones],
    curva: [...args.curva],
    benchmark,
    avisos: avisosHonestos({
      metricas,
      benchmark,
      operacionesMinimas: args.operacionesMinimas,
      fueraDeMuestra: args.fueraDeMuestra,
    }),
  };
}
