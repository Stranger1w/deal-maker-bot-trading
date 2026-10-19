// Funciones de servidor de las sesiones del motor (pestana Motor).
//
// Regla Fase 1: engine_enabled SOLO se escribe aqui, desde los botones
// Iniciar/Detener. Nada toca allow_real_trading, allow_live_orders ni
// app_settings.binance_trading_env (el Kill Switch, por seguridad, sigue
// pudiendo apagar el motor desde risk.functions).
//
// La tabla engine_sessions solo es legible por service_role, asi que la UI
// pasa siempre por estas funciones; nunca consulta la tabla desde el navegador.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

import type { EngineSession } from "./engine-sessions.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(
  action: string,
  details: Record<string, unknown>,
  userId: string | null = null,
) {
  const db = await admin();
  // types.ts aun no incluye audit_events.user_id (columna anadida a mano): cast.
  await db.from("audit_events").insert({
    action,
    entity: "automation",
    entity_id: null,
    details: details as never,
    actor: "operator",
    user_id: userId,
  } as never);
}

/** Si falta la migracion de sesiones, el aviso dice exactamente que pegar. */
function errorSesion(mensaje: string): Error {
  const faltaTabla =
    /engine_sessions/.test(mensaje) && /does not exist|relation|42P01/i.test(mensaje);
  return faltaTabla
    ? new Error(
        "Falta la migración de sesiones del motor (20261005000000_engine_sessions.sql): pégala en el SQL Editor de Supabase y vuelve a intentarlo.",
      )
    : new Error(mensaje);
}

/**
 * Inicia una sesion del motor y enciende engine_enabled.
 *  - timer: exige durationMinutes y guarda session_ends_at calculado con el
 *    reloj del servidor (no con el del navegador).
 *  - 24x7: session_ends_at queda en null.
 * Si ya hay una sesion active/closing (indice unico), se devuelve la existente
 * sin duplicar (iniciarSesion gestiona el 23505).
 */
export const iniciarMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        mode: z.enum(["timer", "24x7"]),
        durationMinutes: z.number().int().min(1).max(10080).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    // La configuracion global del motor es la del ADMINISTRADOR (una fila por
    // usuario). Leer con .limit(1) devolvia una fila arbitraria: con mas de
    // un usuario, el admin encendia el motor en la fila de otro.
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
    if (!settings) throw new Error("No hay configuración del motor");
    if (settings.kill_switch)
      throw new Error("El Kill Switch está activo: desactícalo antes de iniciar una sesión.");

    const minutos = data.durationMinutes;
    if (data.mode === "timer" && minutos === undefined)
      throw new Error("El modo Temporizador requiere una duración en minutos.");
    const sessionEndsAt =
      data.mode === "timer" && minutos !== undefined
        ? new Date(Date.now() + minutos * 60_000).toISOString()
        : null;

    const { iniciarSesion } = await import("./engine-sessions.server");
    let sesion: EngineSession;
    try {
      // La sesion es del usuario que la abre (engine_sessions.user_id es
      // NOT NULL): el indice unico parcial es por usuario.
      sesion = await iniciarSesion(db, {
        mode: data.mode,
        session_ends_at: sessionEndsAt,
        user_id: context.userId,
      });
    } catch (e) {
      throw errorSesion(e instanceof Error ? e.message : String(e));
    }

    const { error } = await db
      .from("automation_settings")
      .update({
        engine_enabled: true,
        engine_status: "running",
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    if (error) throw new Error(error.message);

    await audit(
      "engine.session_started",
      { session_id: sesion.id, mode: data.mode, session_ends_at: sessionEndsAt },
      context.userId,
    );
    return sesion;
  });

/**
 * Detiene el motor (manual): engine_enabled a false y la sesion pasa a
 * 'closing' con motivo 'manual'. Si no quedan posiciones abiertas se cierra
 * ya mismo; si quedan, el tick sigue hasta que se pongan planas y entonces
 * cierra la sesion (el motor permanece apagado mientras tanto: el tick solo
 * gestiona TP/SL de lo abierto, sin abrir nada nuevo).
 */
export const detenerMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    // Misma fila que usa el tick: la del administrador (no una arbitraria).
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
    if (!settings) throw new Error("No hay configuración del motor");

    const { obtenerSesionActiva, marcarSesionParaCierre, cerrarSesion, contarPosicionesAbiertas } =
      await import("./engine-sessions.server");
    // Ambito de la sesion: el del dueno de la fila de configuracion.
    const duenoSesion = plataforma?.adminId ?? null;

    let sesion: EngineSession | null = null;
    let posicionesAbiertas = 0;
    try {
      const activa = await obtenerSesionActiva(db, duenoSesion);
      if (activa) {
        await marcarSesionParaCierre(db, activa.id, "manual");
        posicionesAbiertas = await contarPosicionesAbiertas(db, duenoSesion);
        sesion =
          posicionesAbiertas === 0
            ? await cerrarSesion(db, activa.id, "manual", duenoSesion)
            : { ...activa, status: "closing", close_reason: "manual" };
      }
    } catch (e) {
      // Sin tabla de sesiones (migracion pendiente): el motor se apaga igual.
      // Cualquier otro fallo se propaga: mejor fallar en alto que dejar la
      // sesion activa con el motor apagado.
      const mensaje = e instanceof Error ? e.message : String(e);
      if (!/engine_sessions/.test(mensaje)) throw e;
    }

    // engine_enabled SOLO se modifica aqui (y en iniciarMotor).
    const { error } = await db
      .from("automation_settings")
      .update({
        engine_enabled: false,
        engine_status: "stopped",
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id as string);
    if (error) throw new Error(error.message);

    await audit(
      "engine.session_stopped",
      {
        session_id: sesion?.id ?? null,
        posiciones_abiertas: posicionesAbiertas,
        cierre_pendiente: posicionesAbiertas > 0,
      },
      context.userId,
    );
    return { sesion, posicionesAbiertas, cierrePendiente: posicionesAbiertas > 0 };
  });

