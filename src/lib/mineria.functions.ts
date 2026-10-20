// Funciones de servidor del motor de mineria.
//
// Todo lo que sale de aqui esta medido o viene de una fuente con nombre:
// el hash rate se mide en la maquina, los datos de la red son de
// mempool.space y el precio es de Binance (produccion).
//
// Si falta la migracion 20261026000000_mineria_real.sql, la app sigue
// funcionando: lo avisa y usa los valores por defecto.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Estado real del enjambre: hash rate medido, ganancia bruta, coste de luz
 * y resultado neto. Es lo que la pagina Mineria enseña arriba.
 */
export const estadoMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { medirHashRateMaquina } = await import("./mineria/hashrate");
    const { aUnidadLegible, balanceDiario, repartirHashRate, workersActivos } =
      await import("./mineria/modelo");
    const { obtenerRed } = await import("./mineria/red");
    const { PRECIO_KWH_POR_DEFECTO } = await import("./mineria/tick");

    const medicion = medirHashRateMaquina(1200);
    const hashMaquina = medicion.hashPorSegundo;

    // Las columnas nuevas todavia pueden no estar (migracion 20261026000000):
    // si faltan, se leen las antiguas y la app lo avisa, pero sigue.
    const conNuevas = await db
      .from("mining_workers")
      .select(
        "id,user_id,name,coin,pool,rig_id,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings,last_seen_at,power_watts,gross_daily_usd,net_daily_usd,network_config",
      )
      .eq("user_id", context.userId);
    let filas: unknown[] = (conNuevas.data ?? []) as unknown[];
    let avisoMigracion: string | null = null;
    if (conNuevas.error) {
      const antiguas = await db
        .from("mining_workers")
        .select(
          "id,user_id,name,coin,pool,rig_id,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings",
        )
        .eq("user_id", context.userId);
      if (antiguas.error) throw new Error(antiguas.error.message);
      filas = (antiguas.data ?? []) as unknown[];
      avisoMigracion =
        "Falta la migracion 20261026000000_mineria_real.sql: se muestran las cifras basicas, pero no se guardan el hash rate real, el neto ni el precio de la luz.";
    }

    const filasTipadas = filas as Array<{
      id: string;
      user_id: string;
      name: string;
      coin: string;
      pool: string;
      rig_id: string;
      status: string;
      hash_rate: number;
      hash_unit: string;
      uptime_seconds: number;
      estimated_daily_earnings: number;
      last_seen_at: string | null;
      power_watts: number | null;
      gross_daily_usd: number | null;
      net_daily_usd: number | null;
      network_config: Record<string, string | number | undefined> | null;
    }>;

    // Precio del kWh (columna nueva; si no esta, el valor por defecto).
    const { data: ajustes } = await db
      .from("automation_settings")
      .select("mineria_kwh_usd")
      .eq("user_id", context.userId)
      .limit(1);
    const precioKwh = Number((ajustes ?? [])[0]?.mineria_kwh_usd ?? 0) || PRECIO_KWH_POR_DEFECTO;

    const activos = workersActivos(filasTipadas);
    const hashPorWorker = repartirHashRate(hashMaquina, activos);

    const workers = [];
    let brutoTotal = 0;
    let luzTotal = 0;
    let netoTotal = 0;

    for (const w of filasTipadas) {
      const config = (w.network_config ?? null) as Parameters<typeof obtenerRed>[1];
      const red = await obtenerRed(w.coin, config);
      const watts = Number(w.power_watts ?? 0) || 65;
      const esActivo = w.status === "mining";
      const balance = balanceDiario(
        {
          hashPorSegundo: esActivo ? hashPorWorker : 0,
          hashPorSegundoRed: aUnidadLegible(esActivo ? hashPorWorker : 0).valor,
          hashPorSegundoHashes: esActivo ? hashPorWorker : 0,
          unidad: aUnidadLegible(esActivo ? hashPorWorker : 0).unidad,
        },
        red,
        watts,
        precioKwh,
      );
      if (esActivo) {
        brutoTotal += balance.brutoUsd;
        luzTotal += balance.luzUsd;
        netoTotal += balance.netoUsd;
      }
      workers.push({
        id: w.id,
        name: w.name,
        coin: w.coin,
        pool: w.pool,
        rigId: w.rig_id,
        status: w.status,
        hashRate: esActivo ? aUnidadLegible(hashPorWorker).valor : 0,
        hashUnit: aUnidadLegible(esActivo ? hashPorWorker : 0).unidad,
        uptimeSegundos: Number(w.uptime_seconds ?? 0),
        potenciaWatts: watts,
        brutoUsd: balance.brutoUsd,
        luzUsd: balance.luzUsd,
        netoUsd: balance.netoUsd,
        veredicto: balance.veredicto,
        red: red
          ? {
              hashRateRed: red.hashRateRed,
              recompensaBloque: red.recompensaBloque,
              tiempoBloqueSegundos: red.tiempoBloqueSegundos,
              precioUsd: red.precioUsd,
              fuente: red.fuente,
              fecha: red.fecha ?? null,
            }
          : null,
        ultimoContacto: w.last_seen_at ?? null,
      });
    }

    const veredicto =
      activos === 0
        ? "No hay ningun equipo minando: enciende uno y se medira el hash rate real de esta maquina."
        : netoTotal <= 0
          ? `El enjambre pierde ${Math.abs(netoTotal).toFixed(4)} USD al dia: la luz cuesta mas que lo que se mina. Minar en casa NO sale a cuenta.`
          : `El enjambre gana ${netoTotal.toFixed(4)} USD al dia netos de luz (sin contar el desgaste ni el calor).`;

    return {
      medido: {
        hashPorSegundo: hashMaquina,
        valor: medicion.valor,
        unidad: medicion.unidad,
        medidoAt: medicion.medidoAt,
        cacheado: medicion.cacheado,
        muestras: medicion.muestras,
      },
      workersActivos: activos,
      workers,
      totales: {
        brutoUsd: brutoTotal,
        luzUsd: luzTotal,
        netoUsd: netoTotal,
        precioKwh,
      },
      veredicto,
      aviso: avisoMigracion,
    };
  });

