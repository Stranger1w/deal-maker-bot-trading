/**
 * MEDIDA REAL DEL HASH RATE DE LA MAQUINA.
 *
 * No es una simulacion: se mide SHA-256 de verdad con el crypto de Node, que
 * es justo lo que hacen los mineros de CPU (BTC, LTC, SHA-256...). El
 * resultado se cachea unos minutos porque cada medicion gasta CPU de verdad.
 *
 * Ojo con las cifras: un PC de casa da de MILES a UNOS POCOS MILES de
 * MH/s (0,001-0,01 TH/s). Un minero ASIC dedicated da 100 TH/s o mas. La
 * diferencia de escala es la que hace que minar en casa no salga a cuenta,
 * y la app tiene que decirlo con los numeros reales.
 */

import { createHash } from "node:crypto";

import { aUnidadLegible } from "./modelo";

/** Cache de la medicion (ms). La medicion gasta CPU: no se repite cada minuto. */
const CACHE_MS = 10 * 60 * 1000;

type Cache = {
  hashPorSegundo: number;
  medidoAt: number;
  muestras: number;
};

let cache: Cache | null = null;

/**
 * Mide el hash rate SHA-256 de esta maquina.
 *
 * @param milisegundos duracion de la medicion (corta: consume CPU de verdad)
 */
export function medirHashRateMaquina(milisegundos = 1200): {
  hashPorSegundo: number;
  valor: number;
  unidad: string;
  medidoAt: string;
  muestras: number;
  cacheado: boolean;
} {
  const ahora = Date.now();
  if (cache && ahora - cache.medidoAt < CACHE_MS) {
    const legible = aUnidadLegible(cache.hashPorSegundo);
    return {
      hashPorSegundo: cache.hashPorSegundo,
      valor: legible.valor,
      unidad: legible.unidad,
      medidoAt: new Date(cache.medidoAt).toISOString(),
      muestras: cache.muestras,
      cacheado: true,
    };
  }

  // Dos rondas, la mejor: si el PC esta ocupado, la primera medida sale
  // bajisima y envenenaba la cache (el enjambre arrive a 36 KH/s cuando
  // la maquina da 1,6 MH/s).
  const duracionRonda = Math.max(300, Math.floor(milisegundos / 2));
  const primera = medirHashes(duracionRonda);
  const segunda = medirHashes(duracionRonda);
  const muestras = segunda.hashPorSegundo >= primera.hashPorSegundo ? segunda : primera;
  const hashPorSegundo = muestras.hashPorSegundo;
  cache = { hashPorSegundo, medidoAt: ahora, muestras: muestras.hashes };

  const legible = aUnidadLegible(hashPorSegundo);
  return {
    hashPorSegundo,
    valor: legible.valor,
    unidad: legible.unidad,
    medidoAt: new Date(ahora).toISOString(),
    muestras: muestras.hashes,
    cacheado: false,
  };
}

/** Solo el hash rate (usado por el tick, que ya cachea). */
export function hashRateMaquinaCacheado(): number | null {
  return cache ? cache.hashPorSegundo : null;
}

/** Descarta la cache (para forzar una medicion nueva). */
export function invalidarCacheHashRate(): void {
  cache = null;
}

/** Hashes por segundo medidos de verdad. */
function medirHashes(milisegundos: number): { hashPorSegundo: number; hashes: number } {
  const limite = Date.now() + milisegundos;
  let hashes = 0;
  const bloque = Buffer.alloc(80, 0);
  while (Date.now() < limite) {
    // Rondas cortas para no comerse el hilo entero del event loop.
    for (let i = 0; i < 2000; i++) {
      createHash("sha256").update(bloque).digest();
      hashes++;
    }
  }
  const segundos = Math.max(milisegundos, 1) / 1000;
  return { hashPorSegundo: hashes / segundos, hashes };
}
