import { createFileRoute } from "@tanstack/react-router";

// Motor de mineria: un ciclo del enjambre (mide el hash rate real de la
// maquina, reparte el trabajo entre los equipos, calcula la ganancia con los
// datos de la red y el precio reales, y descuenta la luz).
//
// Se invoca desde el cron de la nube cada minuto, con la cabecera
// Authorization: Bearer <secreto> (ver src/lib/cron.server.ts).
export const Route = createFileRoute("/api/public/mining-tick")({
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

        const { tickMineria } = await import("@/lib/mineria/tick");
        try {
          const resultado = await tickMineria(supabaseAdmin);
          return Response.json(resultado, { headers: { "Cache-Control": "no-store" } });
        } catch (e) {
          return Response.json(
            { status: "failed", error: e instanceof Error ? e.message : "unknown" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
