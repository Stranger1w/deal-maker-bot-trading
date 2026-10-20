/**
 * MODELO DE MINERIA (funciones puras, sin base de datos ni red).
 *
 * QUE PROBLEMA RESUELVE
 * La mineria estaba de adorno: los workers tenian un hash rate de 0 y unas
 * ganancias inventadas (34,32 USD/dia de una CPU de casa). Aqui se calcula
 * de verdad, con la misma honestidad que el resto del motor:
 *
 *   1) el hash rate REAL de la maquina (lo mide el benchmark del CPU),
 *   2) la parte de la red que te toca (hash rate propio / hash rate de la red),
 *   3) la recompensa diaria de la red (bloques por dia x recompensa),
 *   4) el precio real de la moneda,
 *   5) y el COSTE DE LA LUZ, que es lo que suele decides que minar en casa
 *      no sale a cuenta.
 *
 * El resultado neto casi siempre es NEGATIVO en un PC de casa. No es un
 * fallo: es la verdad, y la app debe decirla.
 */

/** Datos de la red de una moneda (los que necesita el calculo). */
export type RedMoneda = {
  coin: string;
  /** Hash rate de TODA la red, en hashes por segundo (H/s). */
  hashRateRed: number;
  /** Recompensa por bloque, en monedas. */
  recompensaBloque: number;
  /** Tiempo medio entre bloques, en segundos. */
  tiempoBloqueSegundos: number;
  /** Precio de la moneda en USD. */
  precioUsd: number;
  /** De donde salen los datos (para que el dueño pueda dudar). */
  fuente: string;
  /** Fecha de los datos (si es una tabla manual, caduca). */
  fecha?: string;
};

/** Hash rate propio, en hashes por segundo. */
export type HashRatePropio = {
  hashPorSegundo: number;
  /** "MH/s" | "GH/s" | "TH/s" | "EH/s" */
  unidad: string;
  /** Hash rate en la unidad de la red (por ejemplo TH/s). */
  hashPorSegundoRed: number;
  /** Hash rate en hashes por segundo (para la red). */
  hashPorSegundoHashes: number;
};

/** Conversor de unidades de hash rate. */
const FACTORES: Record<string, number> = {
  "H/s": 1,
  "KH/s": 1e3,
  "MH/s": 1e6,
  "GH/s": 1e9,
  "TH/s": 1e12,
  "PH/s": 1e15,
  "EH/s": 1e18,
};

/** Convierte un hash rate a hashes por segundo. */
export function aHashesPorSegundo(valor: number, unidad: string): number {
  const factor = FACTORES[unidad] ?? FACTORES["MH/s"]!;
  return valor * factor;
}

/** Convierte hashes por segundo a la unidad mas legible. */
export function aUnidadLegible(hashPorSegundo: number): {
  valor: number;
  unidad: string;
} {
  if (hashPorSegundo >= 1e18) return { valor: hashPorSegundo / 1e18, unidad: "EH/s" };
  if (hashPorSegundo >= 1e15) return { valor: hashPorSegundo / 1e15, unidad: "PH/s" };
  if (hashPorSegundo >= 1e12) return { valor: hashPorSegundo / 1e12, unidad: "TH/s" };
  if (hashPorSegundo >= 1e9) return { valor: hashPorSegundo / 1e9, unidad: "GH/s" };
  if (hashPorSegundo >= 1e6) return { valor: hashPorSegundo / 1e6, unidad: "MH/s" };
  if (hashPorSegundo >= 1e3) return { valor: hashPorSegundo / 1e3, unidad: "KH/s" };
  return { valor: hashPorSegundo, unidad: "H/s" };
}

/**
 * Hash rate de una red SHA-256 a partir de la dificultad y el tiempo de
 * bloque. Es la formula estandar: hashrate_red = dificultad * 2^32 / t_bloque.
 */
export function hashRateRedDesdeDificultad(
  dificultad: number,
  tiempoBloqueSegundos: number,
): number {
  if (!dificultad || !tiempoBloqueSegundos) return 0;
  return (dificultad * 2 ** 32) / tiempoBloqueSegundos;
}

/** Recompensa diaria de toda la red, en monedas. */
export function recompensaDiariaRed(
  red: Pick<RedMoneda, "recompensaBloque" | "tiempoBloqueSegundos">,
): number {
  if (!red.tiempoBloqueSegundos) return 0;
  return (86400 / red.tiempoBloqueSegundos) * red.recompensaBloque;
}

