// Funciones de servidor del "estado de la app": que migraciones faltan y
// si el motor tiene todo lo que necesita para operar.
//
// Es una lectura: no escribe nada en la base.

import { createServerFn } from "@tanstack/react-start";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Comprobacion de las migraciones pendientes y de la configuracion que el
 * motor necesita (indicadores, secreto del cron, sesion abierta).
 */
export const estadoApp = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { comprobarMigraciones } = await import("./estado.server");
    const { leerSecretoCron } = await import("./cron.server");
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const { obtenerSesionActiva } = await import("./engine-sessions.server");

    // El comprobador de esquema usa nombres dinamicos (columnas que puede que
    // no existan), asi que el cliente tipado se le pasa por su forma minima.
    const migraciones = await comprobarMigraciones(
      db as unknown as Parameters<typeof comprobarMigraciones>[0],
    );

    // La fila de configuracion es la del ADMINISTRADOR (una por usuario).
    const plataforma = await leerAjustesPlataforma(db);
    const adminId = plataforma?.adminId ?? context.userId;

    // Indicadores configurados: sin ellos el motor no abre posiciones.
    const { data: cfg, error: errorCfg } = await db
      .from("engine_config")
      .select("indicator_ids, horizon_minutes, amount_per_trade")
      .eq("user_id", adminId)
      .limit(1);
    const filaCfg = (cfg ?? []) as {
      indicator_ids?: string[] | null;
      horizon_minutes?: number | null;
      amount_per_trade?: number | null;
    }[];
    const indicadores = filaCfg[0]?.indicator_ids ?? [];
    const tieneConfig = !errorCfg && filaCfg.length > 0 && indicadores.length > 0;

    // Sesion viva del motor (la del administrador).
    let sesion: { id: string; status: string; session_ends_at: string | null } | null = null;
    try {
      const viva = await obtenerSesionActiva(db, adminId);
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

    const secreto = await leerSecretoCron(db);

    const pendientes = migraciones.filter((m) => !m.aplicada);

    return {
      migraciones,
      pendientes: pendientes.length,
      todoAplicado: pendientes.length === 0,
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
