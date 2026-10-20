/**
 * La senal del motor: la MISMA que usa el backtest.
 *
 * Por que este modulo existe
 * `senalDe` (src/lib/indicators) era la funcion que decide compra y venta, y
 * solo se usaba en los tests: el motor en vivo miraba cualquier otra cosa
 * (en demo, un numero aleatorio; en real, un tamano fijo). Sin esta pieza, el
 * backtest mediria una cosa y el motor otra.
 *
 * Aqui se cierra el circulo: el motor y el backtest llaman a `senalDe` con la
 * misma configuracion (engine_config.indicator_ids / indicator_params) y con
 * la misma serie de velas CERRADAS.
 *
 * Cache corta (60 s) de las velas por par: en un tick con muchos bots, cada
 * bot pediria las mismas velas.
 */

import { cerradas } from "./indicators/helpers";
import { senalDe } from "./indicators";
import type { PriceSeries, SignalDirection } from "./indicators/types";
import { detectarRegimen, type Regimen } from "./regimen";
import { atrPct } from "./riesgo-tamano";
import { velasDeBinance } from "./velas.server";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Configuracion de senales del motor (la de la plataforma). */
export type ConfigSenales = {
  /** Ids de indicadores (src/lib/indicators). */
  ids: string[];
  /** Parametros por indicador. */
  params: Record<string, Record<string, number>>;
  /** Horizonte en minutos: 1, 5 o 15. */
  horizonMinutos: number;
  /** Intervalo de velas equivalente ("1m", "5m", "15m"). */
  intervalo: string;
};

/** Minutos del horizonte -> intervalo de velas. */
export function intervaloDesdeMinutos(minutos: number): string {
  if (minutos <= 1) return "1m";
  if (minutos <= 5) return "5m";
  return "15m";
}

/**
 * Configuracion de senales de la plataforma (engine_config).
 * Devuelve null si no hay fila o no hay ningun indicador elegido: sin
 * indicadores no hay senal y el motor no abre posiciones.
 *
 * `adminId` es el dueno de la fila de configuracion de la plataforma: se
 * filtra por el, nunca con .limit(1) a pelo (devolveria la de otro usuario).
 */
export async function leerConfigSenales(
  db: Db,
  adminId: string | null,
): Promise<ConfigSenales | null> {
  try {
    if (!adminId) return null;
    const { data, error } = await db
      .from("engine_config")
      .select("indicator_ids, indicator_params, horizon_minutes")
      .eq("user_id", adminId)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    const fila = data as {
      indicator_ids?: string[] | null;
      indicator_params?: unknown;
      horizon_minutes?: number | null;
    } | null;
    const ids = (fila?.indicator_ids ?? []).filter((id) => typeof id === "string");
    if (ids.length === 0) return null;
    const params =
      fila?.indicator_params && typeof fila.indicator_params === "object"
        ? (fila.indicator_params as Record<string, Record<string, number>>)
        : {};
    const horizonMinutos = Number(fila?.horizon_minutes ?? 15);
    return {
      ids,
      params,
      horizonMinutos,
      intervalo: intervaloDesdeMinutos(horizonMinutos),
    };
  } catch {
    return null;
  }
}

/** Cache corta de velas por par e intervalo. */
const cacheVelas = new Map<
  string,
  { at: number; velas: Awaited<ReturnType<typeof velasDeBinance>> }
>();
const TTL_MS = 60_000;

/**
 * Velas CERRADAS del par (la ultima, la que esta en curso, se descarta).
 *
 * @param conTraders true si el bot usa indicadores de copy trading: entonces
 *   las velas son de FUTUROS (el mismo mercado del que salen el
 *   posicionamiento y el flujo) y se anexan esas series a la serie.
 */
