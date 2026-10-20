/**
 * Secreto del cron (server-only).
 *
 * QUE PROBLEMA RESUELVE
 * El endpoint del motor (POST /api/public/automation-tick) pide una cabecera
 * Authorization: Bearer <secreto>. Ese secreto tiene que existir en el
 * entorno del servidor (LOVABLE_CRON_SECRET). Si no esta, el endpoint
 * responde 500 y el motor 24/7 no puede arrancar nunca.
 *
 * Para que el dueno no tenga que editar el fichero de secretos a mano, el
 * secreto tambien se puede guardar en app_settings (tabla que solo lee el
 * administrador) y generar desde la propia app. Se busca primero en el
 * entorno y luego en la base.
 */

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Clave en app_settings donde se guarda el secreto si no esta en el entorno. */
export const CLAVE_SECRETO_CRON = "cron_secret";

/** Devuelve el secreto configurado, o null si no hay ninguno. */
export async function leerSecretoCron(db: Db): Promise<string | null> {
  const delEntorno = process.env["LOVABLE_CRON_SECRET"];
  if (delEntorno && delEntorno.trim().length > 0) return delEntorno.trim();
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value")
      .eq("key", CLAVE_SECRETO_CRON)
      .maybeSingle();
    if (error) return null;
    const valor = String((data as { value?: string } | null)?.value ?? "").trim();
    return valor.length > 0 ? valor : null;
  } catch {
    return null;
  }
}

/** Secretos aleatorios seguros (base64url), para generar uno nuevo. */
export function generarSecreto(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binario = "";
  for (const b of buffer) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Comprueba la cabecera del cron.
 *
 * @returns null si todo va bien, o el texto del error (que se devuelve al
 * llamante para que sepa que falta).
 */
export async function verificarCron(db: Db, request: Request): Promise<string | null> {
  const secreto = await leerSecretoCron(db);
  if (!secreto) {
    return (
      "Falta el secreto del cron. Ponlo en el entorno como LOVABLE_CRON_SECRET " +
      `o generalo en la app (Ajustes -> Riesgo global -> Secreto del cron, clave "${CLAVE_SECRETO_CRON}").`
    );
  }
  const header = request.headers.get("authorization");
  if (!header) return "Falta la cabecera Authorization.";
  const match = /^Bearer ([^\s,]+)$/.exec(header);
  if (!match) return "La cabecera Authorization debe ser 'Bearer <secreto>'.";
  const fourni = match[1]!;
  if (fourni.length !== secreto.length || !timingSafeEqual(fourni, secreto)) {
    return "Secreto incorrecto.";
  }
  return null;
}

/** Comparacion en tiempo constante (para no filtrar el secreto por tiempos). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
