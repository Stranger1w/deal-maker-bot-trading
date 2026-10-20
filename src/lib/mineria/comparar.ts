/**
 * COMPARATIVA DE MONEDAS CON TU EQUIPO REAL.
 *
 * La tabla mining_sandboxes tenia unos datos de ejemplo (120 TH/s, que es
 * una maquina dedicada, no un PC de casa) y NADIE los leia. Aqui se
 * convierten en algo util: con el hash rate REAL de esta maquina, los
 * datos REALES de la red y el precio REAL, cuanto da cada moneda y cuanto
 * cuesta la luz.
 *
 * La conclusion casi siempre es la misma: en un PC de casa no sale a
 * cuenta. La app lo dice, con numeros.
 */

import { balanceDiario, type HashRatePropio, type RedMoneda } from "./modelo";

/** Una fila de la comparativa. */
export type FilaComparativa = {
  coin: string;
  /** Hash rate que le tocaria a esta moneda si la minaras. */
  hashRate: number;
  hashUnit: string;
  /** La ganancia que cuenta el enjambre: lo que da la red (sin la luz). */
  gananciaUsd: number;
  /** Alias de `gananciaUsd`. */
  brutoUsd: number;
  /** Coste de luz al dia (se informa aparte: no se resta de la ganancia). */
  luzUsd: number;
  /** Bruto menos luz. */
  netoUsd: number;
  /** Monedas al dia (antes de la luz). */
  monedasDia: number;
  /** Datos de la red usados (null si no los hay). */
  red: RedMoneda | null;
  /** Texto de por que no se pudo calcular (si aplica). */
  motivo: string | null;
  /** Veredicto de esta fila. */
  veredicto: string;
};

export type ResultadoComparativa = {
  filas: FilaComparativa[];
  /** La mejor fila por neto (null si ninguna tiene datos). */
  mejor: FilaComparativa | null;
  /** Conclusion general. */
  veredicto: string;
  /** true si ninguna moneda cubre el coste de la luz. */
  ningunaSaleACuenta: boolean;
};

/**
 * Compara varias monedas con el hash rate dado.
 *
 * @param monedas lista de simbolos (BTC, KAS...)
 * @param redes datos de la red por moneda (null si no se pudieron obtener)
 * @param watts potencia estimada del equipo
 * @param precioKwh precio del kWh
 */
export function compararMonedas(
  monedas: readonly string[],
  redes: ReadonlyMap<string, RedMoneda | null>,
  hashRate: HashRatePropio,
  watts: number,
  precioKwh: number,
): ResultadoComparativa {
  const filas: FilaComparativa[] = [];

  for (const coin of monedas) {
    const red = redes.get(coin) ?? null;
    const balance = balanceDiario(hashRate, red, watts, precioKwh);
    filas.push({
      coin,
      hashRate: hashRate.hashPorSegundoRed,
      hashUnit: hashRate.unidad,
      gananciaUsd: balance.gananciaUsd,
      brutoUsd: balance.gananciaUsd,
      luzUsd: balance.luzUsd,
      netoUsd: balance.netoUsd,
      monedasDia: balance.monedasDia,
      red,
      motivo: red
        ? null
        : `Sin datos de la red de ${coin}: no se puede calcular la ganancia con honestidad.`,
      veredicto: balance.veredicto,
    });
  }

  const conDatos = filas.filter((f) => f.red !== null);
  // La mejor fila por ganancia (lo que cuenta el enjambre).
  const mejor = conDatos.length
    ? conDatos.reduce((a, b) => (b.gananciaUsd > a.gananciaUsd ? b : a))
    : null;
  const ningunaSaleACuenta = conDatos.length > 0 && conDatos.every((f) => f.netoUsd <= 0);

  let veredicto: string;
  if (!conDatos.length) {
    veredicto =
      "No hay datos de red de ninguna de las monedas: no se puede comparar nada. Pide en el pool los numeros (hash rate de la red, recompensa por bloque y tiempo de bloque) y metelos en el equipo.";
  } else if (mejor) {
    veredicto = `La mejor es ${mejor.coin} (${mejor.gananciaUsd.toFixed(8)} USD/dia de ganancia).`;
  } else {
    veredicto = "Sin comparacion posible con los datos disponibles.";
  }

  return { filas, mejor, veredicto, ningunaSaleACuenta };
}
