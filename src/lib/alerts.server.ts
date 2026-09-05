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
  category:
    | "bot"
    | "risk"
    | "engine"
    | "binance"
    | "funds"
    | "mining"
    | "security"
    | "report";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  entity?: string;
  entityId?: string | null;
};

/** Persiste una alerta in-app y calcula el estado real de entrega externa. */
export async function raiseAlert(db: Db, alert: AlertInput) {
  const { data: settings } = await db
    .from("automation_settings")
    .select("notify_email_enabled, notify_email")
    .limit(1)
    .maybeSingle();

  const emailConfigured =
    settings?.notify_email_enabled === true && !!settings.notify_email?.includes("@");

  await db.from("alerts").insert({
    category: alert.category,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    entity: alert.entity ?? null,
    entity_id: alert.entityId ?? null,
    delivery_status: emailConfigured ? "queued_email" : "in_app_only",
  });
}

export async function raiseAlertStandalone(alert: AlertInput) {
  const db = await getDb();
  await raiseAlert(db, alert);
}
