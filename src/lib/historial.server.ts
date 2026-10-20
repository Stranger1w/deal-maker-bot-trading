/**
 * HISTORICOS REALES (precios de mercado y evolucion de los bots).
 *
 * QUE HABIA
 * `market_prices` y `bot_performance_history` venian SEMBRADOS con datos de
 * ejemplo: BTC a 70.954 cuando el mercado estaba a 82.700, y una curva de
 * P&L inventada con 0 de ganancia. Eso no era solo decoracion: los precios
 * de ejemplo se usaban para calcular el benchmark de comprar-y-mantener del
 * gate de promocion a Real, es decir, para decidir si un bot se merecia
 * dinero real con numeros falsos.
 *
 * QUE HAY AHORA
 *  - `actualizarPreciosMercado`: descarga los cierres DIARIOS REALES de
 *    Binance y los guarda con la fuente de verdad ("Binance Klines 1d") y
 *    `is_demo = false`.
 *  - `reconstruirHistorialBots`: rehace la curva de cada bot a partir de sus
 *    EJECUCIONES REALES (las que hay en bot_executions). Si un bot no tiene
 *    operaciones, no tiene curva: no se dibuja una linea imaginaria.
 */

import type { Vela } from "./backtest/types";
import { velasDeBinance } from "./velas.server";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Fuente que se graba en market_prices.source (la verdad de donde sale). */
export const FUENTE_PRECIOS = "Binance Klines 1d";

export type ResultadoPrecios = {
  simbolos: number;
  filas: number;
  errores: string[];
};

/**
 * Actualiza los precios historicos reales de los pares indicados.
 *
 * @param db cliente con service_role
 * @param simbolos pares (BTCUSDT, ETHUSDT...)
 * @param dias cuantas velas diarias se descargan
 */
export async function actualizarPreciosMercado(
  db: Db,
  simbolos: readonly string[],
  dias = 400,
): Promise<ResultadoPrecios> {
  const errores: string[] = [];
  let filas = 0;
  let usados = 0;

  for (const simbolo of simbolos.slice(0, 10)) {
    let velas: Vela[] = [];
    try {
      velas = await velasDeBinance({ simbolo, intervalo: "1d", limite: dias });
    } catch (e) {
      errores.push(`${simbolo}: ${e instanceof Error ? e.message : "fallo al descargar"}`);
      continue;
    }
    if (!velas.length) {
      errores.push(`${simbolo}: sin velas`);
      continue;
    }
    usados++;

    // Uno por dia (el cierre de cada dia).
    const porDia = new Map<string, number>();
    for (const vela of velas) {
      porDia.set(new Date(vela.time).toISOString().slice(0, 10), vela.close);
    }

    const filasInsertar = [...porDia.entries()].map(([fecha, precio]) => ({
      symbol: simbolo.toUpperCase(),
      recorded_on: fecha,
      price: precio,
      source: FUENTE_PRECIOS,
      is_demo: false,
    }));

    // Borra SOLO los datos de ejemplo de este par y guarda los reales.
    await db.from("market_prices").delete().eq("symbol", simbolo.toUpperCase()).eq("is_demo", true);
    // Insercion por lotes (una por fila tardaba 65 s con 400 velas).
    for (let i = 0; i < filasInsertar.length; i += 200) {
      const lote = filasInsertar.slice(i, i + 200);
      const { error: errorLote } = await db.from("market_prices").upsert(lote, {
        onConflict: "symbol,recorded_on",
      });
      if (!errorLote) {
        filas += lote.length;
        continue;
      }
      // Si no hay indice unico (symbol, recorded_on), se borra y se inserta.
      for (const fila of lote) {
        await db
          .from("market_prices")
          .delete()
          .eq("symbol", fila.symbol)
          .eq("recorded_on", fila.recorded_on);
        const { error: errorFila } = await db.from("market_prices").insert(fila);
        if (errorFila) {
          errores.push(`${simbolo} ${fila.recorded_on}: ${errorFila.message}`);
          continue;
        }
        filas++;
      }
    }
  }

  return { simbolos: usados, filas, errores };
}

export type ResultadoHistorialBots = {
  bots: number;
  puntos: number;
  /** Bots que no tienen curva porque no han operado. */
  sinOperaciones: string[];
  errores: string[];
};

/**
 * Reconstruye la curva de cada bot con sus EJECUCIONES REALES.
 *
 * Cada punto es un dia con operaciones: P&L acumulado del dia, retorno
 * sobre el capital y capital final. Un bot sin operaciones no tiene curva
 * (antes se le dibujaba una linea plana de ejemplo).
 */
export async function reconstruirHistorialBots(
  db: Db,
  userId: string | null,
): Promise<ResultadoHistorialBots> {
  const errores: string[] = [];

  // Las ejecuciones NO tienen columna user_id en la base (la migracion de
  // multiusuario por usuario no esta aplicada ahi): el aislamiento se hace
  // por el bot, que si tiene dueño.
  let consultaBots = db.from("bots").select("id, name, capital, user_id");
  if (userId) consultaBots = consultaBots.eq("user_id", userId);
  const { data: bots } = await consultaBots;
  const capitalPorBot = new Map<string, number>();
  const idsPorDueno = new Set<string>();
  for (const b of (bots ?? []) as Array<{ id: string; capital: number }>) {
    capitalPorBot.set(b.id, Number(b.capital) || 0);
    idsPorDueno.add(b.id);
  }

  const { data: ejecuciones, error } = await db
    .from("bot_executions")
    .select("bot_id, bot_name, pnl, created_at, status");
  if (error) {
    return { bots: 0, puntos: 0, sinOperaciones: [], errores: [error.message] };
  }

  const ops = (
    (ejecuciones ?? []) as Array<{
      bot_id: string;
      bot_name: string;
      pnl: number | null;
      created_at: string;
      status: string;
    }>
  ).filter((op) => idsPorDueno.has(op.bot_id));

  // Agrupar por bot y dia.
  const porBot = new Map<string, Map<string, { pnl: number; nombre: string }>>();
  for (const op of ops) {
    const dia = op.created_at.slice(0, 10);
    const mapa = porBot.get(op.bot_id) ?? new Map();
    const previo = mapa.get(dia) ?? { pnl: 0, nombre: op.bot_name };
    previo.pnl += Number(op.pnl ?? 0);
    mapa.set(dia, previo);
    porBot.set(op.bot_id, mapa);
  }

  // Se borra el historico de ejemplo (is_demo) y se reconstruye.
  let borradas = 0;
  const borrado = await db.from("bot_performance_history").delete().eq("is_demo", true);
  if (borrado.error) errores.push(borrado.error.message);
  else borradas = 1;

  let puntos = 0;
  const sinOperaciones: string[] = [];
  for (const [botId, porDia] of porBot) {
    const capitalInicial = capitalPorBot.get(botId) ?? 0;
    let acumulado = 0;
    const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [dia, info] of dias) {
      acumulado += info.pnl;
      const capital = capitalInicial + acumulado;
      const { error: errorInsert } = await db.from("bot_performance_history").insert({
        bot_id: botId,
        bot_name: info.nombre,
        recorded_on: dia,
        pnl: Number(acumulado.toFixed(6)),
        return_pct:
          capitalInicial > 0 ? Number(((acumulado / capitalInicial) * 100).toFixed(4)) : 0,
        capital: Number(capital.toFixed(6)),
        is_demo: false,
      });
      if (errorInsert) {
        errores.push(`${info.nombre} ${dia}: ${errorInsert.message}`);
        continue;
      }
      puntos++;
    }
  }

  return { bots: porBot.size, puntos, sinOperaciones, errores };
}
