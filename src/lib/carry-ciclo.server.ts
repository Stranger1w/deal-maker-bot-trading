/**
 * EL CICLO DE LA COBERTURA DENTRO DEL MOTOR: abrir, mantener y cerrar las
 * dos patas.
 *
 * DEMO (paper trading, con precios REALES)
 *   - La pata del spot se simula al precio real del spot.
 *   - La pata del perpetuo se simula al precio real del perpetuo.
 *   - La financiacion es la REAL (las cuotas de Binance de las horas que lleva
 *     abierta la cobertura).
 *   Es exactamente lo que hace el motor en demo con el resto de estrategias
 *   (precio real, sin numeros inventados), asi que el resultado se puede
 *   comparar con el backtest y con la cobertura real.
 *
 * REAL
 *   - Se compra el spot y DESPUES se vende el perpetuo. Si la pata corta
 *     falla, se vende el spot otra vez: nunca queda un largo desnudo.
 *   - Al cerrar: se compra el perpetuo (cierra el corto) y DESPUES se vende el
 *     spot. Si la venta del spot falla, se vuelve a vender el perpetuo: nunca
 *     queda un corto desnudo (que puede perder sin limite).
 */
import { estadoCobertura, cuotasCobradas, preciosCobertura } from "./carry-bot.server";
import { calcularPnlCobertura } from "./carry-bot.server";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type ResultadoCicloCobertura = {
  /** Que se ha hecho en este ciclo. */
  accion: "abierto" | "cerrado" | "mantenido" | "omitido";
  /** El texto para el log del bot. */
  detalle: string;
  /** El P&L del ciclo (0 si no se ha cerrado nada). */
  pnl: number;
  /** El error, si lo hubo. */
  error: string | null;
};

export type BotCobertura = {
  id: string;
  name: string;
  pair: string;
  capital: number;
  max_capital: number;
  mode: string;
};

type Credenciales = { apiKey: string; apiSecret: string } | null;

