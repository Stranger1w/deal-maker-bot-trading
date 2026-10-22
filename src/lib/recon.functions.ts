// Escuadrón de Reconocimiento: solo observa y analiza el mercado.
// Nunca ejecuta órdenes, no tiene modo Demo/Real y no toca fondos.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import { duenoDe } from "./tick-scope";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(
  action: string,
  entityId: string | null,
  details: Record<string, unknown>,
  userId: string | null = null,
) {
  const db = await admin();
  // types.ts aun no incluye audit_events.user_id (columna anadida a mano): cast.
  await db.from("audit_events").insert({
    action,
    entity: "recon_bot",
    entity_id: entityId,
    details: details as never,
    user_id: userId,
  } as never);
}

export const createReconBot = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
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
  .handler(async ({ data, context }) => {
    const db = await admin();
    // types.ts aun no incluye recon_bots.user_id: cast del objeto.
    const { data: row, error } = await db
      .from("recon_bots")
      .insert({
        name: data.name.trim(),
        sources: data.sources,
        symbols: data.symbols.map((s) => s.toUpperCase()),
        focus: data.focus,
        interval_seconds: data.intervalSeconds,
        status: "active",
        user_id: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(
      "recon.bot_created",
      row?.id ?? null,
      { name: data.name, sources: data.sources, symbols: data.symbols },
      context.userId,
    );
    return { ok: true };
  });

export const setReconStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ botId: z.string().uuid(), status: z.enum(["active", "paused"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db
      .from("recon_bots")
      .update({ status: data.status })
      .eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit("recon.status_changed", data.botId, { status: data.status }, context.userId);
    return { ok: true };
  });

export const deleteReconBot = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({ botId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { error } = await db.from("recon_bots").delete().eq("id", data.botId);
    if (error) throw new Error(error.message);
    await audit("recon.bot_deleted", data.botId, {}, context.userId);
    return { ok: true };
  });

/**
 * Escaneo de reconocimiento: mira los activos de cada bot con velas REALES
 * de Binance, genera hallazgos y EVALUA los antiguos para poder decir si el
 * escuadron acierta mas que el azar.
 * No abre ni cierra ninguna posicion.
 */
/**
 * ESTADISTICAS DEL ESCUADRON: cuanto acierta cada detector y si eso supera
 * a lo que haria el azar.
 *
 * La referencia honesta es la TASA BASE: que tanto subio el mercado de
 * verdad en el mismo periodo. Si un detector acierta el 55% pero el mercado
 * subia el 60% de las veces, no vale nada: se dice.
 */
export const leerEstadisticasRecon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const db = await admin();
    const { resumenAcierto } = await import("@/lib/recon-deteccion");

    const { data: hallazgos, error: errorHallazgos } = await db
      .from("recon_findings")
      .select("kind,direction,hit,outcome")
      .not("hit", "is", null)
      .order("created_at", { ascending: false })
      .limit(3000);

    // Sin la migracion 12 las columnas nuevas no existen: se dice, en vez de
    // dejar la pagina en blanco sin explicacion.
    if (errorHallazgos) {
      const texto = `${errorHallazgos.code ?? ""} ${errorHallazgos.message ?? ""}`;
      if (/PGRST204|42703|does not exist|could not find/i.test(texto)) {
        return {
          resumen: [],
          totalEvaluados: 0,
          totalHallazgos: 0,
          baseRatePct: null,
          horizonteVelas: 6,
          intervalo: "15m",
          faltaMigracion: true,
        };
      }
      throw new Error(errorHallazgos.message);
    }

    const { data: bots } = await db
      .from("recon_bots")
      .select("base_rate_pct,intervalo,horizon_candles,lookback_candles");

    // El total REAL de hallazgos (no los 120 que trae la tabla).
    const { count: totalHallazgos } = await db
      .from("recon_findings")
      .select("id", { count: "exact", head: true });

    const tasas = (bots ?? [])
      .map((b) => Number((b as { base_rate_pct?: number | null }).base_rate_pct))
      .filter((n) => Number.isFinite(n) && n > 0);
    const baseRatePct = tasas.length
      ? Math.round((tasas.reduce((s, t) => s + t, 0) / tasas.length) * 10) / 10
      : null;

    const lista = (hallazgos ?? []) as {
      kind: string;
      direction: string | null;
      hit: boolean | null;
      outcome: string | null;
    }[];
    const resumen = resumenAcierto(
      lista.map((h) => ({
        kind: h.kind,
        direction: (h.direction as "alcista" | "bajista" | null) ?? null,
        hit: h.hit,
        outcome: h.outcome,
      })),
      baseRatePct,
    );

    return {
      resumen,
      totalEvaluados: lista.length,
      totalHallazgos: totalHallazgos ?? 0,
      baseRatePct,
      horizonteVelas: Number((bots ?? [])[0]?.horizon_candles ?? 6),
      intervalo: String((bots ?? [])[0]?.intervalo ?? "15m"),
    };
  });

