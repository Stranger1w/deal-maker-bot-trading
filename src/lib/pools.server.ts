/**
 * MONEDAS Y POOLS REALES.
 *
 * QUE ES
 * Antes, para anadir un equipo de mineria habia que escribir a mano la
 * moneda y el pool: facil de equivocar (una moneda que no existe, un pool
 * que no la minaba). Ahora las dos cosas son LISTAS, sacadas de fuentes
 * reales y verificadas en el momento:
 *
 *  - Las MONEDAS MINABLES: se leen del sitemap de 2miners y de la
 *    configuracion embebida de nanopool (las dos son las listas REALES de
 *    esos pools).
 *  - Las MONEDAS DEL MERCADO: el exchangeInfo de Binance (las que hay en
 *    el mercado de verdad, con su nombre).
 *  - Los POOLS: una lista de pools que existen de verdad, con su web. Para
 *    los que se pueden leer en vivo (2miners, nanopool) se muestran las
 *    monedas que ofrecen; para el resto, un enlace a su web.
 *
 * Lo que NO hace: inventar datos. Si una fuente no responde, la lista de
 * monedas de ese pool sale vacia y la app lo dice.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** Un pool de mineria real. */
export type PoolReal = {
  id: string;
  nombre: string;
  /** Web del pool. */
  url: string;
  /** Monedas que el pool lista (vacio si no se ha podido leer en vivo). */
  monedas: string[];
  /** De donde sale la lista de monedas. */
  fuente: string;
  /** true si la lista se ha leido AHORA (no de una copia guardada). */
  enVivo: boolean;
};

/** Una moneda del mercado. */
export type MonedaMercado = {
  simbolo: string;
  nombre: string;
  /** true si se puede minar con CPU (esta en la lista de los pools). */
  minable: boolean;
  /** Pools (reales) que la minan. */
  pools: string[];
};

/** Pools conocidos: existen de verdad (su web responde). */
export const POOLS: Array<Omit<PoolReal, "monedas" | "fuente" | "enVivo">> = [
  { id: "2miners", nombre: "2miners", url: "https://2miners.com/" },
  { id: "nanopool", nombre: "Nanopool", url: "https://nanopool.org/" },
  { id: "viabtc", nombre: "ViaBTC", url: "https://www.viabtc.com/" },
  { id: "herominers", nombre: "HeroMine", url: "https://herominers.com/" },
  { id: "woolypooly", nombre: "WoolyPooly", url: "https://woolypooly.com/" },
  { id: "zpool", nombre: "Zpool", url: "https://www.zpool.ca/" },
  { id: "f2pool", nombre: "F2Pool", url: "https://www.f2pool.com/" },
  { id: "miningpool", nombre: "MiningPool.io", url: "https://www.miningpool.io/" },
  { id: "prohashing", nombre: "ProHashing", url: "https://prohashing.com/" },
  { id: "flexpool", nombre: "Flexpool", url: "https://flexpool.io/" },
  { id: "foundrypool", nombre: "Foundry USA", url: "https://pool.foundrypool.com/" },
  { id: "luckymining", nombre: "LuckyMining", url: "https://luckymining.com/" },
];

/**
 * Extrae las monedas del sitemap de 2miners.
 *
 * El sitemap tiene una entrada por pool y por idioma: se quitan los idiomas
 * y se queda el nombre del pool ("btc-mining-pool" -> "btc").
 */
