/**
 * CACHE LOCAL DE DATOS DE MERCADO.
 *
 * POR QUE
 * Medir el sandbox sonaba a "volver a descargar 700 velas y 1000 lecturas de
 * traders cada vez". Con la cache:
 *  - las velas ya bajadas se leen de la base (market_candles),
 *  - solo se descarga lo que falta,
 *  - y se guarda de que plataforma salio cada vela.
 *
 * Si la tabla no existe (migracion sin aplicar), todo sigue funcionando:
 * se descarga de las plataformas y se usa sin cachear (con un aviso).
 */

import type { Vela } from "./backtest/types";
import {
  descargarVelasMultiplataforma,
  type DescargaPlataforma,
  type FuentePlataforma,
} from "./plataformas.server";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type ResultadoCache = {
  velas: Vela[];
  /** De donde salieron los datos (cache o plataforma). */
  origen: "cache" | "descarga" | "cache+descarga";
  /** Plataformas implicadas. */
  plataformas: string[];
  /** Cuantas velas havia ya en la cache. */
  desdeCache: number;
  /** Cuantas se han descargado ahora. */
  descargadas: number;
  /** Aviso (por ejemplo, que la cache no esta disponible). */
  aviso: string | null;
};

/** La cache existe? (si no, se trabaja sin ella). */
async function cacheDisponible(db: Db): Promise<boolean> {
  const { error } = await db.from("market_candles").select("id").limit(1);
  return !error;
}

/** Lee de la cache las velas de un simbolo e intervalo. */
async function leerCache(
  db: Db,
  simbolo: string,
  intervalo: string,
  limite: number,
): Promise<Vela[]> {
  const { data, error } = await db
    .from("market_candles")
    .select("time,open,high,low,close,volume,source")
    .eq("symbol", simbolo.toUpperCase())
    .eq("interval", intervalo)
    .order("time", { ascending: false })
    .limit(limite);
  if (error || !data) return [];
  const velas = (
    data as Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>
  ).map((v) => ({
    time: Number(v.time),
    open: Number(v.open),
    high: Number(v.high),
    low: Number(v.low),
    close: Number(v.close),
    volume: Number(v.volume) || 0,
  }));
  velas.sort((a, b) => a.time - b.time);
  return velas;
}