/** Mide el hash rate de verdad (fuerza la medicion, sin cache). */
export const medirHashrateMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { invalidarCacheHashRate, medirHashRateMaquina } = await import("./mineria/hashrate");
    invalidarCacheHashRate();
    const medicion = medirHashRateMaquina(2000);
    return {
      hashPorSegundo: medicion.hashPorSegundo,
      valor: medicion.valor,
      unidad: medicion.unidad,
      medidoAt: medicion.medidoAt,
      muestras: medicion.muestras,
    };
  });

/** Avanza el enjambre un paso ahora mismo (lo que hace el cron cada minuto). */
export const avanzarMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = await admin();
    const { tickMineria } = await import("./mineria/tick");
    return await tickMineria(db, { forzarMidir: false });
  });

/** Guarda el precio del kWh del dueno. */
export const guardarCosteLuz = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ precioKwh: z.number().min(0).max(10) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db
      .from("automation_settings")
      .update({ mineria_kwh_usd: data.precioKwh })
      .eq("user_id", context.userId);
    if (error) {
      if (/42703|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) {
        throw new Error(
          "Falta la migracion 20261026000000_mineria_real.sql (columna mineria_kwh_usd). Aplicala en el SQL Editor de Supabase.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

/**
 * Guarda la configuracion manual de la red de un worker (para las monedas
 * sin API: el dueno pega los numeros de su pool).
 */
export const guardarConfigRedWorker = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        workerId: z.string().uuid(),
        hashRateRed: z.number().nonnegative().optional(),
        recompensaBloque: z.number().nonnegative().optional(),
        tiempoBloqueSegundos: z.number().positive().optional(),
        precioUsd: z.number().nonnegative().optional(),
        fuente: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: fila } = await db
      .from("mining_workers")
      .select("id")
      .eq("id", data.workerId)
      .eq("user_id", context.userId)
      .limit(1);
    if (!fila || fila.length === 0) throw new Error("Ese equipo no es tuyo.");

    const config = {
      hashRateRed: data.hashRateRed,
      recompensaBloque: data.recompensaBloque,
      tiempoBloqueSegundos: data.tiempoBloqueSegundos,
      precioUsd: data.precioUsd,
      fuente: data.fuente ?? "introducido a mano",
      fecha: new Date().toISOString().slice(0, 10),
    };
    const { error } = await db
      .from("mining_workers")
      .update({ network_config: config })
      .eq("id", data.workerId)
      .eq("user_id", context.userId);
    if (error) {
      if (/42703|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) {
        throw new Error(
          "Falta la migracion 20261026000000_mineria_real.sql (columna network_config). Aplicala en el SQL Editor de Supabase.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });
