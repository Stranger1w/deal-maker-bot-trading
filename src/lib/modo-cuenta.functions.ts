/**
 * CAMBIAR EL MODO GLOBAL (DEMO <-> REAL).
 *
 * QUE ES Y QUE NO ES
 * Este interruptor NO enciende el trading real por su cuenta. Para pasar a
 * REAL hacen falta las DOS banderas de software (allow_real_trading y
 * allow_live_orders) y las credenciales de Binance verificadas. Si faltan,
 * el cambio se RECHAZA con un mensaje claro: es mejor que el interruptor
 * parezca que funciona y no haga nada.
 *
 * Con las banderas puestas, el cambio:
 *   - pone engine_config.account_mode a "demo" o "real",
 *   - pasa TODOS los bots del dueno al mismo modo,
 *   - y lo deja anotado en la auditoria.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Anota el cambio en el diario de auditoria. */
async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown>,
  userId: string | null = null,
) {
  const db = await admin();
  await db.from("audit_events").insert({
    action,
    entity,
    entity_id: entityId,
    details: details as never,
    user_id: userId,
  } as never);
}

/** El modo actual y si se puede pasar a real. */
export const leerModoCuenta = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
    const { data } = await db
      .from("engine_config")
      .select("account_mode")
      .eq("user_id", plataforma?.adminId ?? context.userId)
      .limit(1);
    const modo = ((data ?? [])[0]?.account_mode ?? "demo") as "demo" | "real";
    return {
      modo,
      realPermitido: settings?.allow_real_trading === true && settings?.allow_live_orders === true,
    };
  });

export const cambiarModoCuenta = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({ modo: z.enum(["demo", "real"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const settings = plataforma?.fila ?? null;
    if (!settings) throw new Error("No hay configuración del motor.");

    const avisos: string[] = [];

    if (data.modo === "real") {
      // 1) Las dos banderas de software.
      if (settings.allow_real_trading !== true || settings.allow_live_orders !== true) {
        throw new Error(
          "El trading real está apagado por software (allow_real_trading y allow_live_orders). Pídeme que lo encienda y este interruptor pasa a REAL.",
        );
      }
      // 2) Credenciales verificadas del administrador de la plataforma.
      const creds = plataforma?.adminId
        ? await db
            .from("binance_credentials")
            .select("connection_status")
            .eq("user_id", plataforma.adminId)
        : { data: [] as { connection_status: string }[] };
      if (!(creds.data ?? []).some((c) => c.connection_status === "ok")) {
        throw new Error(
          "Configura y verifica tus API Keys de Binance antes de operar con dinero real.",
        );
      }
    }

    const ahora = new Date().toISOString();

    // La configuracion de la plataforma (una fila por usuario, id = user_id).
    const { data: cfg } = await db
      .from("engine_config")
      .select("id, user_id")
      .eq("user_id", plataforma?.adminId ?? context.userId)
      .limit(1);
    const fila = (cfg ?? [])[0];
    if (fila) {
      const { error } = await db
        .from("engine_config")
        .update({ account_mode: data.modo, updated_at: ahora })
        .eq("id", fila.id);
      if (error) throw new Error(error.message);
    } else {
      avisos.push("No hay fila de configuración del motor: se creará al guardar la config.");
    }

    // Todos los bots del dueno al mismo modo.
    const { data: bots, error: errorBots } = await db
      .from("bots")
      .update({ mode: data.modo })
      .eq("user_id", context.userId)
      .select("id");
    if (errorBots) throw new Error(errorBots.message);

    await audit(
      "engine.modo_cambiado",
      "engine_config",
      fila?.id ?? null,
      {
        modo: data.modo,
        bots: (bots ?? []).length,
      },
      context.userId,
    );

    return {
      ok: true,
      modo: data.modo,
      bots: (bots ?? []).length,
      avisos: avisos.join(" "),
    };
  });
