/**
 * Notificaciones externas del motor (Telegram). OPCIONAL.
 *
 * POR QUE ES OPCIONAL
 * El motor tiene que funcionar 24/7 aunque el servidor no tenga internet,
 * o aunque el bot de Telegram no este configurado. Por eso esto NUNCA
 * lanza: si no hay token, no hace nada; si falla el envio, queda en el log
 * y el ciclo sigue.
 *
 * COMO SE ACTIVA
 *   TELEGRAM_BOT_TOKEN   token del bot (lo da @BotFather)
 *   TELEGRAM_CHAT_ID     id del chat o canal (empieza por - para grupos)
 * Se pueden poner en el fichero de secretos (deal-maker.env) o en el
 * entorno del cron. Sin ellos, el motor funciona igual, solo que los avisos
 * se quedan en la app y en el log estructurado.
 *
 * El aviso de RIESGO (limites alcanzados, kill switch, orden rechazada) si
 * que es importante que salga de la app: el motor puede estar en un cron
 * que nadie mira.
 */

import { logEstructurado } from "./log.server";

export type NivelNotificacion = "info" | "aviso" | "critico";

/** true si hay Telegram configurado. */
export function hayTelegram(): boolean {
  return Boolean(process.env["TELEGRAM_BOT_TOKEN"] && process.env["TELEGRAM_CHAT_ID"]);
}

/**
 * Envia un aviso por Telegram si esta configurado.
 *
 * Nunca lanza: un fallo de red o un token malo no pueden tumbar el motor.
 */
export async function notificar(
  nivel: NivelNotificacion,
  titulo: string,
  mensaje: string,
): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return false;

  const icono = nivel === "critico" ? "🚨" : nivel === "aviso" ? "⚠️" : "ℹ️";
  const texto = `${icono} *${titulo}*\n${mensaje}`.slice(0, 4000);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logEstructurado("telegram.error", { nivel, titulo, status: res.status }, "aviso");
      return false;
    }
    logEstructurado("telegram.enviado", { nivel, titulo });
    return true;
  } catch (error) {
    // Sin internet, token caducado, timeout... el motor sigue.
    logEstructurado(
      "telegram.error",
      {
        nivel,
        titulo,
        error: error instanceof Error ? error.message : "error desconocido",
      },
      "aviso",
    );
    return false;
  }
}
