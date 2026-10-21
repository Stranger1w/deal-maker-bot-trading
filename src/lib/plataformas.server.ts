/**
 * DATOS DE MERCADO EN VARIAS PLATAFORMAS.
 *
 * QUE ES
 * El sandbox (y el backtest) necesitan velas historicas. Estar atado a una
 * sola plataforma es un problema: si esa se cae, bloquea o cambia, no hay
 * datos. Ademas, comparar el mismo par en dos plataformas es una forma
 * de detectar manipulacion: si Binance y Coinbase dicen precios distintos,
 * algo raro pasa.
 *
 * Aqui hay varias plataformas (Binance spot y futuros, Bybit, OKX, Kraken,
 * Coinbase, Hyperliquid) con el MISMO formato de salida (Vela), y un
 * metodo para saber de donde salio cada vela.
 *
 * De los datos de traders SOLO hay una fuente con detalle publico (posiciones de
 * cuentas grandes): Binance Futures. Las demas plataformas se usan para
 * precios.
 */

import type { Vela } from "./backtest/types";

/** De donde vienen los datos (queda escrito en la base y se ensena). */
export type FuentePlataforma = {
  /** Nombre corto: "Binance", "Bybit", "OKX"... */
  id: string;
  /** Mercado: spot o futuros perpetuos. */
  mercado: "spot" | "futuros";
  /** Texto largo para la interfaz. */
  nombre: string;
  /** Si publica datos de posicionamiento de traders. */
  tieneTraders: boolean;
};

export const PLATAFORMAS: FuentePlataforma[] = [
  { id: "binance-futuros", mercado: "futuros", nombre: "Binance Futures", tieneTraders: true },
  { id: "binance", mercado: "spot", nombre: "Binance", tieneTraders: false },
  { id: "bybit", mercado: "futuros", nombre: "Bybit", tieneTraders: false },
  { id: "okx", mercado: "futuros", nombre: "OKX", tieneTraders: false },
  { id: "hyperliquid", mercado: "futuros", nombre: "Hyperliquid", tieneTraders: false },
  { id: "kraken", mercado: "spot", nombre: "Kraken", tieneTraders: false },
  { id: "coinbase", mercado: "spot", nombre: "Coinbase", tieneTraders: false },
];

/** Intervalos de cada plataforma (en minutos). */
const INTERVALOS: Record<string, string> = {
  "1m": "1m",
  "3m": "3m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "2h": "2h",
  "4h": "4h",
  "6h": "6h",
  "8h": "8h",
  "12h": "12h",
  "1d": "1d",
  "3d": "3d",
  "1w": "1w",
};

/** Milisegundos por intervalo. */
export const MS_POR_INTERVALO: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

function ms(intervalo: string): number {
  return MS_POR_INTERVALO[intervalo] ?? 3_600_000;
}

/** Resultado de una descarga: las velas y de que plataforma salieron. */
export type DescargaPlataforma = {
  velas: Vela[];
  plataforma: FuentePlataforma;
};

/** Normaliza un par al formato de cada plataforma. */
function simboloPara(plataforma: string, simbolo: string): string {
  const s = simbolo.toUpperCase();
  if (plataforma === "okx") return s.replace("USDT", "-USDT");
  if (plataforma === "kraken") return s.replace("USDT", "USD");
  if (plataforma === "coinbase") return s.replace("USDT", "-USD");
  return s;
}

