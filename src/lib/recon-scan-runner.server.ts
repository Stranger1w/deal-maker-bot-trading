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
  // OJO: el cliente de Supabase NO lanza excepcion cuando la consulta falla
  // (devuelve { data: null, error }). Sin mirar el error, el escaneo decia
  // "N senales nuevas" sin haber guardado NADA.
  let errorGuardado: string | null = null;
  if (nuevos.length) {
    const r = await db.from("recon_findings").insert(nuevos);
    const err = (r as { error?: { message?: string; code?: string } | null }).error;
    if (err) {
      const texto = `${err.code ?? ""} ${err.message ?? ""}`;
      errorGuardado = /PGRST204|42703|does not exist|could not find/i.test(texto)
        ? "Falta la migracion 20261031000000_recon_hallazgos_medidos.sql (aplicala en el SQL Editor de Supabase)."
        : (err.message ?? "no se pudieron guardar los hallazgos");
    }
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
    const r = await db.from("recon_observations").insert(liveRows);
    const err = (r as { error?: { message?: string } | null }).error;
    if (err && !errorGuardado)
      errorGuardado = err.message ?? "no se pudieron guardar las observaciones";
  }

  const baseRateMedia = tasasBase.length
    ? Math.round((tasasBase.reduce((s, t) => s + t, 0) / tasasBase.length) * 10) / 10
    : null;

  const mensajeError = [errorGuardado, ...errores].filter(Boolean).join(" · ") || null;
  const guardados = !errorGuardado;
  const campos = {
    last_run_at: new Date().toISOString(),
    observations_count: Number(bot["observations_count"] ?? 0) + (guardados ? liveRows.length : 0),
    findings_count: Number(bot["findings_count"] ?? 0) + (guardados ? nuevos.length : 0),
    base_rate_pct: baseRateMedia,
    last_error: mensajeError,
  };
  let r = await db.from("recon_bots").update(campos).eq("id", bot["id"]);
  let errUpdate = (r as { error?: { message?: string } | null }).error;
  if (errUpdate) {
    // Sin la migracion 12 la columna base_rate_pct no existe y el update
    // ENTERO falla: el bot se quedaba con la ultima ejecucion congelada
    // (del 20-oct) y sin error visible. Se reintenta sin la columna nueva,
    // para que al menos la ejecucion y el error se guarden siempre.
    const { base_rate_pct: _omitida, ...resto } = campos;
    void _omitida;
    r = await db.from("recon_bots").update(resto).eq("id", bot["id"]);
    errUpdate = (r as { error?: { message?: string } | null }).error;
  }
  if (errUpdate && !errorGuardado)
    errorGuardado = errUpdate.message ?? "no se pudo actualizar el bot";

  return {
    // Si no se han podido guardar, NO se cuentan como hallazgos nuevos.
    findings: errorGuardado ? 0 : nuevos.length,
    evaluated: evaluados,
    observations: liveRows.length,
    error: mensajeError ?? errorGuardado,
  };
}

/** Dueño del bot (para las alertas). */
export function duenoDelBot(bot: Record<string, unknown>): string | null {
  return duenoDe(bot as never) ?? null;
}
