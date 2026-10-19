/**
 * Estado del registro publico de usuarios.
 *
 * POR QUE
 * Mientras el multiusuario no este probado, el registro abierto es un
 * riesgo: cualquiera que se registre entra en la app (aunque las server
 * functions le negaran casi todo, y las politicas RLS lo separan, mejor no
 * invites a desconocidos). El dueno quiere abrirlo mas adelante, cuando el
 * modelo de alta de familiares este decidido.
 *
 * El control de verdad esta en Supabase Auth (Authentication -> Sign-ups):
 * si esta apagado ahi, NADIE puede registrarse, aunque la app muestre el
 * boton. Este modulo es la parte de la app: oculta el boton y explica por
 * que, para no dar la impression de que el registro funciona cuando no.
 *
 * Como se decide:
 *  1. app_settings con la clave "public_signup_enabled" (lo puede cambiar
 *     el administrador desde la app o desde el SQL Editor).
 *  2. La variable de entorno PUBLIC_SIGNUP=true la abre sin tocar la base.
 *  3. Si no hay ninguna de las dos: registro CERRADO (por defecto).
 */

import { createServerFn } from "@tanstack/react-start";

import { publico } from "@/integrations/supabase/public-middleware";

export type EstadoRegistro = {
  /** true si se puede crear una cuenta desde la app. */
  permitido: boolean;
  /** Por que esta abierto o cerrado (para explicarlo en la pantalla). */
  motivo: string;
};

/** Clave en app_settings que abre el registro. */
export const CLAVE_APP_SETTINGS = "public_signup_enabled";

/** Consulta publica (sin sesion): la pagina de acceso la necesita. */
export const estadoRegistroPublico = createServerFn({ method: "POST" })
  .middleware([publico])
  .handler(async () => {
    const env = process.env["PUBLIC_SIGNUP"];
    if (env === "true") {
      return { permitido: true, motivo: "Registro abierto por PUBLIC_SIGNUP=true." };
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .eq("key", CLAVE_APP_SETTINGS)
        .maybeSingle();
      const valor = String((data as { value?: string } | null)?.value ?? "").toLowerCase();
      if (valor === "true" || valor === "1" || valor === "si" || valor === "yes") {
        return {
          permitido: true,
          motivo: `Registro abierto por app_settings.${CLAVE_APP_SETTINGS}.`,
        };
      }
    } catch {
      // Sin base de datos (build, entorno sin Supabase): se mantiene cerrado.
    }

    return {
      permitido: false,
      motivo:
        "El registro esta cerrado: la app es de uso personal y el multiusuario todavia no esta probado. El administrador puede abrirlo cuando quiera.",
    };
  });
