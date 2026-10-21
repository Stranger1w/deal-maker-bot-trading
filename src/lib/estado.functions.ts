// Funciones de servidor del "estado de la app": que migraciones faltan y
// si el motor tiene todo lo que necesita para operar.
//
// Es una lectura: no escribe nada en la base.
//
// Puede llamarla cualquier usuario con sesion: cada uno ve SU configuracion
// (la fila de engine_config y la sesion de motor de su user_id) y el estado
// del esquema, que no es información privada de nadie.

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Comprobacion de las migraciones pendientes y de la configuracion que el
 * motor necesita (indicadores, secreto del cron, sesion abierta).
 */
export const estadoApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const { comprobarMigraciones } = await import("./estado.server");
    const { leerSecretoCron } = await import("./cron.server");
    const { obtenerSesionActiva } = await import("./engine-sessions.server");

    // El comprobador de esquema usa nombres dinamicos (columnas que puede que
    // no existan), asi que el cliente tipado se le pasa por su forma minima.
    const migraciones = await comprobarMigraciones(
      db as unknown as Parameters<typeof comprobarMigraciones>[0],
    );

    // La fila de configuracion y la sesion son las DE ESTE USUARIO (una por
    // usuario): nunca la de otro.
    const userId = context.userId;

    // Indicadores configurados: sin ellos el motor no abre posiciones.
    const { data: cfg, error: errorCfg } = await db
      .from("engine_config")
      .select("indicator_ids, horizon_minutes, amount_per_trade")
      .eq("user_id", userId)
      .limit(1);
    const filaCfg = (cfg ?? []) as {
      indicator_ids?: string[] | null;
      horizon_minutes?: number | null;
      amount_per_trade?: number | null;
    }[];
    const indicadores = filaCfg[0]?.indicator_ids ?? [];
    const tieneConfig = !errorCfg && filaCfg.length > 0 && indicadores.length > 0;

    // Sesion viva del motor (la de este usuario).
    let sesion: { id: string; status: string; session_ends_at: string | null } | null = null;
    try {
      const viva = await obtenerSesionActiva(db, userId);
      sesion = viva
        ? {
            id: viva.id,
            status: viva.status,
            session_ends_at: viva.session_ends_at ?? null,
          }
        : null;
    } catch {
      sesion = null;
    }

    // Las notificaciones por correo: si estan activadas y a donde van.
    let notificaciones = { activo: false, destino: null as string | null };
    try {
      const { leerAjustesPlataforma } = await import("./propietario.server");
      const plataforma = await leerAjustesPlataforma(db);
      const fila = plataforma?.fila ?? null;
      notificaciones = {
        activo: fila?.notify_email_enabled === true,
        destino: fila?.notify_email ?? null,
      };
    } catch {
      notificaciones = { activo: false, destino: null };
    }

    const secreto = await leerSecretoCron(db);

    const pendientes = migraciones.filter((m) => !m.aplicada);

    return {
      migraciones,
      pendientes: pendientes.length,
      todoAplicado: pendientes.length === 0,
      notificaciones,
      motor: {
        indicadores,
        tieneConfig,
        indicadoresAviso: tieneConfig
          ? null
          : "Sin indicadores configurados el motor no abre posiciones (es a proposito).",
        sesionActiva: !!sesion,
        sesion,
        cronConfigurado: !!secreto,
      },
    };
  });
