/**
 * Aceptacion del aviso de riesgo (server-only).
 *
 * La aceptacion se guarda como un evento de auditoria con la VERSION del
 * aviso: si el texto cambia, hay que volver a aceptarlo. Asi queda
 * constancia de quien lo acepto y cuando, sin necesitar una tabla nueva.
 */

import { ACCION_ACEPTACION, AVISO_RIESGO_TEXTO, AVISO_RIESGO_VERSION } from "./aviso-riesgo";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type EstadoAviso = {
  /** true si el usuario ya acepto ESTA version del aviso. */
  aceptado: boolean;
  version: string;
  texto: string;
};

/** true si el usuario tiene aceptada la version actual del aviso. */
export async function avisoAceptado(db: Db, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await db
      .from("audit_events")
      .select("details, created_at")
      .eq("action", ACCION_ACEPTACION)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return false;
    for (const fila of (data ?? []) as { details?: { version?: string } | null }[]) {
      if (fila.details?.version === AVISO_RIESGO_VERSION) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Estado completo (para la UI). */
export async function leerEstadoAviso(db: Db, userId: string | null): Promise<EstadoAviso> {
  return {
    aceptado: await avisoAceptado(db, userId),
    version: AVISO_RIESGO_VERSION,
    texto: AVISO_RIESGO_TEXTO,
  };
}

/** Registra la aceptacion del aviso. */
export async function registrarAceptacion(
  db: Db,
  userId: string,
  actor = "operator",
): Promise<void> {
  await db.from("audit_events").insert({
    action: ACCION_ACEPTACION,
    entity: "user",
    entity_id: userId,
    details: { version: AVISO_RIESGO_VERSION } as never,
    actor,
    user_id: userId,
  } as never);
}
