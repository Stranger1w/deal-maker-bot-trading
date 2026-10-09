// Reevaluación del par Auto por bot (Fase 3). Función compartida por el tick
// y el botón manual: misma lógica, mismas validaciones.
//
// Garantías:
//  - Nunca lanza: un fallo devuelve motivo y el bot conserva su par.
//  - Nunca cambia con posición abierta (botTienePosicionAbierta).
//  - Tolera que engine_strategies no exista (selección apagada, tick normal)
//    y que el bot no tenga fila (Auto apagado).
//  - Sin tabla engine_config (o sin respuesta): volumen mínimo por entorno.
//
// No toca flags de trading real ni binance_trading_env (solo lectura del
// entorno activo). No toca src/lib/strategies ni tamaños.

import {
  TOP_REGLAS,
  cumpleMinNotional,
  decidirConHisteresis,
  esParElegible,
  filtrarCandidatos,
  puntuarPar,
  reglasSimbolo,
  type Candidato,
  type ResultadoSeleccion,
} from "./asset-selector.server";
import type { ParMercado } from "./markets.server";

export type ReevaluarOpts = {
  /** Snapshot ya leído (el tick lo comparte entre bots); si falta, se lee. */
  snapshot?: { env: "testnet" | "production"; rows: ParMercado[] } | undefined;
  /** true = aplica el cambio; false = solo simula (qué elegiría y por qué). */
  aplicar: boolean;
  /** El "Aplicar" manual salta el intervalo mínimo (nunca el resto). */
  forzarIntervalo?: boolean | undefined;
  ahora?: number | undefined;
};

export type ReevaluarResultado = ResultadoSeleccion & {
  aplicado: boolean;
  parAnterior: string | null;
  parNuevo: string | null;
};

type FilaBot = { id: string; pair: string; capital: number; mode?: string };
type FilaAuto = {
  auto_symbol: boolean;
  auto_symbol_score: number | null;
  auto_symbol_reason: Record<string, unknown> | null;
  auto_symbol_updated_at: string | null;
};

type DbMin = {
  from: (t: string) => {
    select: (c: string) => PromiseLike<unknown>;
  };
};

/** Volumen mínimo: engine_config si existe; si no, constante por entorno. */
export async function leerMinVolumen(db: DbMin, env: "testnet" | "production"): Promise<number> {
  const { MIN_VOLUMEN_POR_ENTORNO } = await import("./asset-selector.server");
  try {
    const res = (await db.from("engine_config").select("auto_symbol_min_volume")) as {
      data?: { auto_symbol_min_volume?: unknown }[] | null;
      error?: { message: string } | null;
    };
    if (res.error) return MIN_VOLUMEN_POR_ENTORNO[env];
    const v = Number((res.data ?? [])[0]?.auto_symbol_min_volume);
    return Number.isFinite(v) && v > 0 ? v : MIN_VOLUMEN_POR_ENTORNO[env];
  } catch {
    return MIN_VOLUMEN_POR_ENTORNO[env];
  }
}

type DbFull = {
  from: (t: string) => {
    select: (
      c: string,
    ) => { eq: (c: string, v: unknown) => PromiseLike<unknown> } & PromiseLike<unknown>;
    update: (p: Record<string, unknown>) => { eq: (c: string, v: unknown) => PromiseLike<unknown> };
    insert: (r: Record<string, unknown>) => PromiseLike<unknown>;
  };
};

function sinCambio(
  motivo: ResultadoSeleccion["motivo"],
  detalle: string,
  parAnterior: string | null,
): ReevaluarResultado {
  return {
    elegido: null,
    actual: null,
    cambiar: false,
    aplicado: false,
    motivo,
    detalle,
    parAnterior,
    parNuevo: null,
  };
}

/**
 * Reevalúa el par de un bot. Lee pares ocupados al momento (el tick llama en
 * secuencia y relee bots.pair tras cada cambio, así que la foto es fresca).
 */
