import { createFileRoute } from "@tanstack/react-router";

// Worker durable: este endpoint lo invoca el cron de la nube cada N segundos/minutos.
// No depende de la PC del usuario ni de la app Electron.
// Requiere cabecera `Authorization: Bearer <secreto>`.
//
// El secreto se busca primero en el entorno (LOVABLE_CRON_SECRET) y, si no
// esta, en app_settings: asi el dueno puede generarlo desde la propia app
// sin editar el fichero de secretos (ver src/lib/cron.server.ts).
export const Route = createFileRoute("/api/public/automation-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { verificarCron } = await import("@/lib/cron.server");
        const error = await verificarCron(supabaseAdmin, request);
        if (error) {
          return Response.json(
            { status: "failed", error },
            { status: 401, headers: { "Cache-Control": "no-store" } },
          );
        }

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
