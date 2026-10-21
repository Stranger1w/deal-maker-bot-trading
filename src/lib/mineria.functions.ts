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

    // Las columnas nuevas todavia pueden no estar (migraciones 20261026000000
    // y 20261028000000): si faltan, se leen las antiguas y la app lo avisa,
    // pero sigue funcionando.
    const columnas = [
      "id,user_id,name,coin,pool,rig_id,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings,last_seen_at,power_watts,gross_daily_usd,net_daily_usd,network_config,pool_fee_pct,hash_rate_sostenido",
      "id,user_id,name,coin,pool,rig_id,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings,last_seen_at,power_watts,gross_daily_usd,net_daily_usd,network_config",
      "id,user_id,name,coin,pool,rig_id,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings",
    ];
    let filas: unknown[] = [];
    let avisoMigracion: string | null = null;
    for (const columnasSel of columnas) {
      const consulta = await db
        .from("mining_workers")
        .select(columnasSel)
        .eq("user_id", context.userId);
      if (!consulta.error) {
        filas = (consulta.data ?? []) as unknown[];
        if (columnasSel === columnas[1]) {
          avisoMigracion =
            "Falta la migracion 20261028000000_mineria_comision_pool.sql: se ve todo, pero sin la comision del pool.";
        } else if (columnasSel === columnas[2]) {
          avisoMigracion =
            "Falta la migracion 20261026000000_mineria_real.sql: se muestran las cifras basicas, pero no se guardan el hash rate real, el neto ni el precio de la luz.";
        }
        break;
      }
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
      pool_fee_pct?: number | null;
      hash_rate_sostenido?: number | null;
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
        // La comision del pool: se lleva su parte antes de la luz.
        Number(w.pool_fee_pct ?? 0) / 100,
      );
      if (esActivo) {
        brutoTotal += balance.gananciaUsd;
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
        poolFeePct: Number(w.pool_fee_pct ?? 0),
        gananciaUsd: balance.gananciaUsd,
        brutoUsd: balance.brutoUsd,
        comisionUsd: balance.comisionUsd,
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

    // El enjambre cuenta las GANANCIAS. La luz se informa aparte.
    const veredicto =
      activos === 0
        ? "No hay ningun equipo minando: enciende uno y se medira el hash rate real de esta maquina."
        : `El enjambre gana ${brutoTotal.toFixed(8)} USD al dia.` +
          (luzTotal > 0
            ? ` La luz de los equipos se lleva ${luzTotal.toFixed(4)} USD al dia.`
            : "");

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
        gananciaUsd: brutoTotal,
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

/**
 * Compara las monedas con el hash rate REAL de esta maquina y los datos
 * reales de la red y del precio. Es lo que sustituye a los datos de ejemplo
 * que habia en mining_sandboxes (120 TH/s de una maquina dedicada).
 */
export const compararMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { medirHashRateMaquina } = await import("./mineria/hashrate");
    const { aUnidadLegible } = await import("./mineria/modelo");
    const { obtenerRed } = await import("./mineria/red");
    const { compararMonedas } = await import("./mineria/comparar");
    const { PRECIO_KWH_POR_DEFECTO, POTENCIA_POR_DEFECTO } = await import("./mineria/tick");

    // Las monedas: las de los equipos del dueno (y BTC siempre).
    // Se prueban las columnas de la mas nueva a la mas antigua: si falta la
    // migracion de la comision del pool, la app sigue funcionando.
    let workers: Array<{
      id: string;
      name: string;
      coin: string;
      pool: string;
      hash_rate_sostenido?: number | null;
      hash_rate_max?: number | null;
      pool_fee_pct?: number | null;
      hilos?: number | null;
    }> = [];
    for (const columnasSel of [
      "id, name, coin, pool, hash_rate_sostenido, hash_rate_max, pool_fee_pct, hilos",
      "id, name, coin, pool, hash_rate_max, hilos",
      "id, name, coin, pool",
    ]) {
      const consulta = await db
        .from("mining_workers")
        .select(columnasSel)
        .eq("user_id", context.userId);
      if (!consulta.error) {
        workers = (consulta.data ?? []) as unknown as typeof workers;
        break;
      }
    }
    const monedas = [...new Set((workers ?? []).map((w) => String(w.coin).toUpperCase()))];
    if (!monedas.includes("BTC")) monedas.push("BTC");

    const medicion = medirHashRateMaquina(1500);
    // El hash rate del enjambre: el SOSTENIDO de cada equipo (10 s), que es
    // el que se gana minando horas. Si no hay ninguno, se mide la capacidad
    // de la maquina con los hilos de los equipos.
    const sostenido = (workers ?? []).reduce((s, w) => {
      const v = Number(w.hash_rate_sostenido ?? 0);
      return s + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
    const picos = (workers ?? []).reduce((s, w) => {
      const v = Number(w.hash_rate_max ?? 0);
      return s + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
    let hashRateReal = sostenido > 0 ? sostenido : picos;
    let fuenteHash = sostenido > 0 ? "sostenido (10 s)" : picos > 0 ? "pico medido" : "";
    if (hashRateReal <= 0) {
      // Sin hash rate guardado: se mide la maquina con los hilos de los equipos.
      const { medirHashRateHilos, nucleosDisponibles } = await import("./mineria/hashrate-hilos");
      const hilos = Math.max(
        1,
        Math.min(
          nucleosDisponibles(),
          (workers ?? []).reduce((s, w) => s + Number(w.hilos ?? 1), 0),
        ),
      );
      const medido = await medirHashRateHilos(hilos, 3000);
      hashRateReal = medido.hashPorSegundo;
      fuenteHash = "medido ahora (" + hilos + " hilos)";
    }
    const legible = aUnidadLegible(hashRateReal);
    const hashRate = {
      hashPorSegundo: hashRateReal,
      hashPorSegundoRed: legible.valor,
      hashPorSegundoHashes: hashRateReal,
      unidad: legible.unidad,
    };

    // Potencia y config manual: columnas nuevas (migracion 20261026000000).
    // Si no estan, se usan los valores por defecto.
    const extras = new Map<string, { power_watts?: number | null; network_config?: unknown }>();
    try {
      const { data: conExtras } = await db
        .from("mining_workers")
        .select("id, power_watts, network_config")
        .eq("user_id", context.userId);
      for (const w of conExtras ?? []) {
        extras.set(w.id as string, w as { power_watts?: number | null; network_config?: unknown });
      }
    } catch {
      // Sin migracion: valores por defecto.
    }

    // Precio del kWh.
    const { data: ajustes } = await db
      .from("automation_settings")
      .select("mineria_kwh_usd")
      .eq("user_id", context.userId)
      .limit(1);
    const precioKwh = Number((ajustes ?? [])[0]?.mineria_kwh_usd ?? 0) || PRECIO_KWH_POR_DEFECTO;

    // Datos de red: BTC en vivo; el resto, la config manual del equipo.
    const redes = new Map<string, Awaited<ReturnType<typeof obtenerRed>>>();
    for (const coin of monedas) {
      const worker = (workers ?? []).find((w) => String(w.coin).toUpperCase() === coin);
      const config = (extras.get(worker?.id ?? "")?.network_config ?? null) as Parameters<
        typeof obtenerRed
      >[1];
      redes.set(coin, await obtenerRed(coin, config));
    }

    const watts =
      Number(extras.get((workers ?? [])[0]?.id ?? "")?.power_watts ?? 0) || POTENCIA_POR_DEFECTO;
    // La comision del pool de cada equipo (la que se lleva de tu parte).
    const comisiones = new Map<string, number>();
    for (const w of workers ?? []) {
      const coin = String(w.coin).toUpperCase();
      const fee = Number(w.pool_fee_pct ?? 0);
      if (Number.isFinite(fee) && fee > 0) comisiones.set(coin, fee / 100);
    }
    const comparativa = compararMonedas(monedas, redes, hashRate, watts, precioKwh, comisiones);

    // Se guarda en mining_sandboxes (la comparativa) y mining_training_runs
    // (una fila por moneda), sustituyendo a los datos de ejemplo.
    const sandboxId = await guardarComparativa(db, context.userId, comparativa, hashRate, {
      coins: monedas,
      watts,
      precioKwh,
      medidoAt: medicion.medidoAt,
    });

    return { ...comparativa, sandboxId, watts, precioKwh, medido: medicion, fuenteHash };
  });

/** Guarda la comparativa en las tablas de la app (best-effort). */
async function guardarComparativa(
  db: Awaited<ReturnType<typeof admin>>,
  userId: string,
  comparativa: Awaited<ReturnType<typeof import("./mineria/comparar").compararMonedas>>,
  hashRate: { hashPorSegundo: number; hashPorSegundoRed: number; unidad: string },
  contexto: { coins: string[]; watts: number; precioKwh: number; medidoAt: string },
): Promise<string | null> {
  try {
    const { data: existente } = await db
      .from("mining_sandboxes")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    const fila = {
      name: `Comparativa con tu equipo (${contexto.medidoAt.slice(0, 10)})`,
      coins: contexto.coins,
      pools: [],
      simulated_hash_rate: hashRate.hashPorSegundoRed,
      simulated_hash_unit: hashRate.unidad,
      power_cost_usd_kwh: contexto.precioKwh,
      date_from: new Date().toISOString().slice(0, 10),
      date_to: new Date().toISOString().slice(0, 10),
      speed: 1,
      status: "completed",
      best_coin: comparativa.mejor?.coin ?? null,
      best_pool: null,
      estimated_daily_usd: comparativa.mejor?.gananciaUsd ?? 0,
      ai_notes:
        `Hash rate MEDIDO en esta maquina: ${hashRate.hashPorSegundoRed.toFixed(2)} ${hashRate.unidad}. ` +
        `Comparativa con los datos de la red y el precio reales. ${comparativa.veredicto}`,
      updated_at: new Date().toISOString(),
    };
    let sandboxId: string | null = null;
    if (existente && existente.length > 0) {
      sandboxId = existente[0]!.id as string;
      await db.from("mining_sandboxes").update(fila).eq("id", sandboxId).eq("user_id", userId);
    } else {
      const { data: nuevo } = await db
        .from("mining_sandboxes")
        .insert({ ...fila, user_id: userId })
        .select("id")
        .limit(1);
      sandboxId = (nuevo ?? [])[0]?.id ?? null;
    }
    if (sandboxId) {
      await db.from("mining_training_runs").delete().eq("sandbox_id", sandboxId);
      const filas = comparativa.filas.map((f) => ({
        sandbox_id: sandboxId,
        worker_name: f.coin,
        coin: f.coin,
        pool: "datos de la red",
        hash_rate: f.hashRate,
        hash_unit: f.hashUnit,
        gross_daily_usd: f.gananciaUsd ?? f.brutoUsd,
        power_daily_usd: f.luzUsd,
        net_daily_usd: f.netoUsd,
        promoted: false,
        suggested_params: { veredicto: f.veredicto, red: f.red?.fuente ?? null },
      }));
      if (filas.length) await db.from("mining_training_runs").insert(filas);
    }
    return sandboxId;
  } catch {
    // Si las tablas no estan o faltan columnas, la comparativa se enseña
    // igual: no se pierde nada por no guardarla.
    return null;
  }
}

/**
 * Entrena a un equipo: mide de verdad (SHA-256 real con workers reales)
 * cuanto rinde la maquina con 1, 2, 3... hilos y guarda la curva.
 */
export const entrenarWorkerMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({ workerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { entrenarWorker } = await import("./mineria/entrenamiento");
    return await entrenarWorker(db, data.workerId, context.userId);
  });

/** Entrena a todo el enjambre de golpe. */
export const entrenarEnjambreMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { entrenarEnjambre } = await import("./mineria/entrenamiento");
    const resultados = await entrenarEnjambre(db, context.userId);
    return {
      resultados,
      mensaje:
        resultados.length > 0
          ? `Enjambre entrenado: ${resultados.length} equipo(s) medidos con SHA-256 real.`
          : "No hay equipos que entrenar.",
    };
  });

/** Guarda el precio del kWh del dueno. */ export const guardarCosteLuz = createServerFn({
  method: "POST",
})
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