export async function reevaluarBot(
  db: DbFull,
  botId: string,
  opts: ReevaluarOpts,
): Promise<ReevaluarResultado> {
  const ahora = opts.ahora ?? Date.now();
  // Solo el "Aplicar" manual puede saltar el intervalo (nunca el tick).
  const forzarIntervalo = opts.aplicar ? (opts.forzarIntervalo ?? false) : false;
  try {
    const botsRes = (await db.from("bots").select("id,pair,capital,mode").eq("id", botId)) as {
      data?: FilaBot[] | null;
    };
    const bot = (botsRes.data ?? [])[0] ?? null;
    if (!bot?.pair)
      return sinCambio("sin_candidatos", "Sin candidatos: el bot conserva su par actual", null);
    const { normalizarSimbolo, decidirCambioPar } = await import("./markets.server");
    const parActualNorm = normalizarSimbolo(bot.pair);

    // engine_strategies ausente o sin fila => Auto apagado, tick normal.
    let fila: FilaAuto | null = null;
    try {
      const autoRes = (await db
        .from("engine_strategies")
        .select("auto_symbol,auto_symbol_score,auto_symbol_reason,auto_symbol_updated_at")
        .eq("bot_id", botId)) as {
        data?: FilaAuto[] | null;
        error?: { message: string } | null;
      };
      if (autoRes.error)
        return sinCambio("auto_apagado", "Auto apagado para este bot: conserva su par", bot.pair);
      fila = (autoRes.data ?? [])[0] ?? null;
    } catch {
      return sinCambio("auto_apagado", "Auto apagado para este bot: conserva su par", bot.pair);
    }
    if (!fila || fila.auto_symbol !== true) {
      return sinCambio("auto_apagado", "Auto apagado para este bot: conserva su par", bot.pair);
    }

    const { botTienePosicionAbierta } = await import("./engine-sessions.server");
    let abierta: boolean;
    try {
      abierta = await botTienePosicionAbierta(db as never, { id: botId, pair: parActualNorm });
    } catch {
      return sinCambio(
        "posicion_abierta",
        "No se pudo comprobar la posición: el bot conserva su par",
        bot.pair,
      );
    }
    if (abierta) {
      return sinCambio(
        "posicion_abierta",
        `Posición abierta en ${parActualNorm}: el bot conserva su par`,
        bot.pair,
      );
    }

    return await elegirYAplicar(db, bot, parActualNorm, fila, opts, { ahora, forzarIntervalo });
  } catch (e) {
    return sinCambio(
      "sin_candidatos",
      e instanceof Error
        ? `Selector no disponible (${e.message}): conserva su par`
        : "Selector no disponible: conserva su par",
      null,
    );
  }
}

