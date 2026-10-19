/**
 * Velas historicas de Binance (server-only, solo endpoint publico).
 *
 * No necesita credenciales, no toca la base de datos y no envia ordenes.
 * Si api.binance.com esta bloqueado por region (el mismo problema que ya
 * sufria el motor), prueba data-api.binance.vision, que es el host publico
 * de datos recommended para regiones restringidas.
 *
 * Lo usan el backtest (historico) y el motor en vivo (la serie que alimentan
 * los indicadores).
 */

import type { Vela } from "./backtest/types";

/** Hosts publicos de datos, en orden de preferencia. */
const HOSTS_DATOS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api.binance.us",
];

/** Duracion de cada intervalo en milisegundos. */
export const INTERVALOS_MS: Record<string, number> = {
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

export type OpcionesVelas = {
  simbolo: string;
  /** Intervalo ("1m", "1h", "1d"...). */
  intervalo?: string;
  /** Cuantas velas se quieren (maximo 1000 por peticion; se pagina). */
  limite?: number;
  /** Milisegundos epoch: hasta donde llegar (por defecto, ahora). */
  hasta?: number;
};

/** Convierte la respuesta de klines de Binance en velas cerradas. */
export function parsearKlines(bruto: unknown): Vela[] {
  if (!Array.isArray(bruto)) return [];
  const velas: Vela[] = [];
  for (const fila of bruto) {
    if (!Array.isArray(fila)) continue;
    const time = Number(fila[0]);
    const open = Number(fila[1]);
    const high = Number(fila[2]);
    const low = Number(fila[3]);
    const close = Number(fila[4]);
    const volume = Number(fila[5]);
    if (![time, open, high, low, close].every((v) => Number.isFinite(v))) continue;
    velas.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return velas;
}

/** Descarga velas historicas (pagina hasta el limite pedido). */
export async function velasDeBinance(opciones: OpcionesVelas): Promise<Vela[]> {
  const simbolo = opciones.simbolo.toUpperCase();
  const intervalo = opciones.intervalo ?? "1h";
  const limite = Math.min(Math.max(opciones.limite ?? 500, 1), 10_000);
  const paso = INTERVALOS_MS[intervalo] ?? 3_600_000;
  const hasta = opciones.hasta ?? Date.now();

  const velas: Vela[] = [];
  let cursor = hasta - limite * paso;

  for (let pagina = 0; pagina < 20 && velas.length < limite; pagina++) {
    let cuerpo: unknown = null;
    let ok = false;
    for (const host of HOSTS_DATOS) {
      const urlHost = new URL(`${host}/api/v3/klines`);
      urlHost.searchParams.set("symbol", simbolo);
      urlHost.searchParams.set("interval", intervalo);
      urlHost.searchParams.set("limit", String(Math.min(1000, limite - velas.length)));
      urlHost.searchParams.set("startTime", String(Math.max(0, cursor)));
      urlHost.searchParams.set("endTime", String(hasta));
      try {
        const res = await fetch(urlHost);
        if (!res.ok) continue;
        cuerpo = await res.json();
        ok = true;
        break;
      } catch {
        continue;
      }
    }
    if (!ok) {
      throw new Error(
        `No se pudieron descargar velas de ${simbolo} (${intervalo}). Si el servidor esta bloqueado por region, ejecuta el backtest desde tu PC.`,
      );
    }

    const paginaVelas = parsearKlines(cuerpo);
    if (paginaVelas.length === 0) break;
    const antes = velas.length;
    for (const vela of paginaVelas) {
      if (vela.time < cursor) continue;
      if (velas.length >= limite) continue;
      velas.push(vela);
    }
    if (velas.length === antes) break;
    const ultima = paginaVelas[paginaVelas.length - 1]!;
    if (ultima.time + paso <= cursor) break;
    cursor = ultima.time + paso;
  }

  velas.sort((a, b) => a.time - b.time);
  return velas.slice(-limite);
}
