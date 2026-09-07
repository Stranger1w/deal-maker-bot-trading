// Escuadrón de Reconocimiento: solo observa y analiza el mercado.
// Nunca ejecuta órdenes, no tiene modo Demo/Real y no toca fondos.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(action: string, entityId: string | null, details: Record<string, unknown>) {
  const db = await admin();
  await db.from("audit_events").insert({
    action,
    entity: "recon_bot",
    entity_id: entityId,
    details: details as never,
  });
}

export const createReconBot = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(60),
        sources: z.array(z.string().min(2)).min(1),
        symbols: z.array(z.string().min(3)).min(1),
        focus: z.enum(["price", "volume", "orderbook", "news", "indicators"]),
        intervalSeconds: z.number().int().min(60).max(86400),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: row, error } = await db
      .from("recon_bots")
      .insert({
        name: data.name.trim(),
        sources: data.sources,
        symbols: data.symbols.map((s) => s.toUpperCase()),
        focus: data.focus,
        interval_seconds: data.intervalSeconds,
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit("recon.bot_created", row?.id ?? null, {
      name: data.name,
      sources: data.sources,
      symbols: data.symbols,
    });
    return { ok: true };
  });

export const setReconStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ botId: z.string().uuid(), status: z.enum(["active", "paused"]) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db
      .from("recon_bots")
      .update({ status: data.status })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit("recon.status_changed", data.botId, { status: data.status });
    return { ok: true };
  });

export const deleteReconBot = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ botId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("recon_bots").delete().eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit("recon.bot_deleted", data.botId, {});
    return { ok: true };
  });

/**
 * Escaneo de reconocimiento: ingesta normalizada de las fuentes conectadas,
 * guardado en el dataset compartido y generación de hallazgos legibles.
 * No abre ni cierra ninguna posición.
 */
export const runReconScan = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ botId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { buildMarketSnapshot, analyzeSymbol } = await import("@/lib/market-data.server");
    const { raiseAlert } = await import("@/lib/alerts.server");

    let q = db.from("recon_bots").select("*").eq("status", "active");
    if (data.botId) q = q.eq("id", data.botId);
    const { data: bots } = await q;
    const list = bots ?? [];
    if (!list.length) return { ok: true, scanned: 0, findings: 0 };

    let observations = 0;
    let findings = 0;

    for (const bot of list) {
      try {
        const snapshot = await buildMarketSnapshot(db, {
          symbols: bot.symbols as string[],
          liveIngest: true,
        });

        const liveRows = snapshot.points
          .filter((p) => p.source === "Binance Spot Klines")
          .slice(-120)
          .map((p) => ({
            recon_bot_id: bot.id,
            source: p.source,
            symbol: p.symbol,
            metric: p.metric,
            value: p.value,
            meta: { normalized: snapshot.schema } as never,
            is_demo: false,
            observed_at: p.observedAt,
          }));
        if (liveRows.length) {
          await db.from("recon_observations").insert(liveRows);
          observations += liveRows.length;
        }

        const newFindings: Record<string, unknown>[] = [];
        for (const symbol of bot.symbols as string[]) {
          const a = analyzeSymbol(snapshot, symbol);
          if (a.samples < 3) continue;
          if (a.volumeRatio >= 1.8) {
            newFindings.push({
              recon_bot_id: bot.id,
              bot_name: bot.name,
              symbol,
              kind: "volume_spike",
              severity: "warning",
              headline: `Pico de volumen ${a.volumeRatio}x sobre la media en ${symbol}`,
              detail: `El volumen más reciente multiplica por ${a.volumeRatio} la media del periodo, con una variación de precio de ${a.trendPct}% y volatilidad ${a.volatilityPct}%.`,
              confidence: Math.min(0.95, 0.4 + a.volumeRatio / 10),
              sources: snapshot.sources.filter((s) => s.points > 0).map((s) => s.source),
              is_demo: false,
            });
          }
          if (Math.abs(a.trendPct) >= 3) {
            newFindings.push({
              recon_bot_id: bot.id,
              bot_name: bot.name,
              symbol,
              kind: "trend_change",
              severity: Math.abs(a.trendPct) >= 6 ? "warning" : "info",
              headline: `Tendencia ${a.trendPct > 0 ? "alcista" : "bajista"} de ${a.trendPct}% en ${symbol}`,
              detail: `Movimiento acumulado de ${a.trendPct}% en ${a.samples} muestras normalizadas; volatilidad ${a.volatilityPct}%.`,
              confidence: Math.min(0.9, 0.35 + Math.abs(a.trendPct) / 20),
              sources: snapshot.sources.filter((s) => s.points > 0).map((s) => s.source),
              is_demo: false,
            });
          }
        }

        if (newFindings.length) {
          await db.from("recon_findings").insert(newFindings as never);
          findings += newFindings.length;
          for (const f of newFindings.filter((f) => f["severity"] === "warning")) {
            await raiseAlert(db, {
              category: "bot",
              severity: "warning",
              title: `Reconocimiento: ${String(f["headline"])}`,
              message: String(f["detail"]),
              entity: "recon_bot",
              entityId: bot.id,
            });
          }
        }

        await db
          .from("recon_bots")
          .update({
            last_run_at: new Date().toISOString(),
            observations_count: Number(bot.observations_count ?? 0) + liveRows.length,
            findings_count: Number(bot.findings_count ?? 0) + newFindings.length,
            last_error: liveRows.length
              ? null
              : "Sin datos nuevos de las fuentes conectadas en este escaneo.",
          })
          .eq("id", bot.id);
      } catch (e) {
        const message = e instanceof Error ? e.message.slice(0, 300) : "Error de escaneo";
        await db.from("recon_bots").update({ last_error: message }).eq("id", bot.id);
        await raiseAlert(db, {
          category: "bot",
          severity: "warning",
          title: `Reconocimiento con errores: ${bot.name}`,
          message,
          entity: "recon_bot",
          entityId: bot.id,
        });
      }
    }

    await audit("recon.scan", data.botId ?? null, { bots: list.length, observations, findings });
    return { ok: true, scanned: list.length, findings };
  });
