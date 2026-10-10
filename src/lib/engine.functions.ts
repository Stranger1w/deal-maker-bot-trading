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
    const { data: settings } = await db
      .from("automation_settings")
      .select("id, kill_switch")
      .limit(1)
      .maybeSingle();
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
      sesion = await iniciarSesion(db, { mode: data.mode, session_ends_at: sessionEndsAt });
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
    const { data: settings } = await db
      .from("automation_settings")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!settings) throw new Error("No hay configuración del motor");

    const { obtenerSesionActiva, marcarSesionParaCierre, cerrarSesion, contarPosicionesAbiertas } =
      await import("./engine-sessions.server");

    let sesion: EngineSession | null = null;
    let posicionesAbiertas = 0;
    try {
      const activa = await obtenerSesionActiva(db);
      if (activa) {
        await marcarSesionParaCierre(db, activa.id, "manual");
        posicionesAbiertas = await contarPosicionesAbiertas(db);
        sesion =
          posicionesAbiertas === 0
            ? await cerrarSesion(db, activa.id, "manual")
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
      .eq("id", settings.id);
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
  .handler(async ({ data }) => {
    const db = await admin();
    const { listarSesiones } = await import("./engine-sessions.server");
    try {
      return await listarSesiones(db, data.limit);
    } catch (e) {
      throw errorSesion(e instanceof Error ? e.message : String(e));
    }
  });
