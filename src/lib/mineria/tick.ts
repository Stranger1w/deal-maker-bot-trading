/**
 * MOTOR DE MINERIA: el tick del enjambre.
 *
 * QUE HACE (todo con datos de verdad)
 *  1) Mide el hash rate REAL de la maquina (benchmark SHA-256).
 *  2) Lo reparte entre los workers que estan minando de cada dueno (todos
 *     usan el MISMO CPU: tres workers no dan tres veces el hash rate).
 *  3) Calcula la ganancia bruta con los datos de la red y el precio reales,
 *     y la RESTA el coste de la luz.
 *  4) Suma el uptime, guarda un punto de historico y detecta workers caidos.
 *  5) Una vez al dia genera el pago con lo acumulado.
 *
 * LO QUE NO HACE
 *  - No inventa cifras: si no hay datos de la red, el worker queda con 0 y
 *    la app lo dice ("sin datos de la red").
 *  - No toca el trading ni el dinero de los bots.
 */

import { medirHashRateMaquina } from "./hashrate";
import {
  aUnidadLegible,
  balanceDiario,
  repartirHashRate,
  workersActivos,
  type HashRatePropio,
} from "./modelo";
import { obtenerRed, type NetworkConfig } from "./red";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type WorkerMina = {
  id: string;
  user_id: string;
  name: string;
  coin: string;
  pool: string;
  status: string;
  hash_rate: number;
  hash_unit: string;
  uptime_seconds: number;
  estimated_daily_earnings: number;
  updated_at: string;
  last_seen_at?: string | null;
  power_watts?: number | null;
  gross_daily_usd?: number | null;
  net_daily_usd?: number | null;
  last_payout_at?: string | null;
  network_config?: NetworkConfig | null;
};

/** Precio por kWh por defecto si el dueno no lo pone (0,15 USD es tipico). */
export const PRECIO_KWH_POR_DEFECTO = 0.15;

/** Potencia estimada por defecto de un PC de casa minando (watts). */
export const POTENCIA_POR_DEFECTO = 65;

/** Minutos sin ver al worker para darlo por caido. */
export const MINUTOS_OFFLINE = 10;

export type ResultadoMineria = {
  workersRevisados: number;
  workersActualizados: number;
  offlineDetectados: number;
  payoutsGenerados: number;
  hashRateMaquina: number;
  hashRateUnidad: string;
  /** Por dueno: lo que se ve en la pantalla. */
  porUsuario: Array<{
    userId: string;
    workers: number;
    hashRateTotal: number;
    brutoUsd: number;
    luzUsd: number;
    netoUsd: number;
    veredicto: string;
  }>;
  errores: string[];
};

/**
 * Avanza el enjambre un paso.
 *
 * @param db cliente con service_role
 * @param opciones.forzarMidir ignora la cache del benchmark (para el boton
 *   "Medir ahora")
 */
