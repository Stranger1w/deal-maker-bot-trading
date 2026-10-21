/**
 * SERIE DE "PRECIO JUSTO": la desviacion del precio de un mercado frente a
 * la mediana del mismo par en el resto de mercados.
 *
 * COMO SE CALCULA
 *  1) Se descargan las velas del par en cada mercado (13 en total).
 *  2) Se alinean por hora: para cada vela, el ultimo cierre conocido de cada
 *     mercado (nunca se mira el futuro).
 *  3) Se calcula la MEDIANA de los cierres de los mercados distintos al de
 *     referencia, y la desviacion en % del precio de referencia.
 *
 * POR QUE LA MEDIANA Y NO LA MEDIA
 * Un mercado con un precio disparado (un error de API, una vela rarísima)
 *    falsearia la media. La mediana lo ignora: es el "precio justo" de verdad.
 *
 * LO QUE NO ES
 * No es una promesa de ganancia: es un dato. Lo que el bot haga con el lo
 * decide el backtest, y el backtest hasta ahora dice que la mayoria de
 * estas estrategias no superan al azar.
 */
import { AUX_PRECIO_FAIR } from "./indicators/auxiliares";
import type { Vela } from "./backtest/types";

/** Una serie de precios por mercado, alineada por vela. */
export type SeriePreciosMultiples = {
  /** El mercado de referencia (donde se opera): su precio de cierre. */
  referencia: number[];
  /** La mediana de los demas mercados, vela a vela. */
  mediana: number[];
  /** La desviacion del precio de referencia frente a la mediana (%). */
  desviacion: number[];
  /** Cuantos mercados han aportado a cada vela. */
  mercados: number[];
  /** Los mercados que han respondido (para enseñarlos). */
  usados: string[];
};

/** Mediana de una lista de numeros (ignora los que no son finitos). */
export function mediana(valores: readonly number[]): number {
  const limpios = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!limpios.length) return Number.NaN;
  const medio = Math.floor(limpios.length / 2);
  return limpios.length % 2 ? limpios[medio]! : (limpios[medio - 1]! + limpios[medio]!) / 2;
}

/**
 * Alinea los cierres de varios mercados con las velas de referencia.
 *
 * @param velas las velas del mercado de referencia
 * @param seriesPorMercado un mapa mercado -> velas (en cualquier orden)
 */
export function alinearPreciosMultiples(
  velas: ReadonlyArray<{ time: number; close: number }>,
  seriesPorMercado: ReadonlyMap<string, ReadonlyArray<{ time: number; close: number }>>,
  mercadoReferencia: string,
): SeriePreciosMultiples {
  const referencia: number[] = [];
  const medianaPorVela: number[] = [];
  const desviacion: number[] = [];
  const mercadosPorVela: number[] = [];

  // Un cursor por mercado: se avanza en el tiempo, nunca hacia atras.
  const cursores = new Map<string, number>();
  const ultimo = new Map<string, number>();

  for (const vela of velas) {
    referencia.push(vela.close);
    const precios: number[] = [];
    for (const [mercado, serie] of seriesPorMercado) {
      if (mercado === mercadoReferencia) continue;
      let cursor = cursores.get(mercado) ?? 0;
      let valor = ultimo.get(mercado);
      while (cursor < serie.length && (serie[cursor]?.time ?? 0) <= vela.time) {
        const cierre = serie[cursor]?.close;
        if (Number.isFinite(cierre)) valor = cierre;
        cursor++;
      }
      cursores.set(mercado, cursor);
      if (valor !== undefined) {
        ultimo.set(mercado, valor);
        precios.push(valor);
      }
    }
    const med = mediana(precios);
    medianaPorVela.push(med);
    mercadosPorVela.push(precios.length);
    const precio = vela.close;
    desviacion.push(Number.isFinite(med) && med > 0 ? ((precio - med) / med) * 100 : Number.NaN);
  }

  return {
    referencia,
    mediana: medianaPorVela,
    desviacion,
    mercados: mercadosPorVela,
    usados: [...seriesPorMercado.keys()],
  };
}

/** Convierte la serie en el mapa `aux` que entiende el motor. */
export function aAux(serie: SeriePreciosMultiples): Record<string, number[]> {
  return { [AUX_PRECIO_FAIR]: serie.desviacion };
}

/** Texto para la interfaz: como esta el precio hoy frente a los demas. */
export function resumenPrecioJusto(serie: SeriePreciosMultiples): string {
  const ultimo = serie.desviacion[serie.desviacion.length - 1] ?? Number.NaN;
  if (!Number.isFinite(ultimo)) return "Sin datos de otros mercados para este par.";
  const signo = ultimo > 0 ? "por encima" : "por debajo";
  const conDatos = serie.mercados[serie.mercados.length - 1] ?? 0;
  return (
    "El precio esta " +
    Math.abs(ultimo).toFixed(3) +
    " % " +
    signo +
    " la mediana de " +
    (serie.usados.length - 1) +
    " mercados (" +
    conDatos +
    " con datos en esta vela)."
  );
}