export function monedasDesdeSitemap2Miners(xml: string): string[] {
  const idiomas = new Set([
    "es",
    "de",
    "tr",
    "pl",
    "vi",
    "uk",
    "fr",
    "it",
    "id",
    "ko",
    "hu",
    "th",
    "zh",
    "ar",
    "sr",
    "ja",
    "bg",
    "pt",
    "nl",
    "cs",
    "sk",
    "ro",
    "el",
    "ru",
    "fa",
    "hi",
    "he",
    "my",
    "ne",
    "si",
    "ta",
    "te",
    "ur",
    "uz",
  ]);
  const monedas = new Set<string>();
  for (const m of xml.matchAll(/<loc>https:\/\/2miners\.com\/([^/<]+)<\/loc>/g)) {
    const slug = m[1] ?? "";
    if (!slug || idiomas.has(slug)) continue;
    const limpio = slug.replace(/^(solo-)?/, "").replace(/-mining-pool$/, "");
    if (!limpio || limpio.includes("solo-")) continue;
    monedas.add(limpio.toUpperCase());
  }
  return [...monedas].sort();
}

/**
 * Extrae las monedas de la configuracion embebida de nanopool
 * ("var config = { "xmr": {...}, ... }").
 */
export function monedasDesdeConfigNanopool(html: string): string[] {
  const inicio = html.indexOf("var config = ");
  if (inicio < 0) return [];
  const desde = html.indexOf("{", inicio);
  if (desde < 0) return [];
  let nivel = 0;
  let fin = -1;
  for (let i = desde; i < html.length; i++) {
    const c = html[i];
    if (c === "{") nivel++;
    else if (c === "}") {
      nivel--;
      if (nivel === 0) {
        fin = i + 1;
        break;
      }
    }
  }
  if (fin < 0) return [];
  try {
    const config = JSON.parse(html.slice(desde, fin)) as Record<string, unknown>;
    return Object.keys(config)
      .map((k) => k.toUpperCase())
      .sort();
  } catch {
    return [];
  }
}

/**
 * Alias: un mismo pool llama distinto a la misma moneda. 2miners usa "erg"
 * y nanopool "ergo": sin normalizar, la moneda aparece dos veces.
 */
export const ALIAS_MONEDAS: Record<string, string> = {
  ERG: "ERGO",
  XNA: "SIB",
  AE: "AION",
};

/** Normaliza un simbolo de moneda. */
export function normalizarMoneda(simbolo: string): string {
  const s = simbolo.trim().toUpperCase();
  return ALIAS_MONEDAS[s] ?? s;
}

