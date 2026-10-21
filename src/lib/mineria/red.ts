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
 *  - Red de las demas monedas: la pagina publica del pool (2miners) trae
 *    "Network Hashrate" y "Block Reward" en vivo. Asi, por ejemplo, KAS ya
 *    sale con numeros reales sin que el dueno tenga que pegar nada.
 *  - Si esa fuente tampoco esta (o no trae los datos), se devuelve null y la
 *    app lo dice ("sin datos de la red"); el dueno puede pegar los numeros de
 *    su pool en el worker (network_config).
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

/**
 * Tiempo de bloque (segundos) de las monedas cuyo protocolo lo fija:
 * no sale de ninguna API, es una constante de la red.
 */
const TIEMPO_BLOQUE_FIJO: Record<string, number> = {
  // Kaspa: el DAA avanza un punto por segundo, asi que el bloque sale cada 1 s.
  KAS: 1,
  // Bitcoin: 10 minutos.
  BTC: 600,
};

/** Convierte "359.30 PH/s" a hashes por segundo. */
export function aHashesPorSegundo(valor: number, unidad: string): number {
  const u = unidad.trim().toUpperCase();
  const factor = u.startsWith("PH")
    ? 1e15
    : u.startsWith("EH")
      ? 1e18
      : u.startsWith("TH")
        ? 1e12
        : u.startsWith("GH")
          ? 1e9
          : u.startsWith("MH")
            ? 1e6
            : u.startsWith("KH")
              ? 1e3
              : u.startsWith("H")
                ? 1
                : 0;
  return factor ? valor * factor : 0;
}

/**
 * Lee un valor de la pagina del pool (2miners).
 *
 * El HTML trae: `<div class="pool-network__label">Network Hashrate</div>
 * <div class="pool-network__val">359.30<small>PH/s</small></div>`.
 */
function valorDelPool(html: string, etiqueta: string): { valor: number; unidad: string } | null {
  const i = html.indexOf(etiqueta);
  if (i < 0) return null;
  const trozo = html.slice(i, i + 400);
  const m = /pool-network__val">([\d.,]+)<small>([^<]*)<\/small>/.exec(trozo);
  if (!m) return null;
  const valor = Number(m[1]!.replace(/,/g, "."));
  if (!Number.isFinite(valor)) return null;
  return { valor, unidad: m[2] ?? "" };
}

/**
 * Red de una moneda desde la pagina publica de su pool (2miners).
 *
 * Es la fuente que usa el dueno: sus pools son los de 2miners, y la pagina
 * de cada moneda trae el hash rate de la RED y la RECOMPENSA del bloque, en
 * vivo. Sin esto, KAS (y las demas) salian sin datos de la red.
 */
export async function obtenerRedDesdePool(
  coin: string,
  precioUsd: number,
): Promise<RedMoneda | null> {
  const simbolo = coin.toUpperCase();
  if (simbolo === "BTC") return null; // BTC tiene su propia fuente (mempool).
  const url = `https://2miners.com/${simbolo.toLowerCase()}-mining-pool`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "DealMaker/1.0 (mineria)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const red = valorDelPool(html, "Network Hashrate");
    const recompensa = valorDelPool(html, "Block Reward");
    if (!red || !recompensa) return null;
    const hashRateRed = aHashesPorSegundo(red.valor, red.unidad);
    if (!hashRateRed) return null;
    const tiempoBloqueSegundos = TIEMPO_BLOQUE_FIJO[simbolo] ?? 600;
    return {
      coin: simbolo,
      hashRateRed,
      recompensaBloque: recompensa.valor,
      tiempoBloqueSegundos,
      precioUsd,
      fuente: `2miners (pagina del pool, ${red.valor} ${red.unidad})`,
      fecha: new Date().toISOString().slice(0, 10),
    };
  } catch {
    return null;
  }
}

/** Precio en USD de una moneda en Binance de PRODUCCION. */
export async function obtenerPrecioUsd(coin: string): Promise<number | null> {
  const simbolo = `${coin.toUpperCase()}USDT`;
  try {
    const res = await fetch(`${BINANCE}/api/v3/ticker/price?symbol=${simbolo}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const dato = (await res.json()) as { price?: string };
      const precio = Number(dato.price ?? 0);
      if (Number.isFinite(precio) && precio > 0) return precio;
    }
  } catch {
    // Binance no tiene el par (KAS, por ejemplo): se prueba CoinGecko.
  }
  // Fallback: CoinGecko por simbolo (el id no siempre es el simbolo: KAS es
  // "kaspa"). Se usa /coins/markets, que trae simbolo, id y precio a la vez.
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1",
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return null;
    const lista = (await res.json()) as Array<{
      symbol?: string;
      current_price?: number;
    }>;
    const m = lista.find((c) => (c.symbol ?? "").toUpperCase() === coin.toUpperCase());
    const precio = Number(m?.current_price ?? 0);
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
  // 1) Lo que haya pegado el dueno (tiene prioridad).
  const manual = redDesdeConfig(coin, configManual);
  if (manual) return manual;
  // 2) Si no, la pagina del pool: numeros reales, en vivo.
  return await obtenerRedDesdePool(coin, precio);
}
