/**
 * Compuerta de promocion: demo -> testnet -> real.
 *
 * POR QUE EXISTE
 * Antes, pasar un bot a Real exigia 2FA y unos dias en demo, pero NO que
 * la estrategia tuviera ventaja: un bot que pierde dinero todos los dias
 * "cumplia" el requisito. Con el backtest ya se sabe que la estrategia por
 * defecto no supera al mercado, asi que la puerta tiene que mirar la
 * EVIDENCIA, no el calendario.
 *
 * Aqui vive la regla, en funciones puras y testeables. Quien la aplica es
 * risk.server.ts (evaluatePromotionCore), que lee los datos reales.
 *
 * La puerta NO se puede saltar desde la UI: promoteBotToReal exige
 * administrador + 2FA (aal2) y vuelve a pasar por esta misma evaluacion.
 */

/** Una ejecucion del bot (las que guarda bot_executions). */
export type Ejecucion = {
  side: string;
  pnl: number | string | null;
  created_at: string;
  status?: string;
};

/** Metricas de las operaciones en demo (paper trading). */
export type MetricasDemo = {
  /** Operaciones cerradas (vendas con P&L). */
  operaciones: number;
  /** P&L neto de las operaciones cerradas. */
  pnlNeto: number;
  /** Porcentaje de operaciones ganadoras. */
  winRatePct: number;
  /** Ganancia total / perdida total. */
  profitFactor: number;
  /** Drawdown maximo de la curva de P&L acumulado, en porcentaje del capital. */
  maxDrawdownPct: number;
};

/** Criterios que hay que cumplir (los minima los pone el administrador). */
export type CriteriosPromocion = {
  /** Dias que el bot lleva realmente en demo. */
  dias: number;
  /** Dias minimos en demo. */
  minDias: number;
  /** Operaciones minimas en demo. */
  minOperaciones: number;
  /** Drawdown maximo admitido (%). */
  maxDrawdownPct: number;
  /** Exigir que el bot supere al comprar y mantener. */
  exigirBenchmark: boolean;
  /** Retorno del bot en el periodo (%) y del benchmark (%). */
  botReturnPct: number;
  benchmarkReturnPct: number;
  /** Stop loss y take profit del bot (obligatorios). */
  stopLossPct: number;
  takeProfitPct: number;
  /** Las claves de Binance del dueno estan verificadas. */
  binanceVerificado: boolean;
  /** Capital del bot, para el drawdown en porcentaje. */
  capital: number;
};

export type ResultadoGate = {
  ok: boolean;
  razones: string[];
  metricas: MetricasDemo;
};

/**
 * Metricas de las operaciones en demo.
 *
 * Solo cuentan las VENTAS (cada una cierra una operacion y trae el P&L).
 * Una compra sin su venta es una posicion abierta: no cuenta ni como
 * ganancia ni como perdida, pero tampoco como operacion terminada.
 */
export function metricasDeEjecuciones(
  ejecuciones: readonly Ejecucion[],
  capital: number,
): MetricasDemo {
  const cerradas = ejecuciones
    .filter((e) => e.side === "sell")
    .map((e) => Number(e.pnl ?? 0))
    .filter((p) => Number.isFinite(p));

  const pnlNeto = cerradas.reduce((a, p) => a + p, 0);
  const ganadoras = cerradas.filter((p) => p > 0);
  const perdedoras = cerradas.filter((p) => p < 0);
  const sumaGanadora = ganadoras.reduce((a, p) => a + p, 0);
  const sumaPerdedora = Math.abs(perdedoras.reduce((a, p) => a + p, 0));

  // Drawdown de la curva de P&L acumulado, en % del capital.
  let acumulado = 0;
  let pico = 0;
  let maxDd = 0;
  for (const pnl of cerradas) {
    acumulado += pnl;
    if (acumulado > pico) pico = acumulado;
    if (capital > 0 && pico > 0) {
      const caida = ((pico - acumulado) / capital) * 100;
      if (caida > maxDd) maxDd = caida;
    }
  }

  return {
    operaciones: cerradas.length,
    pnlNeto: Number(pnlNeto.toFixed(8)),
    winRatePct: cerradas.length
      ? Number(((ganadoras.length / cerradas.length) * 100).toFixed(2))
      : 0,
    profitFactor:
      sumaPerdedora > 0
        ? Number((sumaGanadora / sumaPerdedora).toFixed(4))
        : sumaGanadora > 0
          ? 999
          : 0,
    maxDrawdownPct: Number(maxDd.toFixed(4)),
  };
}

/**
 * Evalua la compuerta. Devuelve TODOS los motivos del rechazo (no solo el
 * primero): asi el usuario sabe que le falta, no solo una cosa.
 */
export function evaluarGate(criterios: CriteriosPromocion, metricas: MetricasDemo): ResultadoGate {
  const razones: string[] = [];

  if (!(criterios.stopLossPct > 0)) razones.push("Falta stop-loss obligatorio.");
  if (!(criterios.takeProfitPct > 0)) razones.push("Falta take-profit obligatorio.");
  if (criterios.dias < criterios.minDias) {
    razones.push(`Solo ${criterios.dias} de ${criterios.minDias} días mínimos en demo.`);
  }
  if (metricas.operaciones < criterios.minOperaciones) {
    razones.push(
      `Solo ${metricas.operaciones} operaciones cerradas en demo (mínimo ${criterios.minOperaciones}): con pocas operaciones el azar manda.`,
    );
  }
  if (metricas.pnlNeto <= 0) {
    razones.push(`El P&L neto en demo es ${metricas.pnlNeto.toFixed(2)}: no es positivo.`);
  }
  if (criterios.maxDrawdownPct > 0 && metricas.maxDrawdownPct > criterios.maxDrawdownPct) {
    razones.push(
      `Drawdown del ${metricas.maxDrawdownPct.toFixed(2)} % en demo, por encima del límite del ${criterios.maxDrawdownPct} %.`,
    );
  }
  if (criterios.exigirBenchmark && criterios.botReturnPct <= criterios.benchmarkReturnPct) {
    razones.push(
      `El bot (${criterios.botReturnPct}%) no supera al benchmark buy-and-hold de ${criterios.botReturnPct === 0 ? "su par" : "su par"} (${criterios.benchmarkReturnPct}%).`,
    );
  }
  if (!criterios.binanceVerificado) {
    razones.push("Las API Keys de Binance del dueño no están verificadas.");
  }

  return { ok: razones.length === 0, razones, metricas };
}
