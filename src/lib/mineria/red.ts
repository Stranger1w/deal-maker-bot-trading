/**
 * DATOS REALES DE LA RED Y DEL PRECIO.
 *
 * Sin esto, la mineria es fiction. Aqui seSacan los datos de verdad:
 *
 *  - Red de Bitcoin: mempool.space (hash rate de la red, dificultad y la
 *    recompensa real del ultimo bloque, con las comisiones incluidas).
 *  - Precio: Binance en PRODUCCION (no el testnet: minar produce dinero
 *    real, asi que el precio tiene que ser el de verdad).
 *
 * Para otras monedas no hay una API publica fiable y gratuita: en vez de
 * inventar numeros, se devuelve null y la app lo dice ("sin datos de la red").
 * El dueño puede pegar los numeros de su pool en el worker (network_config).
 */

import { hashRateRedDesdeDificultad, type RedMoneda } from "./modelo";

const MEMPOOL = "https://mempool.space/api";
const BINANCE = "https://api.binance.com";

/** Cuanto se cachean los datos de la red (el hashrate no cambia cada minuto). */
const CACHE_MS = 15 * 60 * 1000;

type CacheRed = { red: RedMoneda | null; at: number };
let cacheRed: CacheRed | null = null;

/**
 * Datos de la red de Bitcoin en vivo.
 *
 * @param precioUsd precio de BTC en USD (si no se sabe, la recompensa se
 * deja en 0 y el balance dira que falta el precio)
 */
export async function obtenerRedBtc(precioUsd: number): Promise<RedMoneda | null> {
  const ahora = Date.now();
  if (cacheRed && ahora - cacheRed.at < CACHE_MS) {
    return cacheRed.red ? { ...cacheRed.red, precioUsd } : null;
  }

  try {
    const [hashrateRes, bloquesRes] = await Promise.all([
      fetch(`${MEMPOOL}/v1/mining/hashrate/1m`, { signal: AbortSignal.timeout(15_000) }),
      fetch(`${MEMPOOL}/v1/blocks`, { signal: AbortSignal.timeout(15_000) }),
    ]);
    if (!hashrateRes.ok || !bloquesRes.ok) {
      cacheRed = { red: null, at: ahora };
      return null;
    }
    const hashrate = (await hashrateRes.json()) as {
      currentHashrate?: number;
      currentDifficulty?: number;
    };
    const bloques = (await bloquesRes.json()) as Array<{
      timestamp: number;
      extras?: { reward?: number };
    }>;

    const hashRateRed = Number(hashrate.currentHashrate ?? 0);
    const dificultad = Number(hashrate.currentDifficulty ?? 0);
    if (!hashRateRed || !bloques.length) {
      cacheRed = { red: null, at: ahora };
      return null;
    }

    // Recompensa real del ultimo bloque (en satoshis, con comisiones).
    const rewardSats = Number(bloques[0]?.extras?.reward ?? 0);
    const recompensaBloque = rewardSats / 1e8;

    // Tiempo medio de bloque: de las marcas de tiempo de los ultimos bloques.
    const primero = bloques[bloques.length - 1]?.timestamp ?? bloques[0]?.timestamp ?? 0;
    const ultimo = bloques[0]?.timestamp ?? 0;
    const intervalo = Math.max(1, Math.round((ultimo - primero) / Math.max(1, bloques.length - 1)));
    // La media teorica es 600 s; si la muestra se sale mucho, se usa la
    // dificultad (que ya lleva la media dentro).
    const tiempoBloqueSegundos =
      intervalo > 60 && intervalo < 1800 ? intervalo : Math.round(600 * 1) || intervalo;

    const red: RedMoneda = {
      coin: "BTC",
      hashRateRed,
      recompensaBloque,
      tiempoBloqueSegundos,
      precioUsd,
      fuente: "mempool.space (hash rate y recompensa del ultimo bloque)",
      fecha: new Date().toISOString().slice(0, 10),
    };
    cacheRed = { red, at: ahora };
    return red;
  } catch {
    cacheRed = { red: null, at: ahora };
    return null;
  }
}

/**
 * Hash rate de la red derivado de la dificultad (para cadenas SHA-256 sin
 * API): difficulty * 2^32 / tiempo de bloque.
 */
export function redDesdeDificultad(
  coin: string,
  dificultad: number,
  tiempoBloqueSegundos: number,
  recompensaBloque: number,
  precioUsd: number,
): RedMoneda {
  return {
    coin,
    hashRateRed: hashRateRedDesdeDificultad(dificultad, tiempoBloqueSegundos),
    recompensaBloque,
    tiempoBloqueSegundos,
    precioUsd,
    fuente: "dificultad publicada por la red",
    fecha: new Date().toISOString().slice(0, 10),
  };
}

/** Precio en USD de una moneda en Binance de PRODUCCION. */
export async function obtenerPrecioUsd(coin: string): Promise<number | null> {
  const simbolo = `${coin.toUpperCase()}USDT`;
  try {
    const res = await fetch(`${BINANCE}/api/v3/ticker/price?symbol=${simbolo}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const dato = (await res.json()) as { price?: string };
    const precio = Number(dato.price ?? 0);
    return Number.isFinite(precio) && precio > 0 ? precio : null;
  } catch {
    return null;
  }
}

/** Configuracion manual de la red que puede pegar el dueno en el worker. */
export type NetworkConfig = {
  hashRateRed?: number;
  recompensaBloque?: number;
  tiempoBloqueSegundos?: number;
  precioUsd?: number;
  fuente?: string;
  fecha?: string;
};

/** Convierte la config manual en una RedMoneda (null si no hay lo basico). */
export function redDesdeConfig(coin: string, cfg: NetworkConfig | null): RedMoneda | null {
  if (!cfg) return null;
  const hashRateRed = Number(cfg.hashRateRed ?? 0);
  const recompensaBloque = Number(cfg.recompensaBloque ?? 0);
  const tiempoBloqueSegundos = Number(cfg.tiempoBloqueSegundos ?? 0);
  if (!hashRateRed || !recompensaBloque || !tiempoBloqueSegundos) return null;
  return {
    coin,
    hashRateRed,
    recompensaBloque,
    tiempoBloqueSegundos,
    precioUsd: Number(cfg.precioUsd ?? 0),
    fuente: cfg.fuente ?? "introducido a mano",
    fecha: cfg.fecha ?? new Date().toISOString().slice(0, 10),
  };
}

/**
 * Red de una moneda: en vivo para BTC, manual para el resto.
 */
export async function obtenerRed(
  coin: string,
  configManual: NetworkConfig | null,
): Promise<RedMoneda | null> {
  const precio = configManual?.precioUsd ?? (await obtenerPrecioUsd(coin)) ?? 0;
  if (coin.toUpperCase() === "BTC") {
    const automatica = await obtenerRedBtc(precio);
    if (automatica) return automatica;
  }
  return redDesdeConfig(coin, configManual);
}