async function getJson(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(20_000),
      headers: { accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/* ------------------------------ BINANCE ------------------------------ */

async function binance(
  marca: "spot" | "futuros",
  simbolo: string,
  intervalo: string,
  limite: number,
  hasta: number,
) {
  const host = marca === "futuros" ? "https://fapi.binance.com" : "https://api.binance.com";
  const ruta = marca === "futuros" ? "/fapi/v1/klines" : "/api/v3/klines";
  const desde = hasta - limite * ms(intervalo);
  const url =
    `${host}${ruta}?symbol=${encodeURIComponent(simbolo)}&interval=${INTERVALOS[intervalo]}` +
    `&limit=${Math.min(1000, limite)}&startTime=${desde}&endTime=${hasta}`;
  const cuerpo = await getJson(url);
  if (!Array.isArray(cuerpo)) return null;
  const velas: Vela[] = [];
  for (const fila of cuerpo) {
    if (!Array.isArray(fila)) continue;
    const time = Number(fila[0]);
    const open = Number(fila[1]);
    const high = Number(fila[2]);
    const low = Number(fila[3]);
    const close = Number(fila[4]);
    const volume = Number(fila[5]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return velas.length ? velas : null;
}

/* ------------------------------- BYBIT ------------------------------- */

async function bybit(simbolo: string, intervalo: string, limite: number, hasta: number) {
  const minutos = Math.max(1, Math.round(ms(intervalo) / 60_000));
  const intervaloBybit = [
    "1",
    "3",
    "5",
    "15",
    "30",
    "60",
    "120",
    "240",
    "360",
    "480",
    "720",
    "D",
  ].includes(String(minutos))
    ? String(minutos)
    : "60";
  const url =
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(simbolo)}` +
    `&interval=${intervaloBybit}&limit=${Math.min(1000, limite)}&end=${hasta}`;
  const cuerpo = (await getJson(url)) as { result?: { list?: unknown[][] } } | null;
  const lista = cuerpo?.result?.list;
  if (!Array.isArray(lista)) return null;
  const velas: Vela[] = [];
  for (const fila of lista) {
    if (!Array.isArray(fila)) continue;
    const time = Number(fila[0]);
    const open = Number(fila[1]);
    const high = Number(fila[2]);
    const low = Number(fila[3]);
    const close = Number(fila[4]);
    const volume = Number(fila[5]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  velas.sort((a, b) => a.time - b.time);
  return velas.length ? velas : null;
}

/* -------------------------------- OKX -------------------------------- */

async function okx(simbolo: string, intervalo: string, limite: number, hasta: number) {
  const barras: Record<string, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1H",
    "2h": "2H",
    "4h": "4H",
    "6h": "6H",
    "12h": "12H",
    "1d": "1D",
  };
  const barra = barras[intervalo] ?? "1H";
  const instId = simbolo.includes("-") ? simbolo : simbolo.replace("USDT", "-USDT");
  const url = `https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=${barra}&limit=${Math.min(300, limite)}&after=${hasta}`;
  const cuerpo = (await getJson(url)) as { data?: unknown[][] } | null;
  const lista = cuerpo?.data;
  if (!Array.isArray(lista)) return null;
  const velas: Vela[] = [];
  for (const fila of lista) {
    if (!Array.isArray(fila)) continue;
    const time = Number(fila[0]);
    const open = Number(fila[1]);
    const high = Number(fila[2]);
    const low = Number(fila[3]);
    const close = Number(fila[4]);
    const volume = Number(fila[5]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  velas.sort((a, b) => a.time - b.time);
  return velas.length ? velas : null;
}

/* ---------------------------- KRAKEN / COINBASE ---------------------------- */

async function kraken(simbolo: string, intervalo: string, limite: number, hasta: number) {
  const minutos = Math.max(1, Math.round(ms(intervalo) / 60_000));
  const intervaloKraken = [1, 5, 15, 30, 60, 240, 1440, 10080].includes(minutos) ? minutos : 60;
  const par = simbolo.includes("/")
    ? simbolo
    : simbolo.replace("USDT", "USD").replace("BTC", "XBT");
  const url = `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(par)}&interval=${intervaloKraken}`;
  const cuerpo = (await getJson(url)) as {
    error?: string[];
    result?: Record<string, unknown[][]>;
  } | null;
  if (!cuerpo || (cuerpo.error && cuerpo.error.length)) return null;
  const clave = Object.keys(cuerpo.result ?? {})[0];
  const serie = clave ? cuerpo.result?.[clave] : null;
  if (!Array.isArray(serie)) return null;
  const velas: Vela[] = [];
  for (const fila of serie) {
    if (!Array.isArray(fila)) continue;
    const time = Number(fila[0]) * 1000;
    const open = Number(fila[1]);
    const high = Number(fila[2]);
    const low = Number(fila[3]);
    const close = Number(fila[4]);
    const volume = Number(fila[6]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  velas.sort((a, b) => a.time - b.time);
  return velas.length ? velas.slice(-limite) : null;
}

async function coinbase(simbolo: string, intervalo: string, limite: number, hasta: number) {
  // OJO: Coinbase quiere la granularidad en SEGUNDOS (no en ms).
  const granularidad = Math.max(60, Math.round(ms(intervalo) / 1000));
  const producto = simbolo.includes("-")
    ? simbolo
    : simbolo.replace("USDT", "-USD").replace("BTC", "BTC");
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(producto)}/candles?granularity=${granularidad}&end=${new Date(hasta).toISOString()}`;
  const cuerpo = await getJson(url);
  if (!Array.isArray(cuerpo)) return null;
  const velas: Vela[] = [];
  for (const fila of cuerpo) {
    if (!Array.isArray(fila)) continue;
    const time = Number(fila[0]) * 1000;
    const low = Number(fila[1]);
    const high = Number(fila[2]);
    const open = Number(fila[3]);
    const close = Number(fila[4]);
    const volume = Number(fila[5]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  velas.sort((a, b) => a.time - b.time);
  return velas.length ? velas.slice(-limite) : null;
}

/* ---------------------------- HYPERLIQUID ---------------------------- */

async function hyperliquid(simbolo: string, intervalo: string, limite: number, hasta: number) {
  // Hyperliquid usa el nombre de la moneda sin la divisa ("BTC", no "BTCUSDT")
  // y sus intervalos son propios ("1h", "4h"...).
  const moneda = simbolo.replace(/USDT$|USD$/, "");
  const intervalos: Record<string, string> = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "2h": "2h",
    "4h": "4h",
    "8h": "8h",
    "12h": "12h",
    "1d": "1d",
    "3d": "3d",
    "1w": "1w",
  };
  const periodo = intervalos[intervalo] ?? "1h";
  const paso = ms(intervalo);
  const inicio = hasta - limite * paso;
  const cuerpo = await getJson("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin: moneda, interval: periodo, startTime: inicio, endTime: Date.now() },
    }),
  });
  if (!Array.isArray(cuerpo)) return null;
  const velas: Vela[] = [];
  for (const fila of cuerpo) {
    // Hyperliquid devuelve un OBJETO por vela: {t, T, s, i, o, c, h, l, v, n}.
    if (!fila || typeof fila !== "object") continue;
    const objeto = fila as Record<string, unknown>;
    const time = Number(objeto["t"]);
    const open = Number(objeto["o"]);
    const high = Number(objeto["h"]);
    const low = Number(objeto["l"]);
    const close = Number(objeto["c"]);
    const volume = Number(objeto["v"]);
    if (![time, open, high, low, close].every(Number.isFinite)) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  velas.sort((a, b) => a.time - b.time);
  return velas.length ? velas.slice(-limite) : null;
}

/* ----------------------------- DESCARGAS ----------------------------- */

/** Descarga velas de UNA plataforma concreta. */
export async function descargarDePlataforma(
  plataforma: FuentePlataforma,
  simbolo: string,
  intervalo: string,
  limite: number,
  hasta?: number,
): Promise<DescargaPlataforma | null> {
  // OJO: cada adaptador convierte el simbolo a su formato. No se convierte
  // antes (si no, se aplicaria dos veces: "BTC-USDT" -> "BTC--USDT").
  let velas: Vela[] | null = null;
  try {
    const fin = hasta ?? Date.now();
    if (plataforma.id === "binance") velas = await binance("spot", simbolo, intervalo, limite, fin);
    else if (plataforma.id === "binance-futuros")
      velas = await binance("futuros", simbolo, intervalo, limite, fin);
    else if (plataforma.id === "bybit") velas = await bybit(simbolo, intervalo, limite, fin);
    else if (plataforma.id === "okx") velas = await okx(simbolo, intervalo, limite, fin);
    else if (plataforma.id === "kraken") velas = await kraken(simbolo, intervalo, limite, fin);
    else if (plataforma.id === "coinbase") velas = await coinbase(simbolo, intervalo, limite, fin);
    else if (plataforma.id === "hyperliquid")
      velas = await hyperliquid(simbolo, intervalo, limite, fin);
  } catch {
    velas = null;
  }
  if (!velas || velas.length === 0) return null;
  velas.sort((a, b) => a.time - b.time);
  return { velas: velas.slice(-limite), plataforma };
}

/**
 * Descarga velas probando varias plataformas hasta que una responda.
 *
 * @param Mercado "futuros" (por defecto, para los datos de traders) o "spot".
 * @param excluir ids de plataformas ya probadas (para comparar entre varias).
 */
export async function descargarVelasMultiplataforma(
  simbolo: string,
  intervalo: string,
  limite: number,
  opciones: { mercado?: "spot" | "futuros"; excluir?: string[]; hasta?: number } = {},
): Promise<DescargaPlataforma | null> {
  const mercado = opciones.mercado ?? "futuros";
  const excluir = new Set(opciones.excluir ?? []);
  const candidatas = PLATAFORMAS.filter((p) => p.mercado === mercado && !excluir.has(p.id));
  for (const plataforma of candidatas) {
    const descarga = await descargarDePlataforma(
      plataforma,
      simbolo,
      intervalo,
      limite,
      opciones.hasta,
    );
    if (descarga) return descarga;
  }
  return null;
}

/**
 * Compara el MISMO par en varias plataformas a la vez: sirve para detectar
 * manipulacion (si los precios no cuadran, algo raro pasa) y para saber
 * cual platforma responde mejor.
 */
export async function compararPlataformas(
  simbolo: string,
  intervalo: string,
  limite: number,
): Promise<
  Array<{
    plataforma: string;
    mercado: string;
    velas: number;
    ultimoClose: number | null;
    diferenciaPct: number | null;
    error: string | null;
  }>
> {
  const resultados: Array<{
    plataforma: string;
    mercado: string;
    velas: number;
    ultimoClose: number | null;
    diferenciaPct: number | null;
    error: string | null;
  }> = [];
  const cierres: number[] = [];

  for (const plataforma of PLATAFORMAS) {
    try {
      const descarga = await descargarDePlataforma(plataforma, simbolo, intervalo, limite);
      if (!descarga) {
        resultados.push({
          plataforma: plataforma.nombre,
          mercado: plataforma.mercado,
          velas: 0,
          ultimoClose: null,
          diferenciaPct: null,
          error: "sin datos",
        });
        continue;
      }
      const ultimo = descarga.velas[descarga.velas.length - 1]?.close ?? null;
      if (ultimo !== null) cierres.push(ultimo);
      resultados.push({
        plataforma: plataforma.nombre,
        mercado: plataforma.mercado,
        velas: descarga.velas.length,
        ultimoClose: ultimo,
        diferenciaPct: null,
        error: null,
      });
    } catch (e) {
      resultados.push({
        plataforma: plataforma.nombre,
        mercado: plataforma.mercado,
        velas: 0,
        ultimoClose: null,
        diferenciaPct: null,
        error: e instanceof Error ? e.message : "fallo",
      });
    }
  }

  // Diferencia respecto a la mediana: si un mercado se sale mucho, se nota.
  if (cierres.length > 1) {
    const ordenados = [...cierres].sort((a, b) => a - b);
    const mediana = ordenados[Math.floor(ordenados.length / 2)]!;
    for (const r of resultados) {
      if (r.ultimoClose === null || mediana === 0) continue;
      r.diferenciaPct = Number((((r.ultimoClose - mediana) / mediana) * 100).toFixed(3));
    }
  }

  return resultados;
}
