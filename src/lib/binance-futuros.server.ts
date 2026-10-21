// Ordenes REALES en Binance FUTUROS (server-only).
//
// PARA QUE SIRVE
// La estrategia de cobertura (carry) necesita la pata corta: vender el
// perpetuo mientras se compra el spot. Esta es la pata que hace Binance en
// /fapi (los futuros perpetuos), no en /api (el spot).
//
// REGLAS DE SEGURIDAD (las mismas que el modulo de spot)
//  - Testnet primero: solo `BINANCE_TRADING_ENV=production` envia ordenes a
//    produccion. En testnet se usa el testnet de futuros.
//  - Las claves llegan ya descifradas; aqui nunca se escriben en logs ni se
//    devuelven.
//  - Los errores se normalizan (codigo + mensaje) para auditarlos.
//  - Se respetan las reglas del simbolo (stepSize / minQty / minNotional).
//
// LO QUE NO HACE
// No abre posiciones en modo hedge ni toca nada del spot: solo el perpetuo.

import { signBinanceQuery } from "./crypto.server";
import { isBinanceGeoRestricted, GEO_RESTRICTED_CODE } from "./binance-region";
import { roundDownToStep, type SymbolRules } from "./binance-trading.server";

export type BinanceFuturesEnv = "testnet" | "production";

/** Los hosts de los futuros perpetuos (otra API que el spot). */
export const BINANCE_FUTUROS_HOSTS: Record<BinanceFuturesEnv, string> = {
  testnet: "https://testnet.binancefuture.com",
  production: "https://fapi.binance.com",
};

export type ResultadoOrdenFuturos = {
  ok: boolean;
  env: BinanceFuturesEnv;
  status: string | null;
  orderId: string | null;
  executedQty: number;
  quoteQty: number;
  price: number;
  commission: number;
  errorCode: string | null;
  errorMessage: string | null;
  geoRestricted: boolean;
  partiallyFilled: boolean;
};

function fallo(
  env: BinanceFuturesEnv,
  code: string,
  message: string,
  geoRestricted = false,
): ResultadoOrdenFuturos {
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
    partiallyFilled: false,
  };
}

/**
 * Envia una orden de mercado al perpetuo.
 *
 * @param side "BUY" (cerrar un corto) o "SELL" (abrir un corto)
 */
