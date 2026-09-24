// Verificacion de produccion del motor 24/7 (punto 4).
// GET publico SIN secreto: solo dice si el cron esta vivo (heartbeat) sin exponer datos.
// El tick real sigue exigiendo LOVABLE_CRON_SECRET.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/engine-health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: s } = await supabaseAdmin
            .from("automation_settings")
            .select("engine_enabled,kill_switch,engine_status,last_heartbeat_at,tick_interval_seconds,last_error")
            .limit(1)
            .maybeSingle();
          const row = (s ?? {}) as {
            engine_enabled?: boolean;
            kill_switch?: boolean;
            engine_status?: string;
            last_heartbeat_at?: string | null;
            tick_interval_seconds?: number;
            last_error?: string | null;
          };
          const age = row.last_heartbeat_at
            ? Math.round((Date.now() - Date.parse(row.last_heartbeat_at)) / 1000)
            : null;
          const alive =
            !!row.engine_enabled && !row.kill_switch && age !== null && age < (row.tick_interval_seconds ?? 60) * 3;
          return Response.json(
            { ok: true, alive, heartbeatAgeSeconds: age, status: row.engine_status ?? "unknown", lastError: row.last_error ?? null },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
        }
      },
    },
  },
});
