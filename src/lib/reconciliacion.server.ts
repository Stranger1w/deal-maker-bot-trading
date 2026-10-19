/**
 * Reconciliacion contra el exchange (server-only).
 *
 * Compara lo que el motor cree que tiene con lo que hay de verdad en
 * Binance. Si no cuadra, el motor NO debe operar: abrir una posicion
 * encima de otra que ya existe es la forma clasica de duplicar la
 * exposicion con dinero real.
 *
 * Usa las credenciales DEL DUEÑO del bot y solo en modo Real: en demo no
 * hay nada que reconciliar (el paper trading no toca el exchange).
 */

import { compararPosicion, type Discrepancia, type PosicionLocal } from "./reconciliacion";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type BotReconciliable = {
  id: string;
  name: string;
  pair: string;
  mode: string;
  user_id?: string | null | undefined;
};

export type ResultadoReconciliacion = {
  /** Discrepancias encontradas (vacio = todo cuadra). */
  discrepancias: Discrepancia[];
  /** Posicion segun el motor (null si no cree que tenga ninguna). */
  local: PosicionLocal | null;
  /** Cantidad real en el exchange (null si no se pudo consultar). */
  exchange: number | null;
  /** true si se pudo comprobar de verdad. */
  consultado: boolean;
};

/** Posicion local segun la ultima ejecucion del bot. */
export async function leerPosicionLocal(
  db: Db,
  botId: string,
  pair: string,
): Promise<PosicionLocal | null> {
  const { data } = await db
    .from("bot_executions")
    .select("side,quantity,price")
    .eq("bot_id", botId)
    .eq("symbol", pair)
    .in("status", ["filled", "simulated", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data as { side?: string; quantity?: number; price?: number } | null;
  if (last?.side !== "buy") return null;
  const cantidad = Number(last.quantity ?? 0);
  const precio = Number(last.price ?? 0);
  if (!(cantidad > 0) || !(precio > 0)) return null;
  return { cantidad, precio };
}

/**
 * Reconcilia un bot contra el exchange.
 *
 * Devuelve tambien la cantidad real: si no cuadra, el motor debe vender lo
 * que HAY en Binance (no lo que cree tener), y si no hay nada, cerrar la
 * posicion local sin mandar ninguna orden.
 */
export async function reconciliarBot(
  db: Db,
  bot: BotReconciliable,
  env: "testnet" | "production",
): Promise<ResultadoReconciliacion> {
  const local = await leerPosicionLocal(db, bot.id, bot.pair);

  // Solo tiene sentido en Real: en demo no hay nada en el exchange.
  if (bot.mode !== "real") {
    return { discrepancias: [], local, exchange: null, consultado: false };
  }
  if (!bot.user_id) {
    return { discrepancias: [], local, exchange: null, consultado: false };
  }

  const { loadBinanceSecret } = await import("./credenciales.server");
  const creds = await loadBinanceSecret(db, bot.user_id);
  if (!creds) {
    return { discrepancias: [], local, exchange: null, consultado: false };
  }

  const { baseAssetDe, consultarSaldoBinance } = await import("./binance-trading.server");
  const activo = baseAssetDe(bot.pair);
  const exchange = await consultarSaldoBinance(env, creds.apiKey, creds.apiSecret, activo);
  const discrepancias = compararPosicion(local, exchange);

  return { discrepancias, local, exchange, consultado: exchange !== null };
}