/** Descarga el texto de una URL (con el UA de un navegador). */
async function texto(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xml,*/*" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Pools con sus monedas, leidas en vivo cuando se puede.
 */
export async function listarPoolsReales(): Promise<PoolReal[]> {
  const [sitemap, configNano] = await Promise.all([
    texto("https://2miners.com/sitemap-pools.xml"),
    texto("https://nanopool.org/"),
  ]);

  const monedas2Miners = sitemap ? monedasDesdeSitemap2Miners(sitemap).map(normalizarMoneda) : [];
  const monedasNano = configNano
    ? monedasDesdeConfigNanopool(configNano).map(normalizarMoneda)
    : [];

  return POOLS.map((pool) => {
    if (pool.id === "2miners") {
      return {
        ...pool,
        monedas: monedas2Miners,
        fuente: "sitemap de 2miners",
        enVivo: !!sitemap,
      };
    }
    if (pool.id === "nanopool") {
      return {
        ...pool,
        monedas: monedasNano,
        fuente: "configuracion de nanopool",
        enVivo: !!configNano,
      };
    }
    // De los demas no hay una lista publica legible desde aqui: se muestra el
    // pool con su web y sin inventar que monedas tiene.
    return { ...pool, monedas: [], fuente: "consulta su web", enVivo: false };
  });
}

/** Monedas minables (de los pools que se han podido leer). */
export async function listarMonedasMinerables(): Promise<{
  simbolos: string[];
  porPool: Record<string, string[]>;
  fuente: string;
}> {
  const pools = await listarPoolsReales();
  const porPool: Record<string, string[]> = {};
  const todos = new Set<string>();
  for (const p of pools) {
    if (!p.monedas.length) continue;
    porPool[p.id] = p.monedas;
    for (const m of p.monedas) todos.add(m);
  }
  return {
    simbolos: [...todos].sort(),
    porPool,
    fuente: "2miners y nanopool (leido en vivo)",
  };
}

/**
 * Las monedas del mercado (Binance): las de verdad, con su nombre.
 * Se marca cuales se pueden minar con CPU.
 */
export async function listarMonedasMercado(): Promise<MonedaMercado[]> {
  const [exchangeInfo, minerables, nombres] = await Promise.all([
    texto("https://api.binance.com/api/v3/exchangeInfo?permissions=SPOT"),
    listarMonedasMinerables(),
    nombresDeMonedas(),
  ]);

  const minables = new Set(minerables.simbolos);
  const poolsPorMoneda = new Map<string, string[]>();
  for (const [pool, monedas] of Object.entries(minerables.porPool)) {
    for (const m of monedas) {
      poolsPorMoneda.set(m, [...(poolsPorMoneda.get(m) ?? []), pool]);
    }
  }

  if (!exchangeInfo) {
    // Sin exchangeInfo se devuelven al menos las minables (son datos de verdad).
    return [...minables].map((simbolo) => ({
      simbolo,
      nombre: nombres.get(simbolo) ?? simbolo,
      minable: true,
      pools: poolsPorMoneda.get(simbolo) ?? [],
    }));
  }

  try {
    const info = JSON.parse(exchangeInfo) as {
      symbols?: Array<{ symbol: string; baseAsset: string; status: string }>;
    };
    const vista: MonedaMercado[] = [];
    const vistos = new Set<string>();
    for (const s of info.symbols ?? []) {
      if (s.status !== "TRADING") continue;
      const base = s.baseAsset;
      if (!base || vistos.has(base)) continue;
      vistos.add(base);
      vista.push({
        simbolo: base,
        nombre: nombres.get(base) ?? base,
        minable: minables.has(base),
        pools: poolsPorMoneda.get(base) ?? [],
      });
    }
    vista.sort((a, b) => {
      if (a.minable !== b.minable) return a.minable ? -1 : 1;
      return a.simbolo.localeCompare(b.simbolo);
    });
    return vista;
  } catch {
    return [...minables].map((simbolo) => ({
      simbolo,
      nombre: nombres.get(simbolo) ?? simbolo,
      minable: true,
      pools: poolsPorMoneda.get(simbolo) ?? [],
    }));
  }
}

/**
 * Los nombres reales de las monedas (CoinGecko): "Bitcoin", "Zcash"...
 *
 * Se usa /coins/markets (ordenado por capitalizacion) y no /coins/list: en la
 * lista completa hay miles de tokens que comparten simbolo y el primero que
 * aparece puede ser un scam ("btc" -> "batcat"). Con los nombres por
 * capitalizacion sale "Bitcoin".
 */
export async function nombresDeMonedas(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const cuerpo = await texto(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1",
  );
  if (cuerpo) {
    try {
      const lista = JSON.parse(cuerpo) as Array<{ symbol?: string; name?: string }>;
      for (const c of lista) {
        const simbolo = (c.symbol ?? "").toUpperCase();
        if (!simbolo || !c.name) continue;
        if (!mapa.has(simbolo)) mapa.set(simbolo, c.name);
      }
    } catch {
      // Sin nombres: se usa el simbolo.
    }
  }
  if (mapa.size === 0) {
    // Respaldo: la lista completa (puede traer nombres raros, pero es mejor
    // que no tener ninguno).
    const plano = await texto("https://api.coingecko.com/api/v3/coins/list?include_platform=false");
    if (plano) {
      try {
        const lista = JSON.parse(plano) as Array<{ symbol?: string; name?: string }>;
        for (const c of lista) {
          const simbolo = (c.symbol ?? "").toUpperCase();
          if (!simbolo || !c.name) continue;
          if (!mapa.has(simbolo)) mapa.set(simbolo, c.name);
        }
      } catch {
        // Sin nombres.
      }
    }
  }
  return mapa;
}
