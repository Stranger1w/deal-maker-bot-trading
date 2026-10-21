/**
 * ENVIO DE CORREO (opcional, pero es lo que pide el dueno: los avisos del
 * motor en su Gmail).
 *
 * PROVEEDOR: Resend (resend.com). Gratis hasta 3000 correos al mes y, sin
 * dominio propio, permite enviar a CUALQUIER destinatario (el remitente sale
 * como "onboarding@resend.dev"). Se activa poniendo la clave en el entorno:
 *
 *   RESEND_API_KEY   re_xxxxxxxx   (la das en resend.com -> API keys)
 *   RESEND_FROM      opcional: "Deal Maker <tucorreo@midominio.com>"
 *
 * SIN la clave, esto NO hace nada: la app sigue funcionando y los avisos se
 * quedan dentro de la app. Nunca lanza: un fallo de correo no puede tumbar
 * el motor.
 */

import { logEstructurado } from "./log.server";

/** true si hay proveedor de correo configurado. */
export function hayProveedorCorreo(): boolean {
  return Boolean(process.env["RESEND_API_KEY"]);
}

/** El remitente: el que se haya puesto, o el de prueba de Resend. */
function remitente(): string {
  return process.env["RESEND_FROM"] ?? "Deal Maker <onboarding@resend.dev>";
}

export type ResultadoEnvio = {
  ok: boolean;
  /** Por que no se envio (para que la app lo diga). */
  motivo: string | null;
};

/**
 * Envia un correo. Nunca lanza: devuelve si se ha enviado o no.
 */
export async function enviarEmail(
  destinatario: string,
  asunto: string,
  cuerpo: string,
): Promise<ResultadoEnvio> {
  const clave = process.env["RESEND_API_KEY"];
  const destino = (destinatario ?? "").trim();
  if (!clave) {
    return {
      ok: false,
      motivo: "No hay proveedor de correo configurado (falta RESEND_API_KEY).",
    };
  }
  if (!destino.includes("@")) {
    return { ok: false, motivo: "El destinatario no es un correo valido." };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${clave}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: remitente(),
        to: [destino],
        subject: asunto,
        text: cuerpo,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detalle = (await res.text().catch(() => "")).slice(0, 300);
      logEstructurado("email.error", { destino, status: res.status, detalle }, "aviso");
      return { ok: false, motivo: `El proveedor rechazo el envio (${res.status}).` };
    }
    logEstructurado("email.enviado", { destino, asunto });
    return { ok: true, motivo: null };
  } catch (error) {
    logEstructurado(
      "email.error",
      {
        destino,
        error: error instanceof Error ? error.message : "error desconocido",
      },
      "aviso",
    );
    return { ok: false, motivo: "No se pudo contactar con el proveedor de correo." };
  }
}

/**
 * Cuerpo de un aviso del motor, en texto plano.
 */
export function cuerpoAviso(titulo: string, mensaje: string, extra?: string): string {
  return [
    `Deal Maker: ${titulo}`,
    "",
    mensaje,
    ...(extra ? ["", extra] : []),
    "",
    "Para cambiar o desactivar estos avisos: Deal Maker > Seguridad > Notificaciones por correo.",
  ].join("\n");
}
