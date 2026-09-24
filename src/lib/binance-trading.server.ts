// Órdenes REALES en Binance (server-only).
//
// Reglas de seguridad de este módulo:
//  - Testnet primero: solo `BINANCE_TRADING_ENV=production` envía órdenes a
//    producción. Cualquier otro valor (o ausente) usa testnet. Así el modo Real
//    se valida con dinero de prueba antes de tocar fondos reales.
//  - Las claves llegan ya descifradas desde `binance_credentials`; aquí nunca se
//    escriben en logs, ni se devuelven, ni se incluyen en mensajes de error.
//  - Los errores se normalizan (código + mensaje de Binance) para auditarlos.
//  - Se respetan las reglas del símbolo (stepSize / minQty / minNotional) para no
//    enviar órdenes que Binance rechazaría por precisión.

import { signBinanceQuery } from "./crypto.server";
import { isBinanceGeoRestricted, GEO_RESTRICTED_CODE } from "./binance-region";

export type BinanceTradingEnv = "testnet" | "production";

export const BINANCE_HOSTS: Record<BinanceTradingEnv, string> = {
  testnet: "https://testnet.binance.vision",
  production: "https://api.binance.com",
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/* ------------------------------- TRADING ENVIRONMENT ------------------------------- */

/**
 * Entorno de trading real. Testnet primero: solo `BINANCE_TRADING_ENV=production`
 * envía �rdenes a producción. Cualquier otro valor (o ausente) usa testnet. Así el modo Real
 * se valida con dinero de prueba antes de tocar fondos reales.
 * Prioridad: tabla `app_settings` (escrita desde la UI con doble confirmación) > env.
 */
export async function resolveBinanceTradingEnv(): Promise<BinanceTradingEnv> {
  let raw = process.env["BINANCE_TRADING_ENV"] ?? "testnet";
  try {
    const client = await db();
    const { data: setting } = await client
      .from("app_settings")
      .select("value")
      .eq("key", "binance_trading_env")
      .maybeSingle();
    if (setting?.value === "testnet" || setting?.value === "production") {
      raw = setting.value;
    }
  } catch {
    // Sin tabla o sin permisos: respetamos el env (testnet por defecto).
  }
  raw = String(raw).trim().toLowerCase();
  return raw === "production" || raw === "live" || raw === "mainnet" ? "production" : "testnet";
}

export type SymbolRules = {
  symbol: string;
  stepSize: number;
  minQty: number;
  minNotional: number;
  /** Activo de cotización del par (p. ej. USDT). */
  quote: string;
  /** true cuando Binance no respondió y se usan valores conservadores. */
  fallback: boolean;
};

const FALLBACK_RULES: Omit<SymbolRules, "symbol" | "quote"> = {
  stepSize: 0.00001,
  minQty: 0.00001,
  minNotional: 5,
  fallback: true,
};

function decimalsFromStep(step: string | number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Ajusta una cantidad al múltiplo del stepSize sin pasarse (trunca, no redondea). */
export function roundDownToStep(value: number, stepSize: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const decimals = decimalsFromStep(stepSize);
  const factor = 10 ** decimals;
  const step = Math.max(1, Math.round(stepSize * factor));
  const stepped = Math.floor((value * factor) / step);
  return Number((stepped / factor).toFixed(decimals));
}

/** Reglas reales del símbolo (público, sin credenciales). */
export async function getBinanceSymbolRules(
  symbol: string,
  env: BinanceTradingEnv,
): Promise<SymbolRules> {
  const upper = symbol.toUpperCase();
  const quote = upper.endsWith("USDC") ? "USDC" : upper.endsWith("BTC") ? "BTC" : "USDT";
  try {
    const res = await fetch(
      `${BINANCE_HOSTS[env]}/api/v3/exchangeInfo?symbol=${encodeURIComponent(upper)}`,
    );
    if (!res.ok) throw new Error(`exchangeInfo ${res.status}`);
    const body = (await res.json()) as {
      symbols?: {
        filters?: {
          filterType?: string;
          stepSize?: string;
          minQty?: string;
          minNotional?: string;
        }[];
      }[];
    };
    const filters = body.symbols?.[0]?.filters ?? [];
    const lot =
      filters.find((f) => f.filterType === "LOT_SIZE") ??
      filters.find((f) => f.filterType === "MARKET_LOT_SIZE");
    const notional =
      filters.find((f) => f.filterType === "NOTIONAL") ??
      filters.find((f) => f.filterType === "MIN_NOTIONAL");
    const stepSize = Number(lot?.stepSize ?? FALLBACK_RULES.stepSize);
    const minQty = Number(lot?.minQty ?? FALLBACK_RULES.minQty);
    const minNotional = Number(notional?.minNotional ?? FALLBACK_RULES.minNotional);
    return {
      symbol: upper,
      quote,
      stepSize: Number.isFinite(stepSize) && stepSize > 0 ? stepSize : FALLBACK_RULES.stepSize,
      minQty: Number.isFinite(minQty) && minQty > 0 ? minQty : FALLBACK_RULES.minQty,
      minNotional:
        Number.isFinite(minNotional) && minNotional > 0 ? minNotional : FALLBACK_RULES.minNotional,
      fallback: false,
    };
  } catch {
    return { symbol: upper, quote, ...FALLBACK_RULES };
  }
}
export type BinanceOrderRequest = {
  env: BinanceTradingEnv;
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: "BUY" | "SELL";
  /** Cantidad en activo base (necesaria para SELL). */
  quantity?: number | undefined;
  /** Importe en activo de cotización (recomendado para BUY de mercado). */
  quoteOrderQty?: number | undefined;
  /** Identificador propio: Binance rechaza el duplicado del mismo minuto. */
  clientOrderId?: string | undefined;
  rules?: SymbolRules | undefined;
};

export type BinanceOrderResult = {
  ok: boolean;
  env: BinanceTradingEnv;
  status: string | null;
  orderId: string | null;
  executedQty: number;
  /** Importe ejecutado en el activo de cotización (cummulativeQuoteQty). */
  quoteQty: number;
  /** Precio medio real de ejecución. */
  price: number;
  /** Comisiones pagadas en el activo de cotización (las del activo base se ignoran). */
  commission: number;
  errorCode: string | null;
  errorMessage: string | null;
  geoRestricted: boolean;
};

function fail(
  env: BinanceTradingEnv,
  code: string,
  message: string,
  geoRestricted = false,
): BinanceOrderResult {
  return {
    ok: false,
    env,
    status: null,
    orderId: null,
    executedQty: 0,
    quoteQty: 0,
    price: 0,
    commission: 0,
    errorCode: code,
    errorMessage: message.replace(/\s+/g, " ").slice(0, 300),
    geoRestricted,
  };
}

/** Construye la query firmada de una orden de mercado (sin enviarla). */
export async function buildBinanceMarketOrderQuery(
  req: {
    symbol: string;
    side: "BUY" | "SELL";
    quantity?: number | undefined;
    quoteOrderQty?: number | undefined;
    clientOrderId?: string | undefined;
  },
  apiSecret: string,
): Promise<{ query: string; signature: string }> {
  const params: string[] = [
    `symbol=${req.symbol.toUpperCase()}`,
    `side=${req.side}`,
    "type=MARKET",
    "newOrderRespType=FULL",
    "recvWindow=5000",
    `timestamp=${Date.now()}`,
  ];
  if (req.side === "SELL") params.push(`quantity=${req.quantity ?? 0}`);
  else params.push(`quoteOrderQty=${req.quoteOrderQty ?? 0}`);
  if (req.clientOrderId) params.push(`newClientOrderId=${req.clientOrderId}`);
  const query = params.join("&");
  return { query, signature: await signBinanceQuery(query, apiSecret) };
}
/**
 * Envía una orden de mercado REAL a Binance y devuelve la ejecución normalizada.
 * Nunca lanza: cualquier fallo se traduce a `ok:false` con código y mensaje.
 */
export async function placeBinanceOrder(req: BinanceOrderRequest): Promise<BinanceOrderResult> {
  const env = req.env;
  const symbol = req.symbol.toUpperCase();
  const side = req.side;
  const rules = req.rules ?? (await getBinanceSymbolRules(symbol, env));

  const quantity = req.quantity ? roundDownToStep(req.quantity, rules.stepSize) : 0;
  const quoteOrderQty = req.quoteOrderQty ? Number(req.quoteOrderQty.toFixed(2)) : 0;

  // Pre-validación local: evita enviar órdenes que Binance rechazaría por tamaño.
  if (side === "SELL") {
    if (quantity <= 0) return fail(env, "invalid_quantity", "La cantidad a vender es cero.");
    if (quantity < rules.minQty) {
      return fail(
        env,
        "below_min_qty",
        `La cantidad ${quantity} ${symbol} está por debajo del mínimo permitido (${rules.minQty}).`,
      );
    }
  } else if (quoteOrderQty <= 0) {
    return fail(env, "invalid_amount", "El importe de la compra es cero.");
  } else if (quoteOrderQty < rules.minNotional) {
    return fail(
      env,
      "below_min_notional",
      `El importe ${quoteOrderQty} ${rules.quote} está por debajo del mínimo de Binance (${rules.minNotional} ${rules.quote}). Sube el capital del bot.`,
    );
  }

  let signed: { query: string; signature: string };
  try {
    signed = await buildBinanceMarketOrderQuery(
      { symbol, side, quantity, quoteOrderQty, clientOrderId: req.clientOrderId },
      req.apiSecret,
    );
  } catch {
    return fail(env, "sign_failed", "No se pudo firmar la petición con el secreto guardado.");
  }

  let res: Response;
  try {
    res = await fetch(`${BINANCE_HOSTS[env]}/api/v3/order`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": req.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${signed.query}&signature=${signed.signature}`,
    });
  } catch (error) {
    return fail(env, "network_error", error instanceof Error ? error.message : "Fallo de red");
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    if (isBinanceGeoRestricted(res.status, raw)) {
      return fail(
        env,
        GEO_RESTRICTED_CODE,
        "Binance no acepta órdenes desde la ubicación del servidor actual (restricción geográfica, no es un problema con tus claves).",
        true,
      );
    }
    let code = `http_${res.status}`;
    let detail = raw.replace(/\s+/g, " ").slice(0, 300);
    try {
      const parsed = JSON.parse(raw) as { code?: number; msg?: string };
      if (parsed.code !== undefined) code = String(parsed.code);
      if (parsed.msg) detail = parsed.msg;
    } catch {
      // Cuerpo no JSON: se conserva el texto recortado.
    }
    return fail(env, code, detail || `Binance respondió ${res.status}`);
  }

  let payload: {
    orderId?: number;
    status?: string;
    executedQty?: string;
    cummulativeQuoteQty?: string;
    fills?: { price?: string; commission?: string; commissionAsset?: string }[];
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return fail(env, "bad_response", "Binance devolvió una respuesta ilegible.");
  }

  const executedQty = Number(payload.executedQty ?? 0);
  const quoteQty = Number(payload.cummulativeQuoteQty ?? 0);
  if (!Number.isFinite(executedQty) || executedQty <= 0) {
    return fail(
      env,
      "not_filled",
      `Binance no ejecutó la orden (estado ${payload.status ?? "desconocido"}).`,
    );
  }
  const commission = (payload.fills ?? []).reduce((sum, f) => {
    const asset = (f.commissionAsset ?? "").toUpperCase();
    if (asset !== rules.quote) return sum;
    return sum + Number(f.commission ?? 0);
  }, 0);

  return {
    ok: true,
    env,
    status: payload.status ?? "FILLED",
    orderId: payload.orderId ? String(payload.orderId) : null,
    executedQty,
    quoteQty,
    price: quoteQty > 0 ? Number((quoteQty / executedQty).toFixed(8)) : 0,
    commission,
    errorCode: null,
    errorMessage: null,
    geoRestricted: false,
  };
}

/** Precio actual del par (público, sin credenciales). Devuelve null si falla. */
export async function fetchBinancePrice(
  symbol: string,
  env: BinanceTradingEnv,
): Promise<number | null> {
  const upper = symbol.toUpperCase();
  const hosts = [BINANCE_HOSTS[env]];
  if (env === "production") hosts.push("https://data-api.binance.vision");
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/api/v3/ticker/price?symbol=${encodeURIComponent(upper)}`);
      if (!res.ok) continue;
      const body = (await res.json()) as { price?: string };
      const price = Number(body.price ?? 0);
      if (Number.isFinite(price) && price > 0) return price;
    } catch {
      // Se prueba el siguiente host.
    }
  }
  return null;
}
