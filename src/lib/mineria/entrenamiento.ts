/**
 * CAMPO DE ENTRENAMIENTO DE MINEROS.
 *
 * QUE ES
 * Un "entrenamiento" aqui NO es un bonus inventado: es una MEDICION. Se
 * mide de verdad (con SHA-256 real y con workers reales) cuanto rinde esta
 * maquina con 1, 2, 3 o 4 hilos, y se guarda la curva. Cada equipo tiene
 * un numero de hilos: el motor reparte la capacidad REAL de la maquina
 * segun los hilos de cada uno.
 *
 * POR QUE IMPORTA
 * Sin esto, la app decia 300 KH/s (un solo nucleo) cuando la maquina da
 * 1,6 MH/s con los 4. Con el campo de entrenamiento se ve la curva real y
 * se reparte bien: cuatro equipos con un hilo cada uno no pueden dar mas
 * que la maquina, pero tampoco son cuatro veces menos de lo que puede.
 *
 * LO QUE NO HACE
 * No promete que minar salga a cuenta: eso lo dice el balance, con los datos
 * de la red y el precio reales.
 */

import { medirCurvaHashrate, medirHashRateHilos, nucleosDisponibles } from "./hashrate-hilos";
import { aUnidadLegible } from "./modelo";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Hilos por defecto si el equipo no tiene ninguno asignado. */
export const HILOS_POR_DEFECTO = 1;

export type PasoEntrenamiento = {
  hilos: number;
  hashPorSegundo: number;
  valor: number;
  unidad: string;
  hashes: number;
};

export type ResultadoEntrenamiento = {
  workerId: string;
  workerNombre: string;
  /** Nucleos de la maquina. */
  nucleos: number;
  /** Hash rate SOSTENIDO (10 s): el que de verdad se gana minando horas. */
  hashSostenido: number;
  valorSostenido: number;
  unidadSostenido: string;
  /** Cuanto baja el rendimiento con el tiempo (el PC se calienta). */
  caidaPct: number;
  /** La curva medida (de verdad). */
  curva: PasoEntrenamiento[];
  /** Hilos elegidos (los que mejor rinden). */
  hilosElegidos: number;
  /** Hash rate medido con esos hilos. */
  hashPorSegundo: number;
  valor: number;
  unidad: string;
  /** Hash rate de un solo nucleo (el de antes de entrenar). */
  antesHashPorSegundo: number;
  /** Cuanto se ha mejorado (multiplicador). */
  mejora: number;
  /** Si se ha podido guardar en la base. */
  guardado: boolean;
  aviso: string | null;
};

/**
 * Entrena (mide) a un equipo y guarda el resultado.
 *
 * @param db cliente con service_role
 * @param workerId equipo a entrenar
 * @param userId dueno (para no tocar equipos de otros)
 * @param duracionMs duracion de cada medicion
 */