async function elegirYAplicar(
  db: DbFull,
  bot: FilaBot,
  parActualNorm: string,
  fila: FilaAuto,
  opts: ReevaluarOpts,
  ctx: { ahora: number; forzarIntervalo: boolean },
): Promise<ReevaluarResultado> {
  const { normalizarSimbolo, decidirCambioPar, obtenerSnapshotMercados } =
    await import("./markets.server");
  const snapshot = opts.snapshot ?? (await obtenerSnapshotMercados());
  if (!snapshot.rows.length) {
    return sinCambio("sin_candidatos", "Sin candidatos: el bot conserva su par actual", bot.pair);
  }

  const minVolumen = await leerMinVolumen(db, snapshot.env);
  // Pares ocupados por OTRO bot (foto fresca: el tick es secuencial).
  let ocupados = new Set<string>();
  try {
    const todosRes = (await db.from("bots").select("id,pair")) as {
      data?: { id: string; pair: string }[] | null;
    };
    for (const b of todosRes.data ?? []) {
      if (b.id !== bot.id && b.pair) ocupados.add(normalizarSimbolo(b.pair));
    }
  } catch {
    ocupados = new Set<string>();
  }

  const candidatos = filtrarCandidatos(snapshot.rows, { minVolumen, paresOcupados: ocupados });
  const capital = Number(bot.capital) || 0;
  const aptos: Candidato[] = [];
  for (const c of candidatos.slice(0, TOP_REGLAS)) {
    const reglas = await reglasSimbolo(c.symbol, snapshot.env);
    if (reglas.fallback) continue;
    if (!cumpleMinNotional(capital, c.price, reglas)) continue;
    aptos.push(c);
  }
  const mejor = aptos[0] ?? null;

  // Recalcula el par ACTUAL con el snapshot actual (el guardado no vale:
  // la normalización de volumen cambia entre snapshots).
  const maxVol = snapshot.rows.reduce((m, r) => Math.max(m, r.quoteVolume), 0);
  const filaActual =
    snapshot.rows.find((r) => normalizarSimbolo(r.symbol) === parActualNorm) ?? null;
  let actual: Candidato | null = null;
  if (filaActual && esParElegible(filaActual.symbol, filaActual.base, filaActual.quote)) {
    const { score, componentes } = puntuarPar(filaActual, maxVol);
    actual = { symbol: filaActual.symbol, price: filaActual.price, score, componentes };
  }

  const ts = fila.auto_symbol_updated_at ? Date.parse(fila.auto_symbol_updated_at) : NaN;
  const decision = decidirConHisteresis(actual, mejor, {
    ahora: ctx.ahora,
    ultimoCambioEn: Number.isFinite(ts) ? ts : null,
    forzarIntervalo: ctx.forzarIntervalo,
  });

  if (!decision.cambiar || !decision.elegido) {
    if (opts.aplicar)
      await guardarResultado(db, bot.id, decision.elegido ?? actual, decision, false);
    return {
      ...decision,
      aplicado: false,
      parAnterior: bot.pair,
      parNuevo: decision.elegido?.symbol ?? null,
    };
  }

  async function aplicarCambio(
    db: DbFull,
    bot: FilaBot,
    parActualNorm: string,
    decision: ResultadoSeleccion & { elegido: Candidato },
    opts: ReevaluarOpts,
  ): Promise<ReevaluarResultado> {
    const { normalizarSimbolo, decidirCambioPar } = await import("./markets.server");
    const elegido = decision.elegido;
    // Misma validación que updateBotStrategy: guard + par válido en el entorno.
    const guard = decidirCambioPar(parActualNorm, elegido.symbol, false);
    if (!guard.valido) {
      return {
        elegido,
        actual: decision.actual,
        cambiar: false,
        aplicado: false,
        motivo: "validacion_fallida",
        detalle: guard.motivo ?? "Cambio de par bloqueado",
        parAnterior: bot.pair,
        parNuevo: elegido.symbol,
      };
    }
    const { getBinanceSymbolRules, resolveBinanceTradingEnv } =
      await import("./binance-trading.server");
    const env = await resolveBinanceTradingEnv();
    const rules = await getBinanceSymbolRules(elegido.symbol, env);
    if (rules.fallback) {
      return {
        elegido,
        actual: decision.actual,
        cambiar: false,
        aplicado: false,
        motivo: "validacion_fallida",
        detalle: `Binance no reconoce ${elegido.symbol} en ${env}: no existe en el entorno activo`,
        parAnterior: bot.pair,
        parNuevo: elegido.symbol,
      };
    }
    if (!opts.aplicar) {
      return { ...decision, aplicado: false, parAnterior: bot.pair, parNuevo: elegido.symbol };
    }
    const parNuevo = normalizarSimbolo(elegido.symbol);
    const updRes = (await db
      .from("bots")
      .update({ pair: parNuevo, updated_at: new Date().toISOString() })
      .eq("id", bot.id)) as { error?: { message: string } | null };
    if (updRes.error) {
      return {
        ...decision,
        aplicado: false,
        motivo: "validacion_fallida",
        detalle: `No se pudo aplicar el cambio: ${updRes.error.message}`,
        parAnterior: bot.pair,
        parNuevo: elegido.symbol,
      };
    }
    await guardarResultado(db, bot.id, elegido, decision, true);
    // bot_logs (bot_id, level, message) y audit_events (action, entity,
    // entity_id, details): verificados contra la migración inicial.
    try {
      await db.from("bot_logs").insert({
        bot_id: bot.id,
        level: "info",
        message: `Auto: ${parActualNorm} → ${parNuevo} (${decision.detalle})`,
      });
    } catch {
      // Best-effort: el cambio ya se aplicó.
    }
    try {
      await db.from("audit_events").insert({
        action: "auto_symbol.changed",
        entity: "bot",
        entity_id: bot.id,
        details: {
          par_anterior: parActualNorm,
          par_nuevo: parNuevo,
          score: elegido.score,
          componentes: elegido.componentes,
          motivo: decision.motivo,
        },
      });
    } catch {
      // Best-effort.
    }
    return { ...decision, aplicado: true, parAnterior: bot.pair, parNuevo };
  }

  async function guardarResultado(
    db: DbFull,
    botId: string,
    elegido: Candidato | null,
    decision: ResultadoSeleccion,
    aplicado: boolean,
  ): Promise<void> {
    try {
      await db
        .from("engine_strategies")
        .update({
          auto_symbol_score: elegido?.score ?? null,
          auto_symbol_reason: {
            symbol: elegido?.symbol ?? null,
            score: elegido?.score ?? null,
            volumen: elegido?.componentes.volumen ?? null,
            volatilidad: elegido?.componentes.volatilidad ?? null,
            momentum: elegido?.componentes.momentum ?? null,
            motivo: decision.motivo,
            detalle: decision.detalle,
          },
          ...(aplicado ? { auto_symbol_updated_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("bot_id", botId);
    } catch {
      // Trazabilidad best-effort.
    }
  }

  return aplicarCambio(
    db,
    bot,
    parActualNorm,
    decision as ResultadoSeleccion & { elegido: Candidato },
    opts,
  );
}
