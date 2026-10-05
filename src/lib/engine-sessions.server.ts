// Ciclo de vida de sesiones del motor 24/7 (Fase 1 · Motor Temporizador / 24-7).
// Server-only: se opera exclusivamente con supabaseAdmin (service_role); no lee
// ni escribe flags de trading real ni usa binance_trading_env.
//
// Tabla public.engine_sessions (migracion 20261005000000_engine_sessions.sql):
//  - Solo existe UNA sesion a la vez en estado 'active' o 'closing': el indice
//    unico parcial engine_sessions_one_active sobre ((true)) WHERE status IN
//    ('active','closing') lo garantiza en la base.
//  - 'closed' exige close_reason y session_stopped_at (constraint closed_has_reason).
//  - 'timer' exige session_ends_at (constraint timer_needs_end).
//
// P&L por rango: SUM(bot_executions.pnl) con created_at en
// [session_started_at, session_stopped_at] (verificado contra el esquema real:
// bot_executions.pnl numeric NOT NULL, created_at timestamptz).
//
// Transicion closing->closed idempotente: el UPDATE filtra WHERE status='closing';
// repetir el cierre afecta 0 filas y no altera una sesion ya cerrada.

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type SessionMode = "timer" | "24x7";
export type SessionStatus = "active" | "closing" | "closed";
export type CloseReason = "timer" | "kill_switch" | "manual" | "error";

export type EngineSession = {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  session_started_at: string;
  session_ends_at: string | null;
  session_stopped_at: string | null;
  close_reason: CloseReason | null;
  runs_count: number;
  orders_count: number;
  errors_count: number;
  pnl_total: number;
  last_tick_at: string | null;
};

/** Suma los pnl de las ejecuciones de un rango, redondeados a 2 decimales. */
export function resumenPnl(valores: readonly number[]): number {
  const suma = valores.reduce((acc, v) => acc + v, 0);
  return Math.round(suma * 100) / 100;
}

/** Una sesion timer vence cuando session_ends_at ya paso y sigue 'active'. */
export function expiraPorTimer(
  sesion: Pick<EngineSession, "mode" | "status" | "session_ends_at">,
  ahora: Date,
): boolean {
  return (
    sesion.mode === "timer" &&
    sesion.status === "active" &&
    sesion.session_ends_at !== null &&
    Date.parse(sesion.session_ends_at) <= ahora.getTime()
  );
}

