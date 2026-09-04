import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Worker durable: este endpoint lo invoca el cron de la nube cada N segundos/minutos.
// No depende de la PC del usuario ni de la app Electron.
// Requiere cabecera `Authorization: Bearer <LOVABLE_CRON_SECRET>`.
export const Route = createFileRoute("/api/public/automation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { runEngineTick } = await import("@/lib/automation.server");
        try {
          const result = await runEngineTick("cron");
          return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return Response.json(
            { status: "failed", error: error instanceof Error ? error.message : "unknown" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