/** Historial de sesiones (la mas reciente primero) para la tabla del Motor. */
export const listarSesionesMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { listarSesiones } = await import("./engine-sessions.server");
    try {
      // Solo las sesiones del usuario que pregunta (cada usuario tiene las
      // suyas: el indice de sesion viva es por usuario).
      return await listarSesiones(db, data.limit, context.userId);
    } catch (e) {
      throw errorSesion(e instanceof Error ? e.message : String(e));
    }
  });

/* ------------------------- CONFIGURACION DEL MOTOR ------------------------ */

/**
 * Configuracion de indicadores, estrategia y horizonte del motor.
 *
 * Sin esta fila el motor NO abre posiciones: la señal sale de los
 * indicadores y, sin indicadores elegidos, no hay señal. Por eso la UI
 * tiene que poder guardarla (antes no habia ninguna forma: engine_config
 * se quedaba vacia).
 */
export type ConfigMotor = {
  indicator_ids: string[];
  indicator_params: Record<string, Record<string, number>>;
  strategy_id: string;
  horizon_minutes: number;
  amount_per_trade: number;
  /** true si la fila todavia no existe en la base. */
  sinFila: boolean;
};

const CONFIG_POR_DEFECTO: Omit<ConfigMotor, "sinFila"> = {
  indicator_ids: ["close_price"],
  indicator_params: {},
  strategy_id: "fixed",
  horizon_minutes: 15,
  amount_per_trade: 20,
};

/** Lee la configuracion del motor de la plataforma (fila del administrador). */
export const leerConfigMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const adminId = plataforma?.adminId ?? context.userId;
    const { data, error } = await db
      .from("engine_config" as never)
      .select(
        "id, indicator_ids, indicator_params, strategy_id, horizon_minutes, amount_per_trade" as never,
      )
      .eq("user_id" as never, adminId as never)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ...CONFIG_POR_DEFECTO, sinFila: true };
    const fila = data as {
      indicator_ids?: string[] | null;
      indicator_params?: unknown;
      strategy_id?: string | null;
      horizon_minutes?: number | null;
      amount_per_trade?: number | null;
    };
    return {
      indicator_ids: fila.indicator_ids ?? CONFIG_POR_DEFECTO.indicator_ids,
      indicator_params:
        fila.indicator_params && typeof fila.indicator_params === "object"
          ? (fila.indicator_params as Record<string, Record<string, number>>)
          : {},
      strategy_id: fila.strategy_id ?? CONFIG_POR_DEFECTO.strategy_id,
      horizon_minutes: Number(fila.horizon_minutes ?? CONFIG_POR_DEFECTO.horizon_minutes),
      amount_per_trade: Number(fila.amount_per_trade ?? CONFIG_POR_DEFECTO.amount_per_trade),
      sinFila: false,
    };
  });

/** Guarda la configuracion del motor (indicadores, estrategia, horizonte). */
export const guardarConfigMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        indicatorIds: z.array(z.string().min(1)).min(1),
        indicatorParams: z.record(z.string(), z.record(z.string(), z.number())).optional(),
        strategyId: z.enum(["fixed", "conservative", "optimal", "aggressive"]),
        horizonMinutes: z.union([z.literal(1), z.literal(5), z.literal(15)]),
        amountPerTrade: z.number().positive().max(100000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const adminId = plataforma?.adminId ?? context.userId;

    // Los ids tienen que existir en el registro de indicadores.
    const { idsValidos } = await import("./indicators");
    const validos = new Set(idsValidos());
    const desconocida = data.indicatorIds.find((id) => !validos.has(id));
    if (desconocida) throw new Error(`Indicador desconocido: ${desconocida}`);

    const ahora = new Date().toISOString();
    const { data: actual } = await db
      .from("engine_config" as never)
      .select("id, account_mode, execution_mode, auto_symbol_min_volume" as never)
      .eq("user_id" as never, adminId as never)
      .limit(1)
      .maybeSingle();
    const fila = actual as {
      id?: string;
      account_mode?: string;
      execution_mode?: string;
      auto_symbol_min_volume?: number;
    } | null;

    const { error } = await db.from("engine_config" as never).upsert(
      {
        // id = user_id::text (regla de la Fase 2): una fila de configuracion
        // por usuario, con su unica clave de conflicto en user_id.
        id: fila?.id ?? adminId,
        user_id: adminId,
        account_mode: fila?.account_mode ?? "demo",
        execution_mode: fila?.execution_mode ?? "24x7",
        amount_per_trade: data.amountPerTrade,
        horizon_minutes: data.horizonMinutes,
        indicator_ids: data.indicatorIds,
        indicator_params: data.indicatorParams ?? {},
        strategy_id: data.strategyId,
        auto_symbol_min_volume: fila?.auto_symbol_min_volume ?? 500000,
        updated_at: ahora,
      } as never,
      { onConflict: "user_id" } as never,
    );
    if (error) throw new Error(error.message);

    await audit(
      "engine.config_updated",
      {
        indicator_ids: data.indicatorIds,
        strategy_id: data.strategyId,
        horizon_minutes: data.horizonMinutes,
        amount_per_trade: data.amountPerTrade,
      },
      context.userId,
    );
    return { ok: true };
  });