/** Devuelve la sesion activa o en cierre (la unica posible por el indice unico). */
export async function obtenerSesionActiva(db: Db): Promise<EngineSession | null> {
  const { data, error } = await db
    .from("engine_sessions")
    .select("*")
    .in("status", ["active", "closing"])
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la sesion activa: ${error.message}`);
  return (data as EngineSession | null) ?? null;
}

/**
 * Abre una sesion. Si el indice unico parcial detecta que ya hay una
 * active/closing (error 23505), devuelve esa sesion existente en vez de fallar.
 */
export async function iniciarSesion(
  db: Db,
  args: { mode: SessionMode; session_ends_at?: string | null },
): Promise<EngineSession> {
  const { data, error } = await db
    .from("engine_sessions")
    .insert({
      mode: args.mode,
      status: "active",
      session_ends_at: args.mode === "timer" ? (args.session_ends_at ?? null) : null,
    })
    .select("*")
    .single();
  if (!error && data) return data as EngineSession;
  if (error?.code === "23505") {
    const existente = await obtenerSesionActiva(db);
    if (existente) return existente;
  }
  throw new Error(`No se pudo iniciar la sesion: ${error?.message ?? "error desconocido"}`);
}

/**
 * active -> closing, persistiendo el motivo del cierre (timer/kill_switch/
 * manual/error) para que el cierre final sepa con que motivo cerrar. No-op si
 * la sesion no esta 'active' (WHERE status='active'): un cierre ya en curso no
 * cambia de motivo por esta via.
 */
export async function marcarSesionParaCierre(
  db: Db,
  sessionId: string,
  reason: CloseReason,
): Promise<void> {
  const { error } = await db
    .from("engine_sessions")
    .update({
      status: "closing",
      close_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "active");
  if (error) throw new Error(`No se pudo marcar la sesion para cierre: ${error.message}`);
}

/**
 * closing -> closed (idempotente): el UPDATE filtra WHERE status='closing', asi
 * que una segunda llamada sobre una sesion ya cerrada afecta 0 filas. Al cerrar
 * calcula el P&L por rango ([session_started_at, session_stopped_at] sobre
 * bot_executions.pnl) y lo guarda en pnl_total.
 */
export async function cerrarSesion(
  db: Db,
  sessionId: string,
  reason: CloseReason,
): Promise<EngineSession | null> {
  const ahora = new Date().toISOString();
  const { data, error } = await db
    .from("engine_sessions")
    .update({
      status: "closed",
      close_reason: reason,
      session_stopped_at: ahora,
      updated_at: ahora,
    })
    .eq("id", sessionId)
    .eq("status", "closing")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`No se pudo cerrar la sesion: ${error.message}`);
  const sesion = (data as EngineSession | null) ?? null;
  if (!sesion) return null; // ya cerrada u otra transicion: sin efecto.

  const pnl = await calcularPnlPorRango(db, sesion);
  const { data: actualizada, error: errorPnl } = await db
    .from("engine_sessions")
    .update({ pnl_total: pnl })
    .eq("id", sessionId)
    .select("*")
    .single();
  if (errorPnl) throw new Error(`No se pudo guardar el pnl de la sesion: ${errorPnl.message}`);
  return (actualizada as EngineSession) ?? sesion;
}

/**
 * P&L de la sesion: suma bot_executions.pnl cuyo created_at cae dentro de
 * [session_started_at, session_stopped_at]. PostgREST no expone SUM, asi que se
 * leen los pnl del rango y se suman aqui con resumenPnl (redondeo a 2 decimales).
 */
export async function calcularPnlPorRango(
  db: Db,
  sesion: Pick<EngineSession, "id" | "session_started_at" | "session_stopped_at">,
): Promise<number> {
  if (!sesion.session_stopped_at) return 0;
  const { data, error } = await db
    .from("bot_executions")
    .select("pnl")
    .gte("created_at", sesion.session_started_at)
    .lte("created_at", sesion.session_stopped_at);
  if (error)
    throw new Error(`No se pudo calcular el pnl de la sesion ${sesion.id}: ${error.message}`);
  return resumenPnl((data ?? []).map((fila) => Number((fila as { pnl: number }).pnl)));
}

/**
 * Historial de sesiones para la pestana Motor: de mas reciente a mas antigua.
 * Solo service_role puede leer la tabla, asi que esto se expone via server fn.
 */
export async function listarSesiones(db: Db, limit = 50): Promise<EngineSession[]> {
  const { data, error } = await db
    .from("engine_sessions")
    .select("*")
    .order("session_started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`No se pudieron listar las sesiones: ${error.message}`);
  return (data ?? []) as EngineSession[];
}

/**
 * true si la ultima ejecucion real del bot es una entrada (buy) sin salida
 * posterior. Excluye `simulated`: en demo cada ciclo entra y sale en el mismo
 * tick, asi que una compra simulada no es una posicion abierta.
 */
export async function botTienePosicionAbierta(
  db: Db,
  bot: { id: string; pair: string },
): Promise<boolean> {
  const { data, error } = await db
    .from("bot_executions")
    .select("side")
    .eq("bot_id", bot.id)
    .eq("symbol", bot.pair)
    .in("status", ["filled", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new Error(`No se pudo comprobar la posicion del bot ${bot.id}: ${error.message}`);
  return (data as { side?: string } | null)?.side === "buy";
}

/**
 * Posiciones abiertas entre los bots que el motor sigue gestionando
 * (status='running' y automation_enabled): un bot detenido ya no gestiona
 * TP/SL, asi que contarlo dejaria la sesion en 'closing' para siempre. El
 * cierre de la sesion exige 0 aqui.
 */
export async function contarPosicionesAbiertas(db: Db): Promise<number> {
  const { data: bots, error } = await db
    .from("bots")
    .select("id, pair")
    .eq("status", "running")
    .eq("automation_enabled", true);
  if (error) throw new Error(`No se pudieron leer los bots del cierre: ${error.message}`);
  let abiertas = 0;
  for (const bot of bots ?? []) {
    const fila = bot as { id: string; pair: string };
    if (await botTienePosicionAbierta(db, fila)) abiertas++;
  }
  return abiertas;
}

/**
 * Best-effort: registra este tick en la sesion (contadores + last_tick_at).
 * Los deltas se aplican sobre los valores leidos al empezar el tick; con dos
 * ticks simultaneos (cron + manual) puede perderse un incremento, aceptable
 * para estadisticas de historial.
 */
export async function registrarTickSesion(
  db: Db,
  sesion: Pick<EngineSession, "id" | "runs_count" | "orders_count" | "errors_count">,
  stats: { runsDelta: number; ordersDelta: number; errorsDelta: number },
): Promise<void> {
  const ahora = new Date().toISOString();
  const { error } = await db
    .from("engine_sessions")
    .update({
      runs_count: sesion.runs_count + stats.runsDelta,
      orders_count: sesion.orders_count + stats.ordersDelta,
      errors_count: sesion.errors_count + stats.errorsDelta,
      last_tick_at: ahora,
      updated_at: ahora,
    })
    .eq("id", sesion.id);
  if (error) throw new Error(`No se pudo registrar el tick en la sesion: ${error.message}`);
}

/**
 * Regla de apertura del tick (Fase 1):
 *  - engine_enabled apagado nunca abre.
 *  - Sin tabla de sesiones (migracion pendiente) decide solo engine_enabled,
 *    para no romper el motor que ya existia.
 *  - Con sesiones, solo la sesion 'active' abre; 'closing' (corte de timer,
 *    Detener o Kill Switch) y 'closed' inhiben posiciones nuevas.
 */
export function aperturasPermitidas(args: {
  engineEnabled: boolean;
  sesion: Pick<EngineSession, "status"> | null;
  sesionesOk: boolean;
}): boolean {
  if (!args.engineEnabled) return false;
  if (!args.sesionesOk) return true;
  return args.sesion?.status === "active";
}