export async function entrenarWorker(
  db: Db,
  workerId: string,
  userId: string,
  duracionMs = 1500,
): Promise<ResultadoEntrenamiento> {
  // La columna 'hilos' es nueva (migracion 20261026000000): si no esta
  // todavia, se leen las antiguas y el equipo usa 1 hilo hasta que se aplique.
  const conHilos = await db
    .from("mining_workers")
    .select("id, name, hilos")
    .eq("id", workerId)
    .eq("user_id", userId)
    .limit(1);
  let fila: { id: string; name: string; hilos?: number | null } | undefined;
  if (!conHilos.error && (conHilos.data ?? []).length > 0) {
    fila = (conHilos.data ?? [])[0] as { id: string; name: string; hilos?: number | null };
  } else {
    const antiguas = await db
      .from("mining_workers")
      .select("id, name")
      .eq("id", workerId)
      .eq("user_id", userId)
      .limit(1);
    fila = (antiguas.data ?? [])[0] as
      { id: string; name: string; hilos?: number | null } | undefined;
  }
  if (!fila) throw new Error("Ese equipo no es tuyo (o ya no existe).");

  const nucleos = nucleosDisponibles();
  const pasos = Array.from({ length: nucleos }, (_, i) => i + 1);
  const curva = await medirCurvaHashrate(pasos, duracionMs);

  // El mejor punto de la curva (el que mas hashes/s da).
  const mejor = curva.reduce((a, b) => (b.hashPorSegundo > a.hashPorSegundo ? b : a));
  const uno = curva.find((c) => c.hilos === 1) ?? curva[0];
  const antes = uno?.hashPorSegundo ?? 0;

  const legible = aUnidadLegible(mejor.hashPorSegundo);

  // El hash rate SOSTENIDO: 10 segundos con los mismos hilos. Es el numero
  // que vale para un dia entero de minado (el PC se calienta y baja).
  const sostenido = await medirHashRateHilos(mejor.hilos, 10_000);
  const legibleSostenido = aUnidadLegible(sostenido.hashPorSegundo);
  const caidaPct =
    mejor.hashPorSegundo > 0
      ? ((mejor.hashPorSegundo - sostenido.hashPorSegundo) / mejor.hashPorSegundo) * 100
      : 0;

  // Se guarda el entrenamiento (si la tabla existe; si no, sigue funcionando).
  let guardado = false;
  try {
    const { error } = await db.from("mining_entrenamientos").insert({
      worker_id: fila.id,
      user_id: userId,
      hilos: mejor.hilos,
      hash_rate: Number(mejor.hashPorSegundo.toFixed(3)),
      hash_unit: legible.unidad,
      duracion_ms: duracionMs,
      hashes: mejor.hashes,
      curva: curva.map((c) => ({
        hilos: c.hilos,
        hashPorSegundo: Number(c.hashPorSegundo.toFixed(3)),
        unidad: c.unidad,
      })) as never,
      nota: `Medido con SHA-256 real en ${nucleos} nucleos`,
    });
    if (!error) {
      // Las columnas del equipo (hilos, hash_rate_max, hash_rate_sostenido)
      // tambien son nuevas: si no estan todavia, el entrenamiento se guarda
      // igual y solo no se asigna al equipo.
      const { error: errorWorker } = await db
        .from("mining_workers")
        .update({
          hilos: mejor.hilos,
          hash_rate_max: Number(mejor.hashPorSegundo.toFixed(3)),
          hash_rate_sostenido: Number(sostenido.hashPorSegundo.toFixed(3)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", fila.id)
        .eq("user_id", userId);
      if (errorWorker) {
        // Puede que falte solo la columna del hash rate sostenido: se
        // reintenta sin ella (migracion 20261028000000).
        const { error: errorSinSostenido } = await db
          .from("mining_workers")
          .update({
            hilos: mejor.hilos,
            hash_rate_max: Number(mejor.hashPorSegundo.toFixed(3)),
            updated_at: new Date().toISOString(),
          })
          .eq("id", fila.id)
          .eq("user_id", userId);
        guardado = !errorSinSostenido;
      } else {
        guardado = true;
      }
    }
  } catch {
    guardado = false;
  }

  return {
    workerId: fila.id,
    workerNombre: String(fila.name ?? ""),
    nucleos,
    curva: curva.map((c) => ({
      hilos: c.hilos,
      hashPorSegundo: c.hashPorSegundo,
      valor: aUnidadLegible(c.hashPorSegundo).valor,
      unidad: aUnidadLegible(c.hashPorSegundo).unidad,
      hashes: c.hashes,
    })),
    hilosElegidos: mejor.hilos,
    hashPorSegundo: mejor.hashPorSegundo,
    valor: legible.valor,
    unidad: legible.unidad,
    hashSostenido: sostenido.hashPorSegundo,
    valorSostenido: legibleSostenido.valor,
    unidadSostenido: legibleSostenido.unidad,
    caidaPct: Number(caidaPct.toFixed(1)),
    antesHashPorSegundo: antes,
    mejora: antes > 0 ? mejor.hashPorSegundo / antes : 1,
    guardado,
    aviso: guardado
      ? null
      : "Falta la migracion 20261026000000_mineria_real.sql (tabla mining_entrenamientos): la medicion se enseña pero no se guarda.",
  };
}

/**
 * Reparte la capacidad REAL de la maquina entre los equipos segun los hilos
 * que usa cada uno. Un equipo con 2 hilos se lleva el doble que uno con 1
 * (pero el total nunca pasa de lo que la maquina da de verdad).
 */
export function repartirPorHilos(
  hashRateMaquina: number,
  hilosPorWorker: readonly number[],
): number[] {
  const total = hilosPorWorker.reduce((s, h) => s + Math.max(0, h), 0);
  if (total <= 0) return hilosPorWorker.map(() => 0);
  return hilosPorWorker.map((h) => (hashRateMaquina * Math.max(0, h)) / total);
}

/** Entrena a todos los equipos de un dueno de golpe (el boton "entrenar enjambre"). */
export async function entrenarEnjambre(
  db: Db,
  userId: string,
  duracionMs = 1500,
): Promise<ResultadoEntrenamiento[]> {
  const { data: workers } = await db.from("mining_workers").select("id").eq("user_id", userId);
  const resultados: ResultadoEntrenamiento[] = [];
  for (const w of workers ?? []) {
    try {
      resultados.push(await entrenarWorker(db, w.id as string, userId, duracionMs));
    } catch (e) {
      // Un equipo que falla no impide entrenar los demas.
      void e;
    }
  }
  return resultados;
}

/** Ultima medicion guardada de un equipo (para mostrarla sin medir). */
export async function ultimoEntrenamiento(
  db: Db,
  workerId: string,
): Promise<{ hilos: number; hashRate: number; hashUnit: string; createdAt: string } | null> {
  const { data } = await db
    .from("mining_entrenamientos")
    .select("hilos, hash_rate, hash_unit, created_at")
    .eq("worker_id", workerId)
    .order("created_at", { ascending: false })
    .limit(1);
  const fila = (data ?? [])[0];
  if (!fila) return null;
  return {
    hilos: Number(fila.hilos),
    hashRate: Number(fila.hash_rate),
    hashUnit: String(fila.hash_unit),
    createdAt: String(fila.created_at),
  };
}

/** La capacidad real de la maquina con los hilos que se le piden. */
/**
 * La capacidad real de la maquina con los hilos que se le piden.
 *
 * Con cache: medir cuesta CPU de verdad (y el motor lo llama cada minuto),
 * asi que la medicion se reutiliza durante unos minutos.
 */
const CACHE_CAPACIDAD_MS = 10 * 60 * 1000;
const cacheCapacidad = new Map<
  number,
  { medicion: Awaited<ReturnType<typeof medirHashRateHilos>>; at: number }
>();

export async function medirCapacidad(hilos: number, duracionMs = 1200) {
  const n = Math.max(1, Math.min(Math.round(hilos), nucleosDisponibles()));
  const guardado = cacheCapacidad.get(n);
  if (guardado && Date.now() - guardado.at < CACHE_CAPACIDAD_MS) return guardado.medicion;
  const medicion = await medirHashRateHilos(n, duracionMs);
  cacheCapacidad.set(n, { medicion, at: Date.now() });
  return medicion;
}
