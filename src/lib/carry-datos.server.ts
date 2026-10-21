/**
 * DATOS REALES DEL CARRY: las cuotas de financiacion de Binance Futures (la
 * API publica de produccion) y los precios de spot y perpetuo en los extremos.
 */
import { calcularCarry, pnlCarry, type Cuota } from "./carry.server";

const HOST_F = "https://fapi.binance.com";
const HOST_S = "https://api.binance.com";

export type InformeCarry = {
  simbolo: string;
  /** Cuotas por año natural. */
  porAnyo: Array<{ anio: number; suma: number; cuotas: number; anualizado: number }>;
  /** Cuotas cobradas en total (fraccion). */
  total: number;
  /** Total anualizado (compuesto, %). */
  anualizado: number;
  /** El P&L del carry completo (fraccion): spot + perp corto + cuotas. */
  pnl: number;
  /** El P&L anualizado del carry completo (%). */
  pnlAnualizado: number;
  /** Dias cubiertos. */
  dias: number;
  /** El "basis" (perp - spot) al principio y al final (%). */
  basisInicialPct: number;
  basisFinalPct: number;
  /** El spot solo, para comparar. */
  pnlSoloSpot: number;
  /** true si las cuotas son positivas en todos los años con datos. */
  todosLosAnosPositivos: boolean;
  /** De donde vienen los datos. */
  fuente: string;
  /** La fecha de la última cuota (ISO). */
  hasta: string;
};

/** Descarga TODAS las cuotas disponibles (paginado hacia atras). */
export async function descargarCuotas(simbolo: string, maxPaginas = 12): Promise<Cuota[]> {
  const salida: Cuota[] = [];
  let fin: number | undefined;
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const url =
      `${HOST_F}/fapi/v1/fundingRate?symbol=${simbolo}&limit=1000` + (fin ? `&endTime=${fin}` : "");
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) break;
    const filas = (await res.json()) as Array<{ fundingTime: number; fundingRate: string }>;
    if (!filas.length) break;
    const lote = filas
      .map((f) => ({ t: Number(f.fundingTime), r: Number(f.fundingRate) }))
      .filter((f) => Number.isFinite(f.t) && Number.isFinite(f.r));
    salida.push(...lote);
    const minimo = Math.min(...lote.map((f) => f.t));
    if (fin !== undefined && minimo >= fin) break;
    fin = minimo - 1;
  }
  const unicos = new Map<number, number>();
  for (const f of salida) unicos.set(f.t, f.r);
  return [...unicos.entries()].map(([t, r]) => ({ t, r })).sort((a, b) => a.t - b.t);
}

/** El cierre diario de un par en un host dado (spot o futuros). */
async function cierreDiario(
  host: string,
  ruta: string,
  simbolo: string,
  dia: string,
): Promise<number | null> {
  const res = await fetch(
    `${host}${ruta}?symbol=${simbolo}&interval=1d&startTime=${Date.parse(dia)}&limit=2`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) return null;
  const filas = (await res.json()) as unknown[][];
  const fila = filas[filas.length - 1];
  return fila ? Number(fila[4]) : null;
}

/** El informe completo del carry de un par (con datos reales). */
export async function informeCarry(simbolo = "BTCUSDT"): Promise<InformeCarry | null> {
  const cuotas = await descargarCuotas(simbolo);
  if (cuotas.length < 30) return null;
  const primero = cuotas[0]!;
  const ultimo = cuotas[cuotas.length - 1]!;
  const dia0 = new Date(primero.t).toISOString().slice(0, 10);
  const dia1 = new Date(ultimo.t).toISOString().slice(0, 10);
  const [spot0, spot1, perp0, perp1] = await Promise.all([
    cierreDiario(HOST_S, "/api/v3/klines", simbolo, dia0),
    cierreDiario(HOST_S, "/api/v3/klines", simbolo, dia1),
    cierreDiario(HOST_F, "/fapi/v1/klines", simbolo, dia0),
    cierreDiario(HOST_F, "/fapi/v1/klines", simbolo, dia1),
  ]);
  if (!spot0 || !spot1 || !perp0 || !perp1) return null;

  const calculo = calcularCarry({
    cuotas,
    spotInicial: spot0,
    spotFinal: spot1,
    perpInicial: perp0,
    perpFinal: perp1,
  });
  const pnl = pnlCarry({
    cuotas,
    spotInicial: spot0,
    spotFinal: spot1,
    perpInicial: perp0,
    perpFinal: perp1,
  });
  const pnlAnualizado = (Math.pow(1 + pnl, 365 / calculo.dias) - 1) * 100;

  return {
    simbolo,
    porAnyo: calculo.porAnyo,
    total: calculo.total,
    anualizado: calculo.anualizado,
    pnl,
    pnlAnualizado,
    dias: calculo.dias,
    basisInicialPct: calculo.basisInicialPct,
    basisFinalPct: calculo.basisFinalPct,
    pnlSoloSpot: (spot1 - spot0) / spot0,
    todosLosAnosPositivos: calculo.porAnyo.every((a) => a.suma > 0),
    fuente: "Binance Futures (cuotas de financiacion) + Binance spot y futuros (precios)",
    hasta: new Date(ultimo.t).toISOString().slice(0, 10),
  };
}