export const runReconScan = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ botId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { raiseAlert } = await import("@/lib/alerts.server");
    const { analizarSimbolo, evaluarHallazgo, AJUSTES_POR_DEFECTO } =
      await import("@/lib/recon-scan.server");

    let q = db.from("recon_bots").select("*").eq("status", "active");
    if (data.botId) q = q.eq("id", data.botId);
    const { data: bots } = await q;
    const list = bots ?? [];
    if (!list.length)
      return {
        ok: true,
        scanned: 0,
        findings: 0,
        evaluated: 0,
        mensaje: "No hay bots activos que escanear.",
      };

    let observations = 0;
    let findings = 0;
    let evaluated = 0;

    for (const bot of list) {
      // El dueño del bot de reconocimiento es el dueño de sus alertas.
      const duenoId = duenoDe(bot) ?? context.userId;
      try {
        const ajustes = {
          ...AJUSTES_POR_DEFECTO,
          lookback: Number(
            (bot as { lookback_candles?: number }).lookback_candles ?? AJUSTES_POR_DEFECTO.lookback,
          ),
          horizonte: Number(
            (bot as { horizon_candles?: number }).horizon_candles ?? AJUSTES_POR_DEFECTO.horizonte,
          ),
          intervalo: String(
            (bot as { intervalo?: string }).intervalo ?? AJUSTES_POR_DEFECTO.intervalo,
          ),
        };
        const enfoque = String(bot.focus ?? "price");
        const simbolos = (bot.symbols as string[]).map((s) => s.toUpperCase());
        const nuevos: Record<string, unknown>[] = [];
        const errores: string[] = [];
        const tasasBase: number[] = [];
        // Las velas se descargan UNA vez por activo y se reutilizan para
        // detectar, para evaluar los hallazgos viejos y para las observaciones.
        const { velasDeBinance } = await import("@/lib/velas.server");
        const velasPorSimbolo = new Map<string, Awaited<ReturnType<typeof velasDeBinance>>>();

        for (const simbolo of simbolos) {
          const r = await analizarSimbolo(simbolo, ajustes, enfoque);
          if (r.error) {
            errores.push(`${simbolo}: ${r.error}`);
            continue;
          }
          tasasBase.push(r.baseRatePct);
          const velas = await velasDeBinance({
            simbolo,
            intervalo: ajustes.intervalo,
            limite: 200,
            mercado: "spot",
          });
          velasPorSimbolo.set(simbolo, velas);
          for (const d of r.detecciones) {
            nuevos.push({
              recon_bot_id: bot.id,
              bot_name: bot.name,
              symbol: simbolo,
              kind: d.kind,
              severity: d.severity,
              headline: `${d.headline} · ${simbolo}`,
              detail: d.detail,
              confidence: d.fuerza,
              sources: ["Binance Spot Klines"],
              is_demo: false,
              reference_price: d.referencePrice,
              direction: d.direction,
              horizon_candles: ajustes.horizonte,
            });
          }
        }

        // ── EVALUAR los hallazgos antiguos: aqui se aprende si sirve ───────
        const { data: viejos } = await db
          .from("recon_findings")
          .select("id,symbol,direction,reference_price,horizon_candles,created_at")
          .eq("recon_bot_id", bot.id)
          .is("outcome", null)
          .not("direction", "is", null)
          .order("created_at", { ascending: true })
          .limit(40);
        let evaluados = 0;
        for (const viejo of viejos ?? []) {
          const simbolo = String(viejo.symbol ?? "").toUpperCase();
          if (!simbolo) continue;
          const velas = velasPorSimbolo.get(simbolo);
          if (!velas || velas.length < 5) continue;
          const ev = evaluarHallazgo(
            {
              direction: viejo.direction as string | null,
              reference_price: viejo.reference_price as number | null,
              horizon_candles: viejo.horizon_candles as number | null,
            },
            velas,
            ajustes.minMovePct,
          );
          if (!ev) continue;
          await db
            .from("recon_findings")
            .update({
              outcome: ev.outcome,
              outcome_pct: ev.outcomePct,
              hit: ev.hit,
              evaluated_at: new Date().toISOString(),
            })
            .eq("id", viejo.id);
          evaluados++;
        }
        evaluated += evaluados;

        // ── Guardar los hallazgos nuevos ────────────────────────────────────
        if (nuevos.length) {
          await db.from("recon_findings").insert(nuevos as never);
          findings += nuevos.length;
          for (const f of nuevos.filter((f) => f["severity"] === "warning")) {
            await raiseAlert(db, {
              category: "bot",
              severity: "warning",
              title: `Reconocimiento: ${String(f["headline"])}`,
              message: String(f["detail"]),
              entity: "recon_bot",
              entityId: bot.id,
              userId: duenoId,
            });
          }
        }

        // Las observaciones se siguen guardando (el dataset compartido).
        const liveRows = [];
        const baseRateMedia = tasasBase.length
          ? Math.round((tasasBase.reduce((s, t) => s + t, 0) / tasasBase.length) * 10) / 10
          : null;
        for (const simbolo of simbolos) {
          if (!velasPorSimbolo.has(simbolo)) continue;
          const r = await analizarSimbolo(simbolo, ajustes, enfoque);
          if (r.error) continue;
          liveRows.push(
            ...r.detecciones.map((d) => ({
              recon_bot_id: bot.id,
              source: "Binance Spot Klines",
              symbol: simbolo,
              metric: d.kind,
              value: d.referencePrice,
              meta: { normalized: "recon-deteccion-v2" } as never,
              is_demo: false,
              observed_at: new Date().toISOString(),
            })),
          );
        }
        if (liveRows.length) {
          await db.from("recon_observations").insert(liveRows);
          observations += liveRows.length;
        }

        await db
          .from("recon_bots")
          .update({
            last_run_at: new Date().toISOString(),
            observations_count: Number(bot.observations_count ?? 0) + liveRows.length,
            findings_count: Number(bot.findings_count ?? 0) + nuevos.length,
            base_rate_pct: baseRateMedia,
            last_error: errores.length ? errores.slice(0, 3).join(" · ") : null,
          })
          .eq("id", bot.id);
      } catch (e) {
        let message = e instanceof Error ? e.message.slice(0, 300) : "Error de escaneo";
        // El error mas probable: la migracion 12 (columnas nuevas) no esta
        // aplicada. Se dice con las palabras justas.
        if (/PGRST204|42703|does not exist|could not find/i.test(message)) {
          message =
            "Falta la migracion 20261031000000_recon_hallazgos_medidos.sql (aplicala en el SQL Editor de Supabase).";
        }
        await db.from("recon_bots").update({ last_error: message }).eq("id", bot.id);
        await raiseAlert(db, {
          category: "bot",
          severity: "warning",
          title: `Reconocimiento con errores: ${bot.name}`,
          message,
          entity: "recon_bot",
          entityId: bot.id,
          userId: duenoId,
        });
      }
    }

    await audit(
      "recon.scan",
      data.botId ?? null,
      { bots: list.length, observations, findings, evaluated },
      context.userId,
    );
    return {
      ok: true,
      scanned: list.length,
      findings,
      evaluated,
      mensaje:
        findings === 0 && evaluated === 0
          ? "Escaneo hecho: sin señales nuevas y sin hallazgos antiguos que evaluar."
          : `${findings} señal(es) nueva(s) y ${evaluated} hallazgo(s) evaluado(s).`,
    };
  });
