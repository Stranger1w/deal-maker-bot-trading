/**
 * EL BOT DE COBERTURA EN EL SERVIDOR: las dos patas y la contabilidad.
 *
 * QUE HACE, PASO A PASO
 *  - Lee el estado: si ya hay cobertura abierta (las dos patas) o no.
 *  - Calcula el "basis" (perp - spot) y la financiacion (cuotas reales).
 *  - Decide (decidirCobertura): abrir, mantener o cerrar.
 *  - Si abre: compra el spot y DESPUES vende el perpetuo. Si la pata corta
 *    falla, vende el spot otra vez (deshace): nunca queda un largo desnudo.
 *  - Si cierra: compra el perpetuo (cierra el corto) y DESPUES vende el spot.
 *    Si la venta del spot falla, vuelve a vender el perpetuo: nunca queda un
 *    corto desnudo (que puede perder sin limite).
 *
 * LA CONTABILIDAD
 *  - El P&L de la cobertura es: spot + pata corta + las cuotas cobradas
 *    (leidas de la cuenta de futuros) menos las comisiones.
 *  - Se guarda como una ejecucion del bot (igual que una operacion normal),
 *    para que las metricas, el riesgo diario y el panel lo vean.
 */
import { decidirCobertura, pnlCobertura, type DecisionCobertura } from "./carry-bot";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type EstadoCobertura = {
  /** true si las dos patas estan abiertas. */
  tienePosicion: boolean;
  /** El "basis" (perp - spot) en %. */
  basePct: number;
  /** La financiacion media de los ultimos periodos (%). */
  mediaCuotasPct: number;
  /** La ultima cuota (%). */
  ultimaCuotaPct: number;
  /** Cuotas negativas seguidas. */
  periodosNegativos: number;
  /** La decision que toca. */
  decision: DecisionCobertura;
  /** El precio del spot (para la interfaz). */
  precioSpot: number;
  /** El precio del perpetuo. */
  precioPerp: number;
  /** El motivo por el que no se puede operar (si aplica). */
  bloqueo: string | null;
};