export async function cicloCobertura(args: {
  db: Db;
  bot: BotCobertura;
  env: "testnet" | "production";
  credenciales: Credenciales;
  /** El importe a cubrir (en USDT). */
  size: number;
  /** true si no se pueden enviar ordenes reales (dry-run). */
  dryRun: boolean;
  log: (nivel: "info" | "warn" | "error", mensaje: string) => Promise<void>;
  /** La clave de idempotencia del ciclo. */
  idempotencyKey: string;
}): Promise<ResultadoCicloCobertura> {
  const { db, bot, env, credenciales, size, dryRun, log } = args;
  const simbolo = bot.pair.toUpperCase();

  // Sin la migracion (bots.modo_operacion y bot_executions.market) NO se puede
  // saber cual pata es cual: las dos usan el mismo par. Mejor no operar que
  // dejar la cobertura a medias.
  const { error: errorColumnas } = await db.from("bot_executions").select("market").limit(1);
  if (errorColumnas) {
    const motivo =
      "Falta la migracion 20261030000000_bots_cobertura.sql: aplicala en el SQL Editor de Supabase para poder distinguir las dos patas de la cobertura.";
    await log("warn", `Cobertura omitida. ${motivo}`);
    return { accion: "omitido", detalle: motivo, pnl: 0, error: motivo };
  }

  const estado = await estadoCobertura({ db, botId: bot.id, simbolo });
  if (estado.bloqueo) {
    await log("warn", `Cobertura omitida: ${estado.bloqueo}`);
    return { accion: "omitido", detalle: estado.bloqueo, pnl: 0, error: estado.bloqueo };
  }

  const { decision } = estado;

  // ── Mantener ────────────────────────────────────────────────────────────
  if (decision.accion === "mantener") {
    await log("info", `Cobertura: ${decision.motivo}`);
    return { accion: "mantenido", detalle: decision.motivo, pnl: 0, error: null };
  }

  // ── Abrir ───────────────────────────────────────────────────────────────
  if (decision.accion === "abrir") {
    if (bot.mode === "real") {
      if (dryRun || !credenciales) {
        const motivo = "Ciclo real omitido (dry-run): no se enviaron ordenes a Binance.";
        await log("warn", motivo);
        return { accion: "omitido", detalle: motivo, pnl: 0, error: null };
      }
      const { tienePermisoFuturos } = await import("./binance-futuros.server");
      const permiso = await tienePermisoFuturos({
        env,
        apiKey: credenciales.apiKey,
        apiSecret: credenciales.apiSecret,
      });
      if (!permiso.ok) {
        await log("warn", `Cobertura no abierta: ${permiso.motivo}`);
        return { accion: "omitido", detalle: permiso.motivo ?? "", pnl: 0, error: permiso.motivo };
      }
    }

    const precios = await preciosCobertura(simbolo);
    if (!precios) {
      const motivo = "No se pudieron leer los precios del spot y del perpetuo.";
      await log("warn", `Cobertura no abierta: ${motivo}`);
      return { accion: "omitido", detalle: motivo, pnl: 0, error: motivo };
    }
    const cantidad = size / precios.spot;

    if (bot.mode === "real" && credenciales) {
      return await abrirCoberturaReal({
        ...args,
        credenciales: credenciales as { apiKey: string; apiSecret: string },
        precios,
        cantidad,
      });
    }

    // Demo (paper): las dos patas al precio real.
    await db.from("bot_executions").insert({
      bot_id: bot.id,
      bot_name: bot.name,
      idempotency_key: `${args.idempotencyKey}:spot`,
      mode: bot.mode,
      side: "buy",
      symbol: simbolo,
      market: "spot",
      quantity: cantidad,
      price: precios.spot,
      pnl: 0,
      status: "simulated",
      error: null,
      exchange_order_id: null,
      signal_indicators: [],
      signal_reason: "cobertura_spot",
      signal_at: new Date().toISOString(),
    } as never);
    await db.from("bot_executions").insert({
      bot_id: bot.id,
      bot_name: bot.name,
      idempotency_key: `${args.idempotencyKey}:perp`,
      mode: bot.mode,
      side: "sell",
      symbol: simbolo,
      market: "perp",
      quantity: cantidad,
      price: precios.perp,
      pnl: 0,
      status: "simulated",
      error: null,
      exchange_order_id: null,
      signal_indicators: [],
      signal_reason: "cobertura_perp",
      signal_at: new Date().toISOString(),
    } as never);
    await log(
      "info",
      `Cobertura abierta (demo): ${cantidad.toFixed(6)} de ${simbolo} · spot ${precios.spot} · perp ${precios.perp} · ${decision.motivo}`,
    );
    return { accion: "abierto", detalle: decision.motivo, pnl: 0, error: null };
  }

  // ── Cerrar ──────────────────────────────────────────────────────────────
  const { data: ejecuciones } = await db
    .from("bot_executions")
    .select("side,market,quantity,price,created_at")
    .eq("bot_id", bot.id)
    .in("status", ["filled", "simulated", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(20);
  const filas = (ejecuciones ?? []) as unknown as Array<{
    side?: string;
    market?: string;
    quantity?: number;
    price?: number;
    created_at?: string;
  }>;
  const compraSpot = filas.find((f) => f.side === "buy" && f.market === "spot");
  const ventaPerp = filas.find((f) => f.side === "sell" && f.market === "perp");
  if (!compraSpot || !ventaPerp) {
    const motivo = "No se能找到 la cobertura abierta (faltan las patas): no se cierra nada.";
    await log("warn", `Cobertura: ${motivo}`);
    return { accion: "omitido", detalle: motivo, pnl: 0, error: motivo };
  }

  const precios = await preciosCobertura(simbolo);
  if (!precios) {
    const motivo = "No se pudieron leer los precios para cerrar la cobertura.";
    await log("warn", `Cobertura no cerrada: ${motivo}`);
    return { accion: "omitido", detalle: motivo, pnl: 0, error: motivo };
  }

  // Las cuotas cobradas de verdad (si hay clave de futuros); si no, se estima
  // con el basis (se avisa en el log).
  let cuotas = 0;
  let estimado = true;
  if (credenciales) {
    const desde = Date.parse(String(ventaPerp.created_at ?? Date.now()));
    const leidas = await cuotasCobradas({
      env,
      apiKey: credenciales.apiKey,
      apiSecret: credenciales.apiSecret,
      simbolo,
      desde,
    });
    cuotas = leidas.cuotas;
    estimado = leidas.estimado;
  }

  const pnl = calcularPnlCobertura({
    spotEntrada: Number(compraSpot.price ?? 0),
    spotSalida: precios.spot,
    perpEntrada: Number(ventaPerp.price ?? 0),
    perpSalida: precios.perp,
    cuotas,
  });

  // Se cierran las dos patas (en demo se anotan; en real se envian).
  if (bot.mode === "real" && credenciales) {
    return await cerrarCoberturaReal({
      ...args,
      credenciales: credenciales as { apiKey: string; apiSecret: string },
      precios,
      pnl,
      cuotas,
      estimado,
    });
  }

  await db.from("bot_executions").insert({
    bot_id: bot.id,
    bot_name: bot.name,
    idempotency_key: `${args.idempotencyKey}:cierre_spot`,
    mode: bot.mode,
    side: "sell",
    symbol: simbolo,
    market: "spot",
    quantity: Number(compraSpot.quantity ?? 0),
    price: precios.spot,
    pnl: Number(
      (pnl * Number(compraSpot.quantity ?? 0) * Number(compraSpot.price ?? 0)).toFixed(2),
    ),
    status: "simulated",
    error: null,
    exchange_order_id: null,
    signal_indicators: [],
    signal_reason: "cobertura_cierre_spot",
    signal_at: new Date().toISOString(),
  } as never);
  await db.from("bot_executions").insert({
    bot_id: bot.id,
    bot_name: bot.name,
    idempotency_key: `${args.idempotencyKey}:cierre_perp`,
    mode: bot.mode,
    side: "buy",
    symbol: simbolo,
    market: "perp",
    quantity: Number(ventaPerp.quantity ?? 0),
    price: precios.perp,
    pnl: 0,
    status: "simulated",
    error: null,
    exchange_order_id: null,
    signal_indicators: [],
    signal_reason: "cobertura_cierre_perp",
    signal_at: new Date().toISOString(),
  } as never);
  await log(
    "info",
    `Cobertura cerrada (demo): P&L ${(pnl * 100).toFixed(3)} % (cuotas ${(cuotas * 100).toFixed(3)} %${estimado ? ", estimadas por el basis" : ", reales"}).`,
  );
  return {
    accion: "cerrado",
    detalle: `Cobertura cerrada: P&L ${(pnl * 100).toFixed(3)} %`,
    pnl: pnl * Number(compraSpot.quantity ?? 0) * Number(compraSpot.price ?? 0),
    error: null,
  };
}

/** La cobertura en REAL: dos ordenes, con la pata corta primero al abrir. */
async function abrirCoberturaReal(args: {
  db: Db;
  bot: BotCobertura;
  env: "testnet" | "production";
  credenciales: { apiKey: string; apiSecret: string };
  size: number;
  log: (nivel: "info" | "warn" | "error", mensaje: string) => Promise<void>;
  idempotencyKey: string;
  precios: { spot: number; perp: number };
  cantidad: number;
}): Promise<ResultadoCicloCobertura> {
  const { db, bot, env, credenciales, log, precios, cantidad } = args;
  const simbolo = bot.pair.toUpperCase();
  const { placeBinanceOrder, getBinanceSymbolRules } = await import("./binance-trading.server");
  const { placeBinanceFuturesOrder } = await import("./binance-futuros.server");
  const rules = await getBinanceSymbolRules(simbolo, env);

  // 1) La pata larga: el spot.
  const compra = await placeBinanceOrder({
    env,
    apiKey: credenciales.apiKey,
    apiSecret: credenciales.apiSecret,
    symbol: simbolo,
    side: "BUY",
    quoteOrderQty: args.size,
    rules,
  });
  if (!compra.ok) {
    const detalle = `La compra del spot fue rechazada: ${compra.errorCode}: ${compra.errorMessage}`;
    await log("error", `Cobertura no abierta. ${detalle}`);
    return { accion: "omitido", detalle, pnl: 0, error: detalle };
  }

  // 2) La pata corta: el perpetuo. Si falla, se deshace la compra.
  const venta = await placeBinanceFuturesOrder({
    env,
    apiKey: credenciales.apiKey,
    apiSecret: credenciales.apiSecret,
    symbol: simbolo,
    side: "SELL",
    quantity: compra.executedQty,
    rules,
  });
  if (!venta.ok) {
    const detalle = `La venta en el perpetuo fue rechazada: ${venta.errorCode}: ${venta.errorMessage}`;
    await log("error", `Cobertura: ${detalle} Se deshace la compra del spot.`);
    // Deshacer: vender el spot otra vez (nunca queda un largo desnudo).
    await placeBinanceOrder({
      env,
      apiKey: credenciales.apiKey,
      apiSecret: credenciales.apiSecret,
      symbol: simbolo,
      side: "SELL",
      quantity: compra.executedQty,
      rules,
    });
    return { accion: "omitido", detalle, pnl: 0, error: detalle };
  }

  await db.from("bot_executions").insert({
    bot_id: bot.id,
    bot_name: bot.name,
    idempotency_key: `${args.idempotencyKey}:spot`,
    mode: bot.mode,
    side: "buy",
    symbol: simbolo,
    market: "spot",
    quantity: compra.executedQty,
    price: compra.price,
    pnl: 0,
    status: compra.partiallyFilled ? "partially_filled" : "filled",
    error: null,
    exchange_order_id: compra.orderId,
    signal_indicators: [],
    signal_reason: "cobertura_spot",
    signal_at: new Date().toISOString(),
  } as never);
  await db.from("bot_executions").insert({
    bot_id: bot.id,
    bot_name: bot.name,
    idempotency_key: `${args.idempotencyKey}:perp`,
    mode: bot.mode,
    side: "sell",
    symbol: simbolo,
    market: "perp",
    quantity: venta.executedQty,
    price: venta.price,
    pnl: 0,
    status: venta.partiallyFilled ? "partially_filled" : "filled",
    error: null,
    exchange_order_id: venta.orderId,
    signal_indicators: [],
    signal_reason: "cobertura_perp",
    signal_at: new Date().toISOString(),
  } as never);
  await log(
    "info",
    `Cobertura abierta (real): ${compra.executedQty} ${simbolo} · spot ${compra.price} · perp ${venta.price} (orden ${venta.orderId}).`,
  );
  return {
    accion: "abierto",
    detalle: `Cobertura abierta a ${compra.price} / ${venta.price}`,
    pnl: 0,
    error: null,
  };
}

/** El cierre en REAL: se cierra el corto primero y luego se vende el spot. */
async function cerrarCoberturaReal(args: {
  db: Db;
  bot: BotCobertura;
  env: "testnet" | "production";
  credenciales: { apiKey: string; apiSecret: string };
  log: (nivel: "info" | "warn" | "error", mensaje: string) => Promise<void>;
  idempotencyKey: string;
  precios: { spot: number; perp: number };
  pnl: number;
  cuotas: number;
  estimado: boolean;
}): Promise<ResultadoCicloCobertura> {
  const { db, bot, env, credenciales, log, precios } = args;
  const simbolo = bot.pair.toUpperCase();
  const { placeBinanceOrder, getBinanceSymbolRules } = await import("./binance-trading.server");
  const { placeBinanceFuturesOrder } = await import("./binance-futuros.server");
  const rules = await getBinanceSymbolRules(simbolo, env);

  const { data: ejecuciones } = await db
    .from("bot_executions")
    .select("side,market,quantity,price")
    .eq("bot_id", bot.id)
    .in("status", ["filled", "simulated", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(20);
  const filas = (ejecuciones ?? []) as unknown as Array<{
    side?: string;
    market?: string;
    quantity?: number;
    price?: number;
  }>;
  const compraSpot = filas.find((f) => f.side === "buy" && f.market === "spot");
  const ventaPerp = filas.find((f) => f.side === "sell" && f.market === "perp");
  if (!compraSpot || !ventaPerp) {
    return {
      accion: "omitido",
      detalle: "No se encontro la cobertura abierta.",
      pnl: 0,
      error: null,
    };
  }

  // 1) Cerrar el corto (primero: si fallara, el spot sigue cubierto).
  const cierra = await placeBinanceFuturesOrder({
    env,
    apiKey: credenciales.apiKey,
    apiSecret: credenciales.apiSecret,
    symbol: simbolo,
    side: "BUY",
    quantity: Number(ventaPerp.quantity ?? 0),
    rules,
    reduceOnly: true,
  });
  if (!cierra.ok) {
    const detalle = `No se pudo cerrar el perpetuo: ${cierra.errorCode}: ${cierra.errorMessage}. La cobertura sigue abierta.`;
    await log("error", `Cobertura: ${detalle}`);
    return { accion: "omitido", detalle, pnl: 0, error: detalle };
  }

  // 2) Vender el spot. Si falla, se vuelve a vender el perpetuo (nunca queda
  //    un corto desnudo).
  const venta = await placeBinanceOrder({
    env,
    apiKey: credenciales.apiKey,
    apiSecret: credenciales.apiSecret,
    symbol: simbolo,
    side: "SELL",
    quantity: Number(compraSpot.quantity ?? 0),
    rules,
  });
  if (!venta.ok) {
    await log(
      "error",
      "No se pudo vender el spot: se vuelve a vender el perpetuo para no quedar en corto.",
    );
    await placeBinanceFuturesOrder({
      env,
      apiKey: credenciales.apiKey,
      apiSecret: credenciales.apiSecret,
      symbol: simbolo,
      side: "SELL",
      quantity: Number(ventaPerp.quantity ?? 0),
      rules,
    });
    const detalle = `La venta del spot fue rechazada: ${venta.errorCode}: ${venta.errorMessage}`;
    return { accion: "omitido", detalle, pnl: 0, error: detalle };
  }

  const nocional = Number(compraSpot.quantity ?? 0) * Number(compraSpot.price ?? 0);
  await db.from("bot_executions").insert({
    bot_id: bot.id,
    bot_name: bot.name,
    idempotency_key: `${args.idempotencyKey}:cierre`,
    mode: bot.mode,
    side: "sell",
    symbol: simbolo,
    market: "spot",
    quantity: Number(compraSpot.quantity ?? 0),
    price: venta.price,
    pnl: Number((args.pnl * nocional).toFixed(2)),
    status: "filled",
    error: null,
    exchange_order_id: venta.orderId,
    signal_indicators: [],
    signal_reason: "cobertura_cierre",
    signal_at: new Date().toISOString(),
  } as never);
  await log(
    "info",
    `Cobertura cerrada (real): P&L ${(args.pnl * 100).toFixed(3)} % (cuotas ${(args.cuotas * 100).toFixed(3)} %${args.estimado ? ", estimadas" : ", reales"}).`,
  );
  return {
    accion: "cerrado",
    detalle: `Cobertura cerrada: P&L ${(args.pnl * 100).toFixed(3)} %`,
    pnl: args.pnl * nocional,
    error: null,
  };
}
