/**
 * NOTIFICACIONES POR CORREO: activarlas, desactivarlas y a donde van.
 *
 * QUE PIDE EL DUENO
 * "Que el correo con el que cree la cuenta me diga si quiero activar y
 * desactivar las notificaciones, y que las mande al correo que use para crear
 * esa cuenta."
 *
 * COMO FUNCIONA
 *  - El correo de destino por defecto es el de la CUENTA (el de Supabase
 *    Auth): no hay que escribirlo a mano.
 *  - El interruptor guarda dos cosas: el correo de destino y si esta
 *    activado o no. Desactivado, no se manda NADA (ni alertas ni reportes).
 *  - Sin proveedor de correo configurado (RESEND_API_KEY), la app lo dice:
 *    el interruptor se puede guardar, pero no sale correo hasta que se
 *    configure el proveedor.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** El correo de la cuenta con la que estas dentro (Supabase Auth). */
export async function correoDeLaCuenta(context: {
  supabase: { auth: { getUser: () => Promise<{ data: { user: { email?: string } | null } }> } };
}): Promise<string | null> {
  try {
    const { data } = await context.supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

/** Estado actual: el correo de la cuenta, el de destino y si esta activo. */
export const leerNotificacionesCorreo = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { hayProveedorCorreo } = await import("./email.server");
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const ajustes = plataforma?.fila ?? null;
    const correoCuenta = await correoDeLaCuenta(context);
    return {
      correoCuenta,
      correoDestino: ajustes?.notify_email ?? correoCuenta ?? "",
      activo: ajustes?.notify_email_enabled === true,
      hayProveedor: hayProveedorCorreo(),
    };
  });

/**
 * Activa o desactiva las notificaciones por correo.
 *
 * Si no se pasa un correo, se usa el de la cuenta (que es lo que se ha
 * pedido). Si se pasa, ese es al que se manda.
 */
export const configurarNotificacionesCorreo = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        activo: z.boolean(),
        correo: z.string().email().or(z.literal("")).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const ajustes = plataforma?.fila ?? null;
    if (!ajustes) throw new Error("No hay configuracion del motor.");

    const correoCuenta = await correoDeLaCuenta(context);
    const destino = (data.correo ?? "").trim() || correoCuenta || "";
    if (data.activo && !destino.includes("@")) {
      throw new Error(
        "No hay ningun correo al que mandar los avisos: el de la cuenta no aparece (comprueba que te has apuntado con correo) o escribe uno.",
      );
    }

    const { error } = await db
      .from("automation_settings")
      .update({
        notify_email: destino || null,
        notify_email_enabled: data.activo && destino.includes("@"),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ajustes.id as string);
    if (error) throw new Error(error.message);

    return {
      ok: true,
      correoDestino: destino,
      activo: data.activo && destino.includes("@"),
    };
  });

/** Manda un correo de prueba al destino configurado. */
export const enviarCorreoPrueba = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { enviarEmail, hayProveedorCorreo, cuerpoAviso } = await import("./email.server");
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const plataforma = await leerAjustesPlataforma(db);
    const ajustes = plataforma?.fila ?? null;
    const correoCuenta = await correoDeLaCuenta(context);
    const destino = ajustes?.notify_email ?? correoCuenta ?? "";
    if (!destino.includes("@")) {
      throw new Error("No hay ningun correo configurado al que mandar la prueba.");
    }
    if (!hayProveedorCorreo()) {
      throw new Error(
        "No hay proveedor de correo configurado en el servidor (falta RESEND_API_KEY): el aviso se queda dentro de la app hasta que lo pongas.",
      );
    }
    const resultado = await enviarEmail(
      destino,
      "Deal Maker: correo de prueba",
      cuerpoAviso(
        "Esto es una prueba",
        "Si has leido esto, los avisos del motor te van a llegar a esta direccion.",
        `Destino: ${destino}`,
      ),
    );
    if (!resultado.ok) throw new Error(resultado.motivo ?? "No se pudo enviar el correo.");
    return { ok: true, destino };
  });
