/**
 * Estrategia ALEATORIA de referencia (seccion 6B.4 del plan).
 *
 * QUE ES Y POR QUE
 * "Supera al mercado" no es suficiente: un bot puede ganar por azar durante
 * un mes. La referencia dura es la estrategia ALEATORIA: la MISMA estrategia
 * pero con la señal al azar. Se ejecuta con el MISMO motor (mismas reglas de
 * salida, mismo tamaño, mismos costes, mismo stop): lo unico que cambia es
 * que la entrada no viene de un indicador, sino del azar.
 *
 * Si la estrategia real no gana a esa referencia, no tiene ventaja: solo ha
 * tenido suerte.
 *
 * El PRNG es determinista (misma semilla, mismos numeros) para que el
 * resultado sea reproducible: el backtest tiene que dar siempre lo mismo.
 */

import { ejecutarBacktest } from "./engine";
import type { ConfigBacktest, Vela } from "./types";

/** PRNG determinista (mulberry32): misma semilla, mismos numeros. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Señal aleatoria: va alternando entre "buy" y "sell" en momentos al azar.
 *
 * `probabilidadCambio` es la probabilidad de que la señal cambie en cada
 * vela: controla cada cuanto se cierra una posicion (y por tanto cuantas
 * operaciones se hacen). Se calibra con la duracion media real.
 */
export function senalAleatoria(semilla: number, probabilidadCambio: number) {
  const azar = prng(semilla);
  let actual: "buy" | "sell" = azar() > 0.5 ? "buy" : "sell";
  return () => {
    if (azar() < probabilidadCambio) {
      actual = actual === "buy" ? "sell" : "buy";
    }
    return actual;
  };
}

/**
 * Ejecuta la MISMA estrategia pero con la señal al azar.
 *
 * Devuelve el retorno neto en porcentaje (con los mismos costes que la
 * estrategia real: comparar sin costes seria tramposo).
 */
export function backtestAleatorio(
  velas: readonly Vela[],
  config: ConfigBacktest,
  semilla: number,
  opciones: { operacionesObjetivo?: number } = {},
): number {
  if (velas.length < 20) return 0;

  // Duracion media de la posicion real (velas por operacion): la señal
  // aleatoria cambia con esa frecuencia, asi que hace un numero parecido de
  // operaciones (comparar estrategias que operan distinto no vale).
  const objetivo = Math.max(1, opciones.operacionesObjetivo ?? 0);
  const velasPorOperacion = objetivo > 0 ? velas.length / objetivo : 20;
  const probabilidadCambio = Math.min(0.9, 1 / Math.max(2, velasPorOperacion));

  const r = ejecutarBacktest(
    velas,
    { ...config, senal: senalAleatoria(semilla, probabilidadCambio) },
    { simbolo: config.etiqueta ?? "ALEATORIO" },
  );
  return r.metricas.retornoNetoPct;
}

export type ReferenciaAleatoria = {
  /** Numero de ejecuciones de la referencia. */
  ejecuciones: number;
  /** Mejor resultado de la referencia (%). */
  mejorPct: number;
  /** Resultado mediano (%). */
  medianaPct: number;
  /** Peor resultado de la referencia (%). */
  peorPct: number;
  /** Resultado de la estrategia real (%). */
  nuestraPct: number;
  /** Percentil de la estrategia real dentro de la referencia (0-100). */
  percentil: number;
  /** true si la estrategia real gana a la MAYORIA de las aleatorias. */
  mejorQueLaMayoria: boolean;
  /** Veredicto legible. */
  veredicto: string;
};

/**
 * Compara el resultado de la estrategia real con la distribucion de la
 * estrategia aleatoria.
 */
export function compararConAleatoria(
  nuestraPct: number,
  aleatorios: readonly number[],
): ReferenciaAleatoria {
  const n = aleatorios.length;
  if (n === 0) {
    return {
      ejecuciones: 0,
      mejorPct: 0,
      medianaPct: 0,
      peorPct: 0,
      nuestraPct: Number(nuestraPct.toFixed(4)),
      percentil: 50,
      mejorQueLaMayoria: false,
      veredicto: "Sin referencia aleatoria: no se puede concluir nada.",
    };
  }
  const ordenados = [...aleatorios].sort((a, b) => a - b);
  const mejor = ordenados[ordenados.length - 1]!;
  const peor = ordenados[0]!;
  const mediana = ordenados[Math.floor(ordenados.length / 2)]!;
  const ganadoras = ordenados.filter((v) => v <= nuestraPct).length;
  const percentil = (ganadoras / n) * 100;

  return {
    ejecuciones: n,
    mejorPct: Number(mejor.toFixed(4)),
    medianaPct: Number(mediana.toFixed(4)),
    peorPct: Number(peor.toFixed(4)),
    nuestraPct: Number(nuestraPct.toFixed(4)),
    percentil: Number(percentil.toFixed(1)),
    mejorQueLaMayoria: percentil >= 60,
    veredicto:
      percentil >= 60
        ? `La estrategia gana al ${percentil.toFixed(0)} % de las estrategias aleatorias: hay algo mas que azar (todavia no es una garantia).`
        : `La estrategia solo gana al ${percentil.toFixed(0)} % de las aleatorias: no se puede distinguir del azar.`,
  };
}
