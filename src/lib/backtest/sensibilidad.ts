/**
 * Sensibilidad de parametros (seccion 6B.5 del plan).
 *
 * QUE MIDE
 * Si al cambiar UN poco un parametro el resultado se hunde, la estrategia
 * es FRAGIL: estaba afinada a un valor concreto, no a una idea. Una
 * estrategia que aguanta bien los cambios alrededor de su configuracion
 * tiene mas probabilidades de funcionar en datos que no ha visto.
 *
 * No es un optimizador: aqui NO se busca el mejor valor, se mide cuanto
 * se degrada el resultado al moverse.
 */

import { ejecutarBacktest } from "./engine";
import type { ConfigBacktest, Vela } from "./types";

export type Variante = {
  parametro: string;
  valor: number;
  retornoPct: number;
  operaciones: number;
  /** Cuanto se ha-away del resultado de referencia (en puntos). */
  desviacionPct: number;
};

export type AnalisisSensibilidad = {
  referencia: { retornoPct: number; operaciones: number };
  variantes: Variante[];
  /** Mayor caida respecto a la referencia (en puntos). */
  peorDesviacionPct: number;
  /** true si el resultado aguanta: ninguna variante pierde mas de un 20 %. */
  estable: boolean;
  veredicto: string;
};

/**
 * Mide la sensibilidad variando un parametro de un indicador.
 *
 * @param parametro clave del indicador (p.ej. "periodo" del RSI)
 * @param valores valores a probar
 */
export function analizarSensibilidad(args: {
  velas: readonly Vela[];
  config: ConfigBacktest;
  /** Id del indicador cuyo parametro se varia. */
  indicador: string;
  parametro: string;
  valores: number[];
  simbolo?: string;
}): AnalisisSensibilidad {
  const { velas, config, indicador, parametro, valores, simbolo } = args;

  const base = ejecutarBacktest(velas, config, { simbolo: simbolo ?? "S" });
  const referenciaPct = base.metricas.retornoNetoPct;

  const variantes: Variante[] = [];
  for (const valor of valores) {
    const params = { ...(config.parametros ?? {}) };
    const delIndicador = { ...(params[indicador] ?? {}) };
    delIndicador[parametro] = valor;
    params[indicador] = delIndicador;
    const r = ejecutarBacktest(
      velas,
      { ...config, parametros: params },
      {
        simbolo: simbolo ?? "S",
      },
    );
    variantes.push({
      parametro: `${indicador}.${parametro}`,
      valor,
      retornoPct: Number(r.metricas.retornoNetoPct.toFixed(4)),
      operaciones: r.metricas.operaciones,
      desviacionPct: Number((r.metricas.retornoNetoPct - referenciaPct).toFixed(4)),
    });
  }

  const peorDesviacion = variantes.reduce((a, v) => (v.desviacionPct < a ? v.desviacionPct : a), 0);
  // "Estable" = ninguna variante pierde mas de 20 puntos de retorno.
  const estable = peorDesviacion >= -20;

  return {
    referencia: {
      retornoPct: Number(referenciaPct.toFixed(4)),
      operaciones: base.metricas.operaciones,
    },
    variantes,
    peorDesviacionPct: Number(peorDesviacion.toFixed(4)),
    estable,
    veredicto: estable
      ? `El resultado aguanta los cambios de ${indicador}.${parametro} (peor caida: ${peorDesviacion.toFixed(2)} puntos).`
      : `FRAGIL: al mover ${indicador}.${parametro} el resultado se hunde hasta ${peorDesviacion.toFixed(2)} puntos. Esta configuracion esta afinada a un valor concreto, no a una idea.`,
  };
}