export async function tickMineria(
  db: Db,
  opciones: { forzarMidir?: boolean } = {},
): Promise<ResultadoMineria> {
  const errores: string[] = [];

  // Las columnas nuevas (migracion 20261026000000) todavia pueden no estar:
  // en ese caso se leen las antiguas y el motor avisa, pero sigue operando.
  const conNuevas = await db
    .from("mining_workers")
    .select(
      "id,user_id,name,coin,pool,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings,updated_at,last_seen_at,power_watts,gross_daily_usd,net_daily_usd,last_payout_at,network_config",
    )
    .in("status", ["mining", "offline"]);
  let filas: unknown[] | null = (conNuevas.data ?? []) as unknown[];
  if (conNuevas.error) {
    const antiguas = await db
      .from("mining_workers")
      .select(
        "id,user_id,name,coin,pool,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings,updated_at",
      )
      .in("status", ["mining", "offline"]);
    if (antiguas.error) {
      return {
        workersRevisados: 0,
        workersActualizados: 0,
        offlineDetectados: 0,
        payoutsGenerados: 0,
        hashRateMaquina: 0,
        hashRateUnidad: "MH/s",
        porUsuario: [],
        errores: [antiguas.error.message],
      };
    }
    filas = (antiguas.data ?? []) as unknown[];
    errores.push(
      "Faltan las columnas del motor de mineria (migracion 20261026000000_mineria_real.sql): se avanza el enjambre sin guardar el hash rate real ni el neto.",
    );
  }

  const workers = (filas ?? []) as unknown as WorkerMina[];
  const minando = workers.filter((w) => w.status === "mining");

  // 1) Hash rate real de la maquina.
  const medicion = opciones.forzarMidir ? medirHashRateMaquina(1500) : medirHashRateMaquina(1200);
  const hashMaquina = medicion.hashPorSegundo;

  // 2) Reparto por dueno (cada dueno tiene sus workers en esta maquina).
  const porUsuario = new Map<string, WorkerMina[]>();
  for (const w of minando) {
    const lista = porUsuario.get(w.user_id) ?? [];
    lista.push(w);
    porUsuario.set(w.user_id, lista);
  }

  const resumen = new Map<
    string,
    { hashRateTotal: number; brutoUsd: number; luzUsd: number; netoUsd: number; workers: number }
  >();

  let actualizados = 0;
  let offline = 0;
  let payouts = 0;
  const ahora = new Date();
  const ahoraIso = ahora.toISOString();

  for (const [userId, lista] of porUsuario) {
    const activos = workersActivos(lista);
    const hashPorWorker = repartirHashRate(hashMaquina, activos);

    for (const w of lista) {
      const config = (w.network_config ?? null) as NetworkConfig | null;
      const red = await obtenerRed(w.coin, config);
      const precioKwh = await leerPrecioKwh(db, userId);
      const watts = Number(w.power_watts ?? 0) || POTENCIA_POR_DEFECTO;

      const hashPropio: HashRatePropio = {
        hashPorSegundo: hashPorWorker,
        hashPorSegundoRed: aUnidadLegible(hashPorWorker).valor,
        hashPorSegundoHashes: hashPorWorker,
        unidad: aUnidadLegible(hashPorWorker).unidad,
      };
      const balance = balanceDiario(hashPropio, red, watts, precioKwh);

      // Uptime: lo que ha pasado desde la ultima vez que se vio al worker.
      const ultimaVez = Date.parse(w.last_seen_at ?? w.updated_at ?? ahoraIso);
      const transcurrido = Number.isFinite(ultimaVez)
        ? Math.max(0, Math.min(3600, Math.floor((ahora.getTime() - ultimaVez) / 1000)))
        : 0;

      const patch = {
        hash_rate: aUnidadLegible(hashPorWorker).valor,
        hash_unit: aUnidadLegible(hashPorWorker).unidad,
        uptime_seconds: Number(w.uptime_seconds ?? 0) + transcurrido,
        // El dato que se ve es el NETO: la luz tambien es dinero.
        estimated_daily_earnings: Number(balance.netoUsd.toFixed(6)),
        gross_daily_usd: Number(balance.brutoUsd.toFixed(6)),
        net_daily_usd: Number(balance.netoUsd.toFixed(6)),
        power_watts: watts,
        last_seen_at: ahoraIso,
        updated_at: ahoraIso,
      };

      const { error: errorPatch } = await db
        .from("mining_workers")
        .update(patch)
        .eq("id", w.id)
        .eq("user_id", w.user_id);
      if (errorPatch) {
        // Si lo que falla son las columnas nuevas, se guarda lo basico: el
        // motor sigue avanza (hash rate, uptime y estimate).
        const { error: errorMinimo } = await db
          .from("mining_workers")
          .update({
            hash_rate: patch.hash_rate,
            hash_unit: patch.hash_unit,
            uptime_seconds: patch.uptime_seconds,
            estimated_daily_earnings: patch.estimated_daily_earnings,
            updated_at: patch.updated_at,
          })
          .eq("id", w.id)
          .eq("user_id", w.user_id);
        if (errorMinimo) {
          errores.push(`${w.name}: ${errorMinimo.message}`);
          continue;
        }
        errores.push(
          `${w.name}: faltan las columnas del motor de mineria (migracion 20261026000000_mineria_real.sql).`,
        );
      }
      actualizados++;

      // Historico: una vez por hora y worker (no 1440 filas al dia).
      const ultimaHistoria = await db
        .from("mining_hashrate_history")
        .select("recorded_on")
        .eq("worker_id", w.id)
        .order("recorded_on", { ascending: false })
        .limit(1);
      const ultimaFecha = (ultimaHistoria.data ?? [])[0]?.recorded_on ?? null;
      const hoy = ahoraIso.slice(0, 10);
      if (ultimaFecha !== hoy || Date.now() % 3600000 < 60000) {
        await db.from("mining_hashrate_history").insert({
          worker_id: w.id,
          worker_name: w.name,
          coin: w.coin,
          recorded_on: hoy,
          hash_rate: patch.hash_rate,
          hash_unit: patch.hash_unit,
          is_demo: false,
        });
      }

      // Pago diario: una vez al dia. Para saber cuando fue el ultimo se
      // mira la tabla de pagos (que existe siempre) y, si esta, la columna
      // last_payout_at del worker.
      const ultimoPago = await leerUltimoPago(db, w);
      if (Date.now() - ultimoPago > 24 * 3600 * 1000) {
        const { error: errorPago } = await db.from("mining_payouts").insert({
          worker_id: w.id,
          coin: w.coin,
          pool: w.pool,
          amount: Number(balance.monedasDia.toFixed(8)),
          usd_value: Number(balance.brutoUsd.toFixed(8)),
          paid_at: ahoraIso,
          user_id: w.user_id,
        });
        if (!errorPago) {
          payouts++;
          await db
            .from("mining_workers")
            .update({ last_payout_at: ahoraIso })
            .eq("id", w.id)
            .eq("user_id", w.user_id);
        }
      }

      const acc = resumen.get(userId) ?? {
        hashRateTotal: 0,
        brutoUsd: 0,
        luzUsd: 0,
        netoUsd: 0,
        workers: 0,
      };
      acc.hashRateTotal += hashPorWorker;
      acc.brutoUsd += balance.brutoUsd;
      acc.luzUsd += balance.luzUsd;
      acc.netoUsd += balance.netoUsd;
      acc.workers++;
      resumen.set(userId, acc);
    }
  }

  // 3) Workers caidos: sin contacto desde hace rato.
  for (const w of workers) {
    if (w.status !== "offline") continue;
    const visto = w.last_seen_at ? Date.parse(w.last_seen_at) : 0;
    if (!visto || Date.now() - visto > MINUTOS_OFFLINE * 60 * 1000) {
      offline++;
    }
  }

  const porUsuarioSalida = [...resumen.entries()].map(([userId, acc]) => {
    const veredicto =
      acc.netoUsd <= 0
        ? `El enjambre pierde ${Math.abs(acc.netoUsd).toFixed(4)} USD al dia: la luz se come lo que se mina. Minar en casa no sale a cuenta.`
        : `El enjambre gana ${acc.netoUsd.toFixed(4)} USD al dia netos de luz.`;
    return {
      userId,
      workers: acc.workers,
      hashRateTotal: acc.hashRateTotal,
      brutoUsd: acc.brutoUsd,
      luzUsd: acc.luzUsd,
      netoUsd: acc.netoUsd,
      veredicto,
    };
  });

  return {
    workersRevisados: workers.length,
    workersActualizados: actualizados,
    offlineDetectados: offline,
    payoutsGenerados: payouts,
    hashRateMaquina: hashMaquina,
    hashRateUnidad: medicion.unidad,
    porUsuario: porUsuarioSalida,
    errores,
  };
}

