import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Tareas programadas de mantenimiento: reportes diario/semanal y barrido de
// ganancias. Se invoca desde el cron de la nube; no depende de la PC del usuario.
// Requiere cabecera `Authorization: Bearer <LOVABLE_CRON_SECRET>`.
export const Route = createFileRoute("/api/public/maintenance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const url = new URL(request.url);
        const period = url.searchParams.get("period") === "weekly" ? "weekly" : "daily";

        try {
          const { buildReports, profitSweep } = await import("@/lib/reports.server");
          const reports = await buildReports(period);
          const sweep = period === "weekly" ? await profitSweep() : { skipped: "solo_semanal" };
          return Response.json(
            { ok: true, period, reports, sweep },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "unknown" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
