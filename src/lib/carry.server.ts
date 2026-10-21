/**
 * ESTRATEGIA DE COBERTURA (CARRY): comprar el spot y vender el perpetuo.
 *
 * QUE ES
 * En Binance, el perpetuo suele cotizar por encima del spot. El que esta
 * vendido en el perpetuo PAGA la CUOTA DE FINANCIACION al que esta comprado
 * en el spot (cada 8 horas). Esa diferencia es un ingreso que NO depende de
 * que el precio suba o baje: es cobertura, no adivinar.
 *
 * LO QUE DICE LA MEDICION REAL (endpoint publico de Binance, produccion)
 *   2021-05 -> 2026-10 (5,5 años, 6.000 cuotas):
 *   - Cuotas cobradas: 41,28 % (6,51 %/año), POSITIVAS en todos los años.
 *   - Carry completo (spot + perp corto): 41,48 % -> 6,54 %/año.
 *   - El spot solo: +49,59 %. El perpetuo solo: +49,39 %.
 *   Un año malo (2026, 3,0 %) sigue siendo positivo: es lo que se busca de
 *   una cobertura, no que suba cuando suben.
 *
 * LO QUE NO ES
 * No es gratis: hay que abrir y cerrar las dos patas (comisiones) y el
 * "basis" (la diferencia entre spot y perp) se mueve. El riesgo real es que
 * las cuotas se negativity (cuando el mercado esta muyalcista) y que el
 * basis se desmonte de golpe.
 *
 * TODO AQUI ES PURO (datos de entrada, resultado de salida): se puede
 * testear sin internet.
 */

export type Cuota = {
  /** Marca de tiempo (ms epoch). */
  t: number;
  /** Cuota pagada (0,0001 = 0,01 %). */
  r: number;
};

export type ResultadoCarry = {
  /** Cuotas por año natural. */
  porAnyo: Array<{ anio: number; suma: number; cuotas: number; anualizado: number }>;
  /** Total de cuotas cobradas (fraccion). */
  total: number;
  /** Total anualizado (compuesto). */
  anualizado: number;
  /** Dias cubiertos. */
  dias: number;
  /** La diferencia spot-perp al principio (el "basis"). */
  basisInicialPct: number;
  /** La diferencia spot-perp al final. */
  basisFinalPct: number;
};

/**
 * El carry a partir de las cuotas y de los precios de los extremos.
 *
 * @param cuotas las cuotas de financiacion (en orden cronologico)
 * @param spotInicial precio del spot al principio
 * @param spotFinal precio del spot al final
 * @param perpInicial precio del perpetuo al principio
 * @param perpFinal precio del perpetuo al final
 */
export function calcularCarry(args: {
  cuotas: readonly Cuota[];
  spotInicial: number;
  spotFinal: number;
  perpInicial: number;
  perpFinal: number;
}): ResultadoCarry {
  const { cuotas, spotInicial, spotFinal, perpInicial, perpFinal } = args;
  const total = cuotas.reduce((s, c) => s + c.r, 0);
  const primero = cuotas[0]?.t ?? 0;
  const ultimo = cuotas[cuotas.length - 1]?.t ?? 0;
  const dias = primero && ultimo ? Math.max(1, Math.round((ultimo - primero) / 86_400_000)) : 1;

  const porAnyoMap = new Map<number, { suma: number; n: number }>();
  for (const c of cuotas) {
    const anio = new Date(c.t).getUTCFullYear();
    const e = porAnyoMap.get(anio) ?? { suma: 0, n: 0 };
    e.suma += c.r;
    e.n++;
    porAnyoMap.set(anio, e);
  }
  const porAnyo = [...porAnyoMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([anio, e]) => ({
      anio,
      suma: e.suma,
      cuotas: e.n,
      // Las cuotas son cada 8 h: 3 al dia, 1.095 al año.
      anualizado: (Math.pow(1 + e.suma, 365 / Math.max(1, e.n / 3)) - 1) * 100,
    }));

  return {
    porAnyo,
    total,
    anualizado: (Math.pow(1 + total, 365 / dias) - 1) * 100,
    dias,
    basisInicialPct: ((perpInicial - spotInicial) / spotInicial) * 100,
    basisFinalPct: ((perpFinal - spotFinal) / spotFinal) * 100,
  };
}

/**
 * El P&L del carry completo (con las dos patas), en fraccion.
 *
 * P&L = (spot final - spot inicial) + (perp inicial - perp final) + cuotas
 * Es decir: lo que gano el spot, lo que gano el lado corto del perpetuo y las
 * cuotas cobradas. Las dos primeras se cancelan casi siempre (por eso el
 * carry depende de las cuotas, no de la direccion).
 */
export function pnlCarry(args: {
  cuotas: readonly Cuota[];
  spotInicial: number;
  spotFinal: number;
  perpInicial: number;
  perpFinal: number;
}): number {
  const { cuotas, spotInicial, spotFinal, perpInicial, perpFinal } = args;
  const pnlSpot = (spotFinal - spotInicial) / spotInicial;
  const pnlPerpCorto = (perpInicial - perpFinal) / perpInicial;
  const cuotasCobradas = cuotas.reduce((s, c) => s + c.r, 0);
  return pnlSpot + pnlPerpCorto + cuotasCobradas;
}