/** Guarda velas en la cache (ignora los errores: es una cache, no un dato). */
async function guardarCache(
  db: Db,
  simbolo: string,
  intervalo: string,
  velas: readonly Vela[],
  plataforma: FuentePlataforma,
  mercado: "spot" | "futuros",
): Promise<void> {
  if (!velas.length) return;
  const filas = velas.map((v) => ({
    symbol: simbolo.toUpperCase(),
    interval: intervalo,
    time: v.time,
    open: v.open,
    high: v.high,
    low: v.low,
    close: v.close,
    volume: v.volume,
    source: plataforma.nombre,
    market: mercado,
    is_demo: false,
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const { error } = await db
      .from("market_candles")
      .upsert(lote, { onConflict: "symbol,interval,time" });
    if (error) {
      // Sin indice unico: se borra lo que hay de esas velas y se inserta.
      for (const fila of lote) {
        await db
          .from("market_candles")
          .delete()
          .eq("symbol", fila.symbol)
          .eq("interval", fila.interval)
          .eq("time", fila.time);
        await db.from("market_candles").insert(fila);
      }
    }
  }
}

/**
 * Velas de un par, usando la cache y descargando solo lo que falte.
 *
 * @param db cliente con service_role
 * @param simbolo par
 * @param intervalo "1h", "1d"...
 * @param limite cuantas velas se quieren
 * @param mercado "futuros" (para los datos de traders) o "spot"
 * @param refrescar ignora la cache y vuelve a descargar (boton "actualizar")
 */
export async function velasConCache(
  db: Db,
  simbolo: string,
  intervalo: string,
  limite: number,
  opciones: {
    mercado?: "spot" | "futuros";
    refrescar?: boolean;
    /** Plataformas ya probadas (para comparar entre varias). */
    excluir?: string[];
  } = {},
): Promise<ResultadoCache> {
  const mercado = opciones.mercado ?? "futuros";
  const conCache = !opciones.refrescar && (await cacheDisponible(db));
  const cacheadas = conCache ? await leerCache(db, simbolo, intervalo, limite) : [];

  const paso = (() => {
    const ms = intervalo === "1d" ? 86_400_000 : intervalo === "4h" ? 14_400_000 : 3_600_000;
    return ms;
  })();

  const ahora = Date.now();
  const ultimaEnCache = cacheadas.length ? cacheadas[cacheadas.length - 1]!.time : 0;
  // Quantas velas nuevas hacen falta (como mucho las que pidas).
  const faltan = Math.max(0, Math.min(limite, Math.ceil((ahora - ultimaEnCache) / paso)));

  let descargadas: Vela[] = [];
  let plataformas: string[] = [];
  if (faltan > 0) {
    const descarga: DescargaPlataforma | null = await descargarVelasMultiplataforma(
      simbolo,
      intervalo,
      Math.max(faltan, Math.min(limite, 200)),
      { mercado, ...(opciones.excluir ? { excluir: opciones.excluir } : {}) },
    );
    if (descarga) {
      descargadas = descarga.velas;
      plataformas = [descarga.plataforma.nombre];
      if (conCache) {
        await guardarCache(db, simbolo, intervalo, descargadas, descarga.plataforma, mercado);
      }
    }
  }

  // Se unen (la cache gana si hay velas mas nuevas) y se ordenan.
  const todas = [...cacheadas, ...descargadas].sort((a, b) => a.time - b.time);
  const unicas: Vela[] = [];
  for (const v of todas) {
    if (unicas.length && unicas[unicas.length - 1]!.time === v.time) continue;
    unicas.push(v);
  }
  const velas = unicas.slice(-limite);

  return {
    velas,
    origen:
      cacheadas.length && descargadas.length
        ? "cache+descarga"
        : cacheadas.length
          ? "cache"
          : "descarga",
    plataformas,
    desdeCache: cacheadas.length,
    descargadas: descargadas.length,
    aviso: conCache
      ? null
      : "La cache local no esta disponible (falta la migracion 20261027000000_cache_mercado.sql): se descarga de las plataformas cada vez.",
  };
}

/** Guarda una serie de traders en la cache. */
export async function guardarTradersCache(
  db: Db,
  simbolo: string,
  metric: string,
  periodo: string,
  puntos: ReadonlyArray<{ time: number; valor: number }>,
  fuente: string,
): Promise<void> {
  if (!puntos.length) return;
  const filas = puntos.map((p) => ({
    symbol: simbolo.toUpperCase(),
    metric,
    period: periodo,
    time: p.time,
    value: p.valor,
    source: fuente,
    is_demo: false,
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const { error } = await db
      .from("trader_metrics")
      .upsert(lote, { onConflict: "symbol,metric,period,time" });
    if (error) return; // Sin cache: se sigue funcionando sin ella.
  }
}

/** Lee una serie de traders de la cache. */
export async function leerTradersCache(
  db: Db,
  simbolo: string,
  metric: string,
  periodo: string,
  limite: number,
): Promise<Array<{ time: number; valor: number }>> {
  const { data, error } = await db
    .from("trader_metrics")
    .select("time,value")
    .eq("symbol", simbolo.toUpperCase())
    .eq("metric", metric)
    .eq("period", periodo)
    .order("time", { ascending: true })
    .limit(limite);
  if (error || !data) return [];
  return (data as Array<{ time: number; value: number }>).map((p) => ({
    time: Number(p.time),
    valor: Number(p.value),
  }));
}

/** Que hay en la cache ahora mismo (para la pantalla de "datos"). */
export async function estadoCache(
  db: Db,
): Promise<{ disponible: boolean; velas: number; traders: number; simbolos: string[] }> {
  const disponible = await cacheDisponible(db);
  if (!disponible) {
    return { disponible: false, velas: 0, traders: 0, simbolos: [] };
  }
  const { data: velas } = await db.from("market_candles").select("symbol,time").limit(5000);
  const { data: traders } = await db.from("trader_metrics").select("symbol,time").limit(5000);
  const simbolos = [
    ...new Set([
      ...((velas ?? []) as Array<{ symbol: string }>).map((v) => v.symbol),
      ...((traders ?? []) as Array<{ symbol: string }>).map((t) => t.symbol),
    ]),
  ];
  return {
    disponible: true,
    velas: (velas ?? []).length,
    traders: (traders ?? []).length,
    simbolos,
  };
}
