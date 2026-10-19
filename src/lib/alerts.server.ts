// Sistema de alertas (server-only).
// Las alertas se persisten siempre in-app. La entrega por email/push queda
// marcada como pendiente SOLO si hay una configuración real de envío; nunca se
// simula una entrega.

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type AlertInput = {
  category: "bot" | "risk" | "engine" | "binance" | "funds" | "mining" | "security" | "report";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  entity?: string;
  entityId?: string | null;
  /**
   * Dueno de la alerta (obligatorio): alerts.user_id es NOT NULL desde la
   * migracion del 14-oct. La ve ese usuario (y el administrador). Si se
   * omite, el insert falla y la alerta NO se guarda.
   */
  userId: string;
};

/**
 * Persiste una alerta in-app y calcula el estado real de entrega externa.
 *
 * Lanza si el insert falla: antes el error se ignoraba y, con user_id NOT
 * NULL, TODAS las alertas dejaron de guardarse en silencio (no habia ni un
 * aviso en los logs). Ahora el fallo es visible; quien no puede romper el
 * ciclo (el tick) lo captura y lo registra.
 */
export async function raiseAlert(db: Db, alert: AlertInput) {
  // La configuracion de envio es la del DUENO de la alerta: cada usuario
  // tiene sus own limites y su propio correo. Antes se leia con .limit(1),
  // que devolvia la fila de cualquiera (la del administrador).
  const { leerAjustesDeUsuario } = await import("./propietario.server");
  let emailConfigured = false;
  try {
    const ajustes = await leerAjustesDeUsuario(db, alert.userId);
    const correo = ajustes?.notify_email;
    emailConfigured =
      ajustes?.notify_email_enabled === true && typeof correo === "string" && correo.includes("@");
  } catch {
    emailConfigured = false;
  }

  // types.ts aun no incluye alerts.user_id: cast.
  const { error } = await db.from("alerts").insert({
    category: alert.category,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    entity: alert.entity ?? null,
    entity_id: alert.entityId ?? null,
    delivery_status: emailConfigured ? "queued_email" : "in_app_only",
    user_id: alert.userId,
  } as never);
  if (error) {
    throw new Error(`No se pudo guardar la alerta "${alert.title}": ${error.message}`);
  }
}

export async function raiseAlertStandalone(alert: AlertInput) {
  const db = await getDb();
  await raiseAlert(db, alert);
}
