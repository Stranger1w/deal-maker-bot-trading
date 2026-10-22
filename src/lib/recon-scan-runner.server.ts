/**
 * EL CICLO DE ESCANEO DE UN BOT DE RECONOCIMIENTO.
 *
 * Vive aqui (y no en la server function) porque lo usan DOS sitios:
 *   - la pagina "Oportunidades", cuando pulsas "Escanear enjambre";
 *   - el endpoint /api/public/recon-tick, que lo llama el cron local.
 *
 * Solo LEE velas publicas de Binance. No abre ni cierra posiciones.
 */
import { evaluarHallazgo, analizarSimbolo, AJUSTES_POR_DEFECTO } from "./recon-scan.server";
import { velasDeBinance } from "./velas.server";
import { duenoDe } from "./tick-scope";

/* El cliente de Supabase es enorme: aqui solo se usan estas operaciones. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (tabla: string) => any };

export type ResultadoScanBot = {
  findings: number;
  evaluated: number;
  observations: number;
  error: string | null;
};

export async function runReconScanForBot(db: Db, botId: string): Promise<ResultadoScanBot> {
  const { data: filas } = await db.from("recon_bots").select("*").eq("id", botId).limit(1);
  const bot = (filas ?? [])[0] as Record<string, unknown> | undefined;
  if (!bot) return { findings: 0, evaluated: 0, observations: 0, error: "el bot no existe" };

  const ajustes = {
    ...AJUSTES_POR_DEFECTO,
    lookback: Number(bot["lookback_candles"] ?? AJUSTES_POR_DEFECTO.lookback),
    horizonte: Number(bot["horizon_candles"] ?? AJUSTES_POR_DEFECTO.horizonte),
    intervalo: String(bot["intervalo"] ?? AJUSTES_POR_DEFECTO.intervalo),
  };
  const enfoque = String(bot["focus"] ?? "price");
  const simbolos = ((bot["symbols"] as string[]) ?? []).map((s) => s.toUpperCase());

  const nuevos: Record<string, unknown>[] = [];
  const errores: string[] = [];
  const tasasBase: number[] = [];
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
        recon_bot_id: bot["id"],
        bot_name: bot["name"],
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

  // ── EVALUAR los hallazgos antiguos: aqui se aprende si sirve ─────────────
  const { data: viejos } = await db
    .from("recon_findings")
    .select("*")
    .eq("recon_bot_id", bot["id"])
    .is("outcome", null)
    .not("direction", "is", null)
    .order("created_at", { ascending: true })
    .limit(40);

  let evaluados = 0;
  for (const viejo of (viejos ?? []) as Record<string, unknown>[]) {
    const simbolo = String(viejo["symbol"] ?? "").toUpperCase();
    if (!simbolo) continue;
    const velas = velasPorSimbolo.get(simbolo);
    if (!velas || velas.length < 5) continue;
    const ev = evaluarHallazgo(
      {
        direction: (viejo["direction"] as string | null) ?? null,
        reference_price: (viejo["reference_price"] as number | null) ?? null,
        horizon_candles: (viejo["horizon_candles"] as number | null) ?? null,
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
      .eq("id", viejo["id"]);
    evaluados++;
  }

  // ── Guardar los hallazgos nuevos ─────────────────────────────────────────
  if (nuevos.length) {
    await db.from("recon_findings").insert(nuevos);
  }

  // ── Observaciones (el dataset compartido) ────────────────────────────────
  const liveRows = nuevos.map((f) => ({
    recon_bot_id: bot["id"],
    source: "Binance Spot Klines",
    symbol: f["symbol"],
    metric: f["kind"],
    value: f["reference_price"],
    meta: { normalized: "recon-deteccion-v2" },
    is_demo: false,
    observed_at: new Date().toISOString(),
  }));
  if (liveRows.length) {
    await db.from("recon_observations").insert(liveRows);
  }

  const baseRateMedia = tasasBase.length
    ? Math.round((tasasBase.reduce((s, t) => s + t, 0) / tasasBase.length) * 10) / 10
    : null;

  await db
    .from("recon_bots")
    .update({
      last_run_at: new Date().toISOString(),
      observations_count: Number(bot["observations_count"] ?? 0) + liveRows.length,
      findings_count: Number(bot["findings_count"] ?? 0) + nuevos.length,
      base_rate_pct: baseRateMedia,
      last_error: errores.length ? errores.slice(0, 3).join(" · ") : null,
    })
    .eq("id", bot["id"]);

  return {
    findings: nuevos.length,
    evaluated: evaluados,
    observations: liveRows.length,
    error: errores.length ? errores.slice(0, 3).join(" · ") : null,
  };
}

/** Dueño del bot (para las alertas). */
export function duenoDelBot(bot: Record<string, unknown>): string | null {
  return duenoDe(bot as never) ?? null;
}