/**
 * Cuando fue el ultimo pago de este worker (en milisegundos, 0 si nunca).
 *
 * Se mira primero la columna last_payout_at del worker (migracion nueva) y,
 * si no esta, la tabla de pagos: asi el motor NO paga cada minuto mientras
 * el dueno no aplique la migracion.
 */
async function leerUltimoPago(db: Db, w: WorkerMina): Promise<number> {
  if (w.last_payout_at) {
    const marca = Date.parse(w.last_payout_at);
    if (Number.isFinite(marca)) return marca;
  }
  const conWorker = await db
    .from("mining_payouts")
    .select("paid_at")
    .eq("user_id", w.user_id)
    .eq("worker_id", w.id)
    .order("paid_at", { ascending: false })
    .limit(1);
  if (!conWorker.error && (conWorker.data ?? []).length > 0) {
    const marca = Date.parse((conWorker.data ?? [])[0]?.paid_at ?? "");
    if (Number.isFinite(marca)) return marca;
  }
  const sinWorker = await db
    .from("mining_payouts")
    .select("paid_at")
    .eq("user_id", w.user_id)
    .eq("coin", w.coin)
    .eq("pool", w.pool)
    .order("paid_at", { ascending: false })
    .limit(1);
  if (!sinWorker.error && (sinWorker.data ?? []).length > 0) {
    const marca = Date.parse((sinWorker.data ?? [])[0]?.paid_at ?? "");
    if (Number.isFinite(marca)) return marca;
  }
  return 0;
}

/** Precio del kWh del dueno (de su fila de automation_settings). */ async function leerPrecioKwh(
  db: Db,
  userId: string,
): Promise<number> {
  // La columna es nueva (migracion 20261026000000): si no esta, se usa el
  // precio por defecto sin que el motor se caiga.
  const { data, error } = await db
    .from("automation_settings")
    .select("mineria_kwh_usd")
    .eq("user_id", userId)
    .limit(1);
  if (error) return PRECIO_KWH_POR_DEFECTO;
  const valor = Number((data ?? [])[0]?.mineria_kwh_usd ?? 0);
  return valor > 0 ? valor : PRECIO_KWH_POR_DEFECTO;
}
