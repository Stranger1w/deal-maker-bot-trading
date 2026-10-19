/**
 * Informe de metricas honestas (server-only).
 *
 * Se apoya en las operaciones REALES que ha hecho el motor (bot_executions),
 * no en numero inventados: cada operacion cerrada lleva su P&L, sus costes
 * y (desde la migracion 20261022000000) que indicadores dispararon la
 * señal y por que.
 *
 * Que incluye:
 *  - Totales: P&L neto, operaciones, win rate, profit factor, drawdown.
 *  - Por bot, por indicador, por par y por hora del dia.
 *  - Costes estimados (comisiones + slippage) y lo que se comieron.
 *  - Bots con muchas operaciones y sin ventaja (la alerta del plan).
 *  - Avisos honestos: que NO demuestra este informe.
 */

import {
  botsSinVentaja,
  costeDeOperacion,
  horaDe,
  operacionesCerradas,
  resumenPor,
  type OperacionMedida,
  type ResumenGrupo,
} from "./metricas";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type InformeMetricas = {
  totales: {
    operaciones: number;
    pnlNeto: number;
    winRatePct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    costeEstimado: number;
    /** Fraccion de las operaciones que tienen la señal registrada. */
    conSenal: number;
  };
  porBot: ResumenGrupo[];
  porIndicador: ResumenGrupo[];
  porPar: ResumenGrupo[];
  porHora: ResumenGrupo[];
  sinVentaja: {
    botId: string;
    botName: string;
    operaciones: number;
    pnlNeto: number;
    profitFactor: number;
  }[];
  avisos: string[];
};

/** Lee las operaciones del motor y monta el informe. */
export async function informeMetricas(
  db: Db,
  opciones: { userId?: string | null; desde?: string } = {},
): Promise<InformeMetricas> {
  // Los bots del usuario (o todos, si es el administrador de la plataforma).
  const { data: bots } = await db.from("bots").select("id, name, user_id");
  const filas = (bots ?? []) as { id: string; name: string; user_id?: string | null }[];
  const ids =
    opciones.userId === undefined
      ? filas.map((b) => b.id)
      : filas.filter((b) => (b.user_id ?? null) === opciones.userId).map((b) => b.id);

  if (ids.length === 0) {
    return {
      totales: {
        operaciones: 0,
        pnlNeto: 0,
        winRatePct: 0,
        profitFactor: 0,
        maxDrawdownPct: 0,
        costeEstimado: 0,
        conSenal: 0,
      },
      porBot: [],
      porIndicador: [],
      porPar: [],
      porHora: [],
      sinVentaja: [],
      avisos: ["No hay bots que medir todavia."],
    };
  }

  const { data: ejecuciones } = await db
    .from("bot_executions")
    .select(
      "bot_id, bot_name, symbol, side, pnl, mode, price, quantity, created_at, signal_indicators, signal_reason",
    )
    .in("bot_id", ids)
    .order("created_at", { ascending: true });

  const ops: OperacionMedida[] = (
    (ejecuciones ?? []) as {
      bot_id: string;
      bot_name: string;
      symbol: string;
      side: string;
      pnl: number | string | null;
      mode: string;
      price: number | string | null;
      quantity: number | string | null;
      created_at: string;
      signal_indicators?: string[] | null;
      signal_reason?: string | null;
    }[]
  ).map((e) => ({
    botId: e.bot_id,
    botName: e.bot_name,
    simbolo: e.symbol,
    lado: e.side,
    pnl: Number(e.pnl ?? 0),
    modo: e.mode,
    precio: Number(e.price ?? 0),
    cantidad: Number(e.quantity ?? 0),
    createdAt: e.created_at,
    indicadores: e.signal_indicators ?? [],
    motivo: e.signal_reason ?? null,
  }));

  const cerradas = operacionesCerradas(ops);
  const porBot = resumenPor((o) => o.botId, cerradas);
  const porIndicador = resumenPor(
    (o) => (o.indicadores.length ? o.indicadores.join(" + ") : null),
    cerradas,
  );
  const porPar = resumenPor((o) => o.simbolo, cerradas);
  const porHora = resumenPor((o) => horaDe(o.createdAt) || null, cerradas);

  const pnlNeto = cerradas.reduce((a, o) => a + o.pnl, 0);
  const costeEstimado = cerradas.reduce((a, o) => a + costeDeOperacion(o), 0);
  const conSenal = cerradas.filter((o) => o.indicadores.length > 0).length;

  // Drawdown de la curva de P&L acumulado.
  let acumulado = 0;
  let pico = 0;
  let maxDd = 0;
  for (const o of cerradas) {
    acumulado += o.pnl;
    if (acumulado > pico) pico = acumulado;
    if (pico > 0) {
      const caida = ((pico - acumulado) / pico) * 100;
      if (caida > maxDd) maxDd = caida;
    }
  }

  const sinVentaja = botsSinVentaja(cerradas);

  const avisos: string[] = [];
  if (cerradas.length < 30) {
    avisos.push(
      `Solo ${cerradas.length} operaciones cerradas: con menos de 30, estas cifras son ruido y no demuestran nada.`,
    );
  }
  if (cerradas.length > 0 && conSenal < cerradas.length) {
    avisos.push(
      `${cerradas.length - conSenal} operaciones no tienen la señal registrada (se hicieron antes del registro de indicadores): esos grupos no se pueden atribuir a un indicador.`,
    );
  }
  if (sinVentaja.length > 0) {
    avisos.push(
      `${sinVentaja.length} bot(s) con muchas operaciones y profit factor por debajo de 1: están perdiendo dinero de forma sistematica.`,
    );
  }
  if (cerradas.length > 0 && porBot.every((g) => g.profitFactor < 1)) {
    avisos.push(
      "Ningún bot tiene profit factor por encima de 1: con estos numeros, la estrategia no tiene ventaja demostrada.",
    );
  }

  return {
    totales: {
      operaciones: cerradas.length,
      pnlNeto: Number(pnlNeto.toFixed(4)),
      winRatePct: porBot.length
        ? Number(
            ((cerradas.filter((o) => o.pnl > 0).length / (cerradas.length || 1)) * 100).toFixed(2),
          )
        : 0,
      profitFactor: porBot.length
        ? Number(
            (
              cerradas.filter((o) => o.pnl > 0).reduce((a, o) => a + o.pnl, 0) /
              Math.abs(cerradas.filter((o) => o.pnl < 0).reduce((a, o) => a + o.pnl, 0) || 1)
            ).toFixed(4),
          )
        : 0,
      maxDrawdownPct: Number(maxDd.toFixed(4)),
      costeEstimado: Number(costeEstimado.toFixed(4)),
      conSenal: cerradas.length ? Number(((conSenal / cerradas.length) * 100).toFixed(1)) : 0,
    },
    porBot,
    porIndicador,
    porPar,
    porHora,
    sinVentaja,
    avisos,
  };
}
