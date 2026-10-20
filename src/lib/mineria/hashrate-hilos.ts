/**
 * BENCHMARK MULTIHILO REAL.
 *
 * POR QUE
 * El benchmark original media SHA-256 en UN solo nucleo: 250-300 KH/s. La
 * maquina (i7-5600U) tiene 4 nucleos, asi que de verdad da bastante mas. El
 * "entrenamiento" de los mineros sirve justo para eso: MEDIR cuanto rinde la
 * maquina con 1, 2, 3 o 4 hilos, y que cada equipo use los que le tocan.
 *
 * NADA SIMULADO
 * Cada hilo es un worker real de Node (node:worker_threads) haciendo el
 * mismo SHA-256 de verdad. El resultado es la suma de los hashes contados.
 * Si la maquina no puede con 4 hilos, el numero sale menor: eso es lo que
 * esta midiendo.
 */

import { Worker } from "node:worker_threads";
import { cpus } from "node:os";

import { aUnidadLegible } from "./modelo";

/** Nucleos disponibles. */
export function nucleosDisponibles(): number {
  try {
    return Math.max(1, cpus().length);
  } catch {
    return 1;
  }
}

/** El codigo que corre cada worker (SHA-256 de verdad, en bucle). */
const CODIGO_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const { createHash } = require("node:crypto");
const duracion = workerData.duracion;
const fin = Date.now() + duracion;
let hashes = 0;
const bloque = Buffer.alloc(80, 0);
while (Date.now() < fin) {
  for (let i = 0; i < 2000; i++) {
    createHash("sha256").update(bloque).digest();
    hashes++;
  }
}
parentPort.postMessage({ hashes });
`;

export type MedicionHilos = {
  /** Hilos con los que se ha medido. */
  hilos: number;
  /** Hashes contados en total. */
  hashes: number;
  /** Hashes por segundo (todos los hilos juntos). */
  hashPorSegundo: number;
  /** Formato legible ("MH/s"). */
  valor: number;
  unidad: string;
  /** Milisegundos que duro la medicion. */
  duracionMs: number;
};

/**
 * Mide el hash rate REAL con N hilos.
 *
 * @param hilos numero de hilos (1..nucleos)
 * @param milisegundos duracion de la medicion
 */
export async function medirHashRateHilos(
  hilos: number,
  milisegundos = 2000,
): Promise<MedicionHilos> {
  const n = Math.max(1, Math.min(Math.round(hilos), nucleosDisponibles()));
  const duracion = Math.max(300, milisegundos);

  const resultados = await Promise.all(Array.from({ length: n }, () => runWorker(duracion)));
  const hashes = resultados.reduce((s, h) => s + h, 0);
  const hashPorSegundo = hashes / (duracion / 1000);
  const legible = aUnidadLegible(hashPorSegundo);

  return {
    hilos: n,
    hashes,
    hashPorSegundo,
    valor: legible.valor,
    unidad: legible.unidad,
    duracionMs: duracion,
  };
}

/** Lanza un worker y espera a que termine. */
function runWorker(duracion: number): Promise<number> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(CODIGO_WORKER, {
        eval: true,
        workerData: { duracion },
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
    } catch {
      resolve(0);
      return;
    }
    let resuelto = false;
    const finalizar = (valor: number) => {
      if (resuelto) return;
      resuelto = true;
      resolve(valor);
    };
    worker.on("message", (msg: { hashes?: number }) => finalizar(Number(msg?.hashes ?? 0)));
    worker.on("error", () => finalizar(0));
    worker.on("exit", () => finalizar(0));
  });
}

/**
 * La curva real: cuanto rinde la maquina con 1, 2, 3... hilos.
 * Sirve para elegir cuantos hilos le tocan a cada equipo.
 */
export async function medirCurvaHashrate(
  pasos: number[],
  milisegundos = 1500,
): Promise<MedicionHilos[]> {
  const maximo = nucleosDisponibles();
  const limpio = [...new Set(pasos.map((p) => Math.max(1, Math.min(Math.round(p), maximo))))].sort(
    (a, b) => a - b,
  );
  const curva: MedicionHilos[] = [];
  for (const n of limpio) {
    curva.push(await medirHashRateHilos(n, milisegundos));
  }
  return curva;
}
