import { createFileRoute } from "@tanstack/react-router";

// Escaneo del Escuadron de Reconocimiento, desde el cron local.
//
// Por que existe: los bots de reconocimiento solo se ejecutaban cuando el
// usuario pulsaba "Escanear enjambre" a mano. Los 4 bots llevaban dias sin
// escanear (last_run_at congelado) y con 0 hallazgos: el escuadron no
// vigilaba nada.
//
// Este endpoint lo llama el tick local cada 5 minutos (mismo secreto que el
// motor). Solo LEE velas publicas de Binance: no abre ni cierra posiciones y
// no toca el capital.
//
// A los bots se les da su propio ritmo: cada uno tiene su intervalo
// (interval_seconds) y aqui se respeta, para no gastar la API de Binance.

export const Route = createFileRoute("/api/public/recon-tick")({
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

        const db = supabaseAdmin;
        const { data: bots } = await db.from("recon_bots").select("*").eq("status", "active");
        const ahora = Date.now();
        const toca: typeof bots = [];
        for (const bot of bots ?? []) {
          const intervalo = Number((bot as { interval_seconds?: number }).interval_seconds ?? 300);
          const ultimo = (bot as { last_run_at?: string | null }).last_run_at;
          const transcurrido = ultimo
            ? ahora - new Date(ultimo).getTime()
            : Number.MAX_SAFE_INTEGER;
          if (transcurrido >= intervalo * 1000) toca.push(bot);
        }

        if (!toca.length) {
          return Response.json(
            { status: "skipped", bots: 0, motivo: "ningun bot toca todavia" },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        let findings = 0;
        let evaluated = 0;
        const errores: string[] = [];
        for (const bot of toca) {
          try {
            const { runReconScanForBot } = await import("@/lib/recon-scan-runner.server");
            const r = await runReconScanForBot(db, bot.id);
            findings += r.findings;
            evaluated += r.evaluated;
          } catch (e) {
            errores.push(
              `${(bot as { name?: string }).name ?? bot.id}: ${e instanceof Error ? e.message : "error"}`,
            );
          }
        }

        return Response.json(
          {
            status: errores.length ? "partial" : "completed",
            bots: toca.length,
            findings,
            evaluated,
            errors: errores,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
