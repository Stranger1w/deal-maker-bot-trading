/**
 * Logs estructurados del motor (una linea JSON por evento).
 *
 * QUE PARA
 * En local, un bot_logs en la base no dice nada de un tick que fallo, de un
 * ciclo que tardo 40 s o de una orden que se rechazo. Cuando el motor corre
 * en un cron de la nube, la unica forma de ver lo que pasa es la SALIDA
 * del proceso: por eso cada evento relevante se escribe como una linea
 * JSON (facil de grep y de parsear).
 *
 * No se escriben secretos: las credenciales nunca llegan aqui.
 */

export type NivelLog = "debug" | "info" | "aviso" | "error";

/** Niveles que se emiten (los de debug se pueden silenciar con LOG_MINIMO). */
const NIVELES: Record<NivelLog, number> = { debug: 10, info: 20, aviso: 30, error: 40 };

function nivelMinimo(): number {
  const crudo = (process.env["LOG_MINIMO"] ?? "info").toLowerCase();
  return NIVELES[crudo as NivelLog] ?? NIVELES.info;
}

/**
 * Emite un evento estructurado por stdout.
 *
 * @param evento nombre corto y estable del evento (p.ej. "tick.inicio")
 * @param datos datos del evento (sin secretos)
 */
export function logEstructurado(
  evento: string,
  datos: Record<string, unknown> = {},
  nivel: NivelLog = "info",
): void {
  if (NIVELES[nivel] < nivelMinimo()) return;
  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    evento,
    ...datos,
  });
  if (nivel === "error") console.error(linea);
  else if (nivel === "aviso") console.warn(linea);
  else console.log(linea);
}