export async function placeBinanceFuturesOrder(req: {
  env: BinanceFuturesEnv;
  apiKey: string;
  apiSecret: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  rules: SymbolRules;
  clientOrderId?: string;
  /** Si es true, la orden reduce la posicion (no la aumenta). */
  reduceOnly?: boolean;
}): Promise<ResultadoOrdenFuturos> {
  const { env, symbol, side } = req;
  const rules = req.rules;
  const cantidad = roundDownToStep(req.quantity, rules.stepSize);

  if (cantidad <= 0) return fallo(env, "invalid_quantity", "La cantidad a operar es cero.");
  if (cantidad < rules.minQty) {
    return fallo(
      env,
      "below_min_qty",
      `La cantidad ${cantidad} ${symbol} esta por debajo del minimo permitido (${rules.minQty}).`,
    );
  }
  const nocionalMinimo = (cantidad * rules.minNotional) / Math.max(rules.minQty, 1e-12);
  if (nocionalMinimo < rules.minNotional) {
    return fallo(
      env,
      "below_min_notional",
      `El nocional de la orden en ${symbol} esta por debajo del minimo de Binance (${rules.minNotional} ${rules.quote}).`,
    );
  }

  const params: string[] = [
    `symbol=${symbol.toUpperCase()}`,
    `side=${side}`,
    "type=MARKET",
    "newOrderRespType=FULL",
    `quantity=${cantidad}`,
    `recvWindow=5000`,
    `timestamp=${Date.now()}`,
  ];
  if (req.reduceOnly) params.push("reduceOnly=true");
  if (req.clientOrderId) params.push(`newClientOrderId=${req.clientOrderId}`);
  const query = params.join("&");

  let signature: string;
  try {
    signature = await signBinanceQuery(query, req.apiSecret);
  } catch {
    return fallo(env, "sign_failed", "No se pudo firmar la peticion con el secreto guardado.");
  }

  let res: Response;
  try {
    res = await fetch(`${BINANCE_FUTUROS_HOSTS[env]}/fapi/v1/order`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": req.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `${query}&signature=${signature}`,
    });
  } catch (error) {
    return fallo(env, "network_error", error instanceof Error ? error.message : "Fallo de red");
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    if (isBinanceGeoRestricted(res.status, raw)) {
      return fallo(
        env,
        GEO_RESTRICTED_CODE,
        "Binance no acepta ordenes desde la ubicacion del servidor actual (restriccion geografica, no es un problema con tus claves).",
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
    return fallo(env, code, detail || `Binance respondio ${res.status}`);
  }

  let payload: {
    orderId?: number;
    status?: string;
    executedQty?: string;
    cumQuoteQty?: string;
    avgPrice?: string;
    fills?: { price?: string; commission?: string; commissionAsset?: string }[];
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    return fallo(env, "bad_response", "Binance devolvio una respuesta ilegible.");
  }

  const ejecutado = Number(payload.executedQty ?? 0);
  const nocional = Number(payload.cumQuoteQty ?? 0);
  if (!Number.isFinite(ejecutado) || ejecutado <= 0) {
    return fallo(
      env,
      "not_filled",
      `Binance no ejecuto la orden (estado ${payload.status ?? "desconocido"}).`,
    );
  }
  const comision = (payload.fills ?? []).reduce((sum, f) => {
    const activo = (f.commissionAsset ?? "").toUpperCase();
    if (activo !== rules.quote) return sum;
    return sum + Number(f.commission ?? 0);
  }, 0);
  const precio = nocional > 0 ? nocional / ejecutado : Number(payload.avgPrice ?? 0);
  const estado = (payload.status ?? "FILLED").toUpperCase();

  return {
    ok: true,
    env,
    status: estado,
    orderId: payload.orderId ? String(payload.orderId) : null,
    executedQty: ejecutado,
    quoteQty: nocional,
    price: Number(precio.toFixed(8)),
    commission: comision,
    errorCode: null,
    errorMessage: null,
    geoRestricted: false,
    partiallyFilled: estado === "PARTIALLY_FILLED",
  };
}

/**
 * true si la clave tiene el permiso de futuros activado.
 *
 * Se comprueba con una llamada de solo lectura a la cuenta de futuros. Si
 * Binance responde con un error de API key, es que el permiso no esta
 * activado en la clave (en Binance: "Enable Futures" en la API key).
 */
export async function tienePermisoFuturos(args: {
  env: BinanceFuturesEnv;
  apiKey: string;
  apiSecret: string;
}): Promise<{ ok: boolean; motivo: string | null }> {
  const query = `recvWindow=5000&timestamp=${Date.now()}`;
  let signature: string;
  try {
    signature = await signBinanceQuery(query, args.apiSecret);
  } catch {
    return { ok: false, motivo: "No se pudo firmar la peticion." };
  }
  try {
    const res = await fetch(
      `${BINANCE_FUTUROS_HOSTS[args.env]}/fapi/v2/account?${query}&signature=${signature}`,
      {
        headers: { "X-MBX-APIKEY": args.apiKey },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (res.ok) return { ok: true, motivo: null };
    const raw = await res.text().catch(() => "");
    let detalle = raw.replace(/\s+/g, " ").slice(0, 200);
    try {
      const parsed = JSON.parse(raw) as { msg?: string };
      if (parsed.msg) detalle = parsed.msg;
    } catch {
      // Cuerpo no JSON.
    }
    return {
      ok: false,
      motivo: `La clave no puede operar en futuros: ${detalle}. En Binance, activa el permiso "Enable Futures" de la API key.`,
    };
  } catch (error) {
    return {
      ok: false,
      motivo: `No se pudo comprobar el permiso de futuros: ${error instanceof Error ? error.message : "error desconocido"}`,
    };
  }
}