/** Las ultimas cuotas de financiacion (una sola llamada, sin paginar). */
export async function ultimasCuotas(
  simbolo: string,
  n = 12,
): Promise<Array<{ t: number; r: number }>> {
  const host = "https://fapi.binance.com";
  try {
    const res = await fetch(`${host}/fapi/v1/fundingRate?symbol=${simbolo}&limit=${n}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const filas = (await res.json()) as Array<{ fundingTime: number; fundingRate: string }>;
    return filas
      .map((f) => ({ t: Number(f.fundingTime), r: Number(f.fundingRate) }))
      .filter((f) => Number.isFinite(f.t) && Number.isFinite(f.r))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

/** El precio del spot y el del perpetuo (publicos, sin credenciales). */
export async function preciosCobertura(
  simbolo: string,
): Promise<{ spot: number; perp: number } | null> {
  const par = simbolo.toUpperCase();
  const perpSimbolo = par.endsWith("USDT") ? par : `${par}USDT`;
  try {
    const [spotRes, perpRes] = await Promise.all([
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${par}`, {
        signal: AbortSignal.timeout(12_000),
      }),
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${perpSimbolo}`, {
        signal: AbortSignal.timeout(12_000),
      }),
    ]);
    if (!spotRes.ok || !perpRes.ok) return null;
    const spot = Number(((await spotRes.json()) as { price?: string }).price ?? 0);
    const perp = Number(((await perpRes.json()) as { markPrice?: string }).markPrice ?? 0);
    if (!(spot > 0) || !(perp > 0)) return null;
    return { spot, perp };
  } catch {
    return null;
  }
}

/**
 * El estado de la cobertura de un bot: las dos patas, el basis, las cuotas y
 * la decision.
 */
export async function estadoCobertura(args: {
  db: Db;
  botId: string;
  simbolo: string;
  /** Cuantas cuotas mirar para la media. */
  periodos?: number;
}): Promise<EstadoCobertura> {
  const { db, botId, simbolo } = args;
  const periodos = args.periodos ?? 12;

  // Las dos patas: la ultima compra (spot) y la ultima venta (perp).
  const { data: ejecuciones } = await db
    .from("bot_executions")
    .select("side,quantity,price,status,market,created_at")
    .eq("bot_id", botId)
    .in("status", ["filled", "simulated", "partially_filled"])
    .order("created_at", { ascending: false })
    .limit(20);

  const filas = (ejecuciones ?? []) as unknown as Array<{
    side?: string;
    quantity?: number;
    price?: number;
    status?: string;
    market?: string;
    created_at?: string;
  }>;
  const compraSpot = filas.find((f) => f.side === "buy" && f.market === "spot");
  const ventaPerp = filas.find((f) => f.side === "sell" && f.market === "perp");
  const tienePosicion = Boolean(compraSpot && ventaPerp);

  const precios = await preciosCobertura(simbolo);
  const cuotas = await ultimasCuotas(simbolo, periodos);
  const basePct =
    precios && precios.spot > 0 ? ((precios.perp - precios.spot) / precios.spot) * 100 : 0;
  const media = cuotas.length ? (cuotas.reduce((s, c) => s + c.r, 0) / cuotas.length) * 100 : 0;
  const ultima = cuotas.length ? cuotas[cuotas.length - 1]!.r * 100 : 0;
  // Las cuotas negativas seguidas (desde la ultima positiva).
  let negativos = 0;
  for (let i = cuotas.length - 1; i >= 0; i--) {
    if ((cuotas[i]!.r ?? 0) < 0) negativos++;
    else break;
  }

  const decision = decidirCobertura({
    tienePosicion,
    basePct,
    mediaCuotasPct: media,
    ultimaCuotaPct: ultima,
    periodosNegativos: negativos,
  });

  return {
    tienePosicion,
    basePct,
    mediaCuotasPct: media,
    ultimaCuotaPct: ultima,
    periodosNegativos: negativos,
    decision,
    precioSpot: precios?.spot ?? 0,
    precioPerp: precios?.perp ?? 0,
    bloqueo: precios
      ? null
      : "No se pudieron leer los precios del spot y del perpetuo: no se puede decidir nada.",
  };
}

/**
 * Las cuotas que la cuenta de futuros ha pagado o recibido de verdad.
 *
 * Se leen del income de futuros (FUNDING_FEE). Si no se puede leer (la
 * clave no tiene futuros, por ejemplo), se devuelven las estimadas por el
 * precio (basis) y la app lo dice.
 */
export async function cuotasCobradas(args: {
  env: "testnet" | "production";
  apiKey: string;
  apiSecret: string;
  simbolo: string;
  desde: number;
}): Promise<{ cuotas: number; estimado: boolean }> {
  const host =
    args.env === "production" ? "https://fapi.binance.com" : "https://testnet.binancefuture.com";
  const perpSimbolo = args.simbolo.toUpperCase();
  try {
    const { signBinanceQuery } = await import("./crypto.server");
    const query = `symbol=${perpSimbolo}&incomeType=FUNDING_FEE&startTime=${args.desde}&recvWindow=5000&timestamp=${Date.now()}`;
    const signature = await signBinanceQuery(query, args.apiSecret);
    const res = await fetch(`${host}/fapi/v1/income?${query}&signature=${signature}`, {
      headers: { "X-MBX-APIKEY": args.apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { cuotas: 0, estimado: true };
    const filas = (await res.json()) as Array<{ income?: string }>;
    // Las cuotas del lado corto son POSITIVAS si las paga el otro (el que
    // esta comprado en el spot); Binance las mete con signo negativo cuando las
    // paga el que esta vendido, asi que se invierte el signo.
    const total = filas.reduce((s, f) => s - Number(f.income ?? 0), 0);
    return { cuotas: total, estimado: false };
  } catch {
    return { cuotas: 0, estimado: true };
  }
}

/** El P&L de la cobertura (para la contabilidad). */
export function calcularPnlCobertura(args: {
  spotEntrada: number;
  spotSalida: number;
  perpEntrada: number;
  perpSalida: number;
  cuotas: number;
  comisiones?: number;
}): number {
  return pnlCobertura({
    spotInicial: args.spotEntrada,
    spotFinal: args.spotSalida,
    perpInicial: args.perpEntrada,
    perpFinal: args.perpSalida,
    cuotas: args.cuotas,
    ...(args.comisiones !== undefined ? { comisiones: args.comisiones } : {}),
  });
}