/**
 * Ganancia BRUTA diaria: la parte de la red que te toca por tu hash rate,
 * valued al precio de la moneda. NO descuenta la luz (eso es `costeLuzDiario`).
 */
export function gananciaBrutaDiaria(
  hashPropio: HashRatePropio,
  red: RedMoneda,
): { usd: number; monedas: number; cuotaRed: number } {
  if (!red.hashRateRed || !red.precioUsd) {
    return { usd: 0, monedas: 0, cuotaRed: 0 };
  }
  // La red se mide en hashes por segundo (red.hashRateRed) y el hash rate de
  // la red de referencia tambien: por eso se normaliza con la misma unidad.
  const cuotaRed = hashPropio.hashPorSegundoHashes / red.hashRateRed;
  const monedas = cuotaRed * recompensaDiariaRed(red);
  return { usd: monedas * red.precioUsd, monedas, cuotaRed };
}

/**
 * Coste diario de la luz de un equipo: vatios x 24 h / 1000 x precio kWh.
 */
export function costeLuzDiario(watts: number, precioKwhUsd: number): number {
  if (!watts || !precioKwhUsd) return 0;
  return ((watts * 24) / 1000) * precioKwhUsd;
}

/** Resultado completo de un equipo (o del enjambre). */
export type Balance = {
  /** Ingreso bruto por dia, en USD. */
  brutoUsd: number;
  /** Coste de luz por dia, en USD. */
  luzUsd: number;
  /** Bruto menos luz. */
  netoUsd: number;
  /** Monedas al dia (antes de la luz). */
  monedasDia: number;
  /** Cuota de la red (0.0001 = una diezmilesima parte). */
  cuotaRed: number;
  /** Veredicto en palabras claras. */
  veredicto: string;
  /** true si el equipo NO llega a cubrir la luz. */
  noSaleACuenta: boolean;
};

/** Calcula el balance diario de un equipo. */
export function balanceDiario(
  hashPropio: HashRatePropio,
  red: RedMoneda | null,
  watts: number,
  precioKwhUsd: number,
): Balance {
  const bruto = red ? gananciaBrutaDiaria(hashPropio, red) : { usd: 0, monedas: 0, cuotaRed: 0 };
  const luzUsd = costeLuzDiario(watts, precioKwhUsd);
  const netoUsd = bruto.usd - luzUsd;
  const noSaleACuenta = netoUsd <= 0;

  let veredicto: string;
  if (!red) {
    veredicto =
      "Sin datos de la red de esta moneda: no se puede calcular la ganancia con honestidad.";
  } else if (bruto.usd <= 0) {
    veredicto =
      "Tu hash rate es una fraccion de la red: la recompensa diaria te da cero. No hay ganancia posible con esta maquina.";
  } else if (noSaleACuenta) {
    veredicto = `Ganas ${bruto.usd.toFixed(4)} USD al dia y la luz te cuesta ${luzUsd.toFixed(4)} USD: pierdes ${Math.abs(netoUsd).toFixed(4)} USD al dia. Minar en casa NO sale a cuenta.`;
  } else {
    veredicto = `Ganas ${bruto.usd.toFixed(4)} USD al dia y la luz te cuesta ${luzUsd.toFixed(4)} USD: sobran ${netoUsd.toFixed(4)} USD al dia (sin contar el desgaste del equipo ni el calor).`;
  }

  return {
    brutoUsd: bruto.usd,
    luzUsd,
    netoUsd,
    monedasDia: bruto.monedas,
    cuotaRed: bruto.cuotaRed,
    veredicto,
    noSaleACuenta,
  };
}

/**
 * Como se reparten los workers de una maquina: todos usan el MISMO CPU, asi
 * que tres workers minando no dan tres veces el hash rate. Se reparte a partes
 * iguales entre los que estan activos.
 */
export function repartirHashRate(hashRateMaquina: number, numeroWorkersActivos: number): number {
  if (numeroWorkersActivos <= 0) return 0;
  return hashRateMaquina / numeroWorkersActivos;
}

/** Cuantos workers comparten la maquina (los que estan minando). */
export function workersActivos(workers: ReadonlyArray<{ status: string }>): number {
  return workers.filter((w) => w.status === "mining").length;
}