export async function velasCerradas(
  simbolo: string,
  intervalo: string,
  limite = 300,
  conTraders = false,
): Promise<PriceSeries> {
  const clave = `${simbolo.toUpperCase()}:${intervalo}:${limite}:${conTraders ? "fut" : "spot"}`;
  const hit = cacheVelas.get(clave);
  const velas =
    hit && Date.now() - hit.at < TTL_MS
      ? hit.velas
      : await velasDeBinance({
          simbolo,
          intervalo,
          limite,
          mercado: conTraders ? "futuros" : "spot",
        });
  if (!hit || Date.now() - hit.at >= TTL_MS) cacheVelas.set(clave, { at: Date.now(), velas });

  const serie: PriceSeries = {
    open: velas.map((v) => v.open),
    closes: velas.map((v) => v.close),
    highs: velas.map((v) => v.high),
    lows: velas.map((v) => v.low),
    volumes: velas.map((v) => v.volume),
    times: velas.map((v) => new Date(v.time).toISOString()),
  };

  if (conTraders) {
    try {
      const { obtenerSeriesTraders, alinearTradersConVelas } = await import("./traders.server");
      // La API de traders tiene estos periodos; el mas cercano al del bot.
      const periodo =
        intervalo === "1m"
          ? "5m"
          : intervalo === "5m" || intervalo === "15m" || intervalo === "30m"
            ? intervalo
            : "1h";
      const datos = await obtenerSeriesTraders(simbolo, periodo);
      serie.aux = alinearTradersConVelas(velas, datos);
    } catch {
      // Sin datos de traders: los indicadores de copy trading no dan señal
      // (nunca se rellenan con datos inventados).
      serie.aux = {};
    }
  }

  return serie;
}

/**
 * Senal del bot: "buy", "sell" o null (sin senal o sin datos).
 *
 * null NUNCA significa "vende": en spot, una senal de venta sin posicion
 * abierta se ignora. Quien consume esta senal decide que hacer con ella.
 */
export async function senalDelBot(
  db: Db,
  bot: { pair: string },
  cfg: ConfigSenales,
): Promise<SignalDirection> {
  const analisis = await analizarBot(db, bot, cfg);
  return analisis.senal;
}

/** Analisis completo del bot: senal, volatilidad y regimen de mercado. */
export type AnalisisBot = {
  senal: SignalDirection;
  /** Volatilidad relativa del par (ATR en %), null si no hay datos. */
  atrPct: number | null;
  /** Regimen detectado (para el filtro de regimen). */
  regimen: Regimen;
  /** Explicacion legible del regimen. */
  detalle: string;
  /** true si no se pudieron obtener datos (sin red, par inexistente...). */
  sinDatos: boolean;
};

/**
 * Analiza el par del bot: senal de los indicadores, volatilidad (ATR) y
 * regimen de mercado. Todo con la MISMA serie de velas, cacheada 60 s.
 */
export async function analizarBot(
  db: Db,
  bot: { pair: string },
  cfg: ConfigSenales,
): Promise<AnalisisBot> {
  const vacio: AnalisisBot = {
    senal: null,
    atrPct: null,
    regimen: "lateral",
    detalle: "Sin datos del par.",
    sinDatos: true,
  };
  try {
    // Si el bot usa indicadores de copy trading, hace falta el dato real de
    // traders (posicionamiento y flujo) y el precio de futuros.
    const conTraders = cfg.ids.some((id) => id === "top_traders" || id === "taker_flow");
    const serie = await velasCerradas(bot.pair, cfg.intervalo, 300, conTraders);
    const cerradasSerie = cerradas(serie);
    if (cerradasSerie.closes.length < 5) return vacio;

    const velas = cerradasSerie.closes.map((cierre, i) => ({
      close: cierre,
      high: cerradasSerie.highs[i] ?? cierre,
      low: cerradasSerie.lows[i] ?? cierre,
    }));
    const atrRelativo = atrPct(velas);
    const deteccion = detectarRegimen(velas);

    return {
      senal: senalDe(cfg.ids, cerradasSerie, cfg.params),
      atrPct: atrRelativo,
      regimen: deteccion.regimen,
      detalle: deteccion.detalle,
      sinDatos: false,
    };
  } catch {
    // Sin datos (red, region, par inexistente): no hay senal. No se inventa.
    return vacio;
  }
}
