// Firmas y pruebas de conexión de solo lectura por exchange. SERVER-ONLY.
// Ninguna clave ni firma se registra en logs ni se devuelve al frontend.

import type { ExchangeId } from "./exchanges";

export type ExchangeTestResult = {
  ok: boolean;
  restricted: boolean;
  code: string | null;
  message: string;
};

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function hmac(
  keyData: Uint8Array,
  message: Uint8Array,
  hash: "SHA-256" | "SHA-512",
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyData as unknown as ArrayBuffer,
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message as unknown as ArrayBuffer));
}

async function sha256(message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", message as unknown as ArrayBuffer));
}

/** Restricción geográfica genérica del exchange (no es un problema de claves). */
export function isGeoRestricted(status: number, body: string): boolean {
  const text = body.toLowerCase();
  if (status === 451) return true;
  const hints = [
    "restricted location",
    "eligibility",
    "not available in your country",
    "unavailable in your region",
    "geographic",
    "country is not supported",
    "prohibited jurisdiction",
  ];
  return (status === 403 || status === 401 || status === 400) && hints.some((h) => text.includes(h));
}

export const GEO_MESSAGE = (label: string) =>
  `${label} no está disponible desde la ubicación del servidor actual. Esta es una restricción geográfica del exchange, no un problema con tus claves.`;

function safeBody(raw: string): string {
  // Recorta y limpia: nunca se propagan cabeceras ni firmas.
  return raw.replace(/\s+/g, " ").slice(0, 200);
}

type Creds = { apiKey: string; apiSecret: string; passphrase?: string | undefined };

async function evaluate(
  label: string,
  res: Response,
  extraOk?: (body: string) => string | null,
): Promise<ExchangeTestResult> {
  const raw = await res.text().catch(() => "");
  if (res.ok) {
    const problem = extraOk?.(raw) ?? null;
    if (problem) {
      return { ok: false, restricted: false, code: "api_error", message: problem };
    }
    return { ok: true, restricted: false, code: null, message: "Conexión de solo lectura verificada" };
  }
  if (isGeoRestricted(res.status, raw)) {
    return { ok: false, restricted: true, code: "geo_restricted", message: GEO_MESSAGE(label) };
  }
  return {
    ok: false,
    restricted: false,
    code: `http_${res.status}`,
    message: `${label} respondió ${res.status}: ${safeBody(raw)}`,
  };
}

async function testCoinbase(c: Creds): Promise<ExchangeTestResult> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const path = "/api/v3/brokerage/accounts";
  const sign = toHex(await hmac(enc.encode(c.apiSecret), enc.encode(`${ts}GET${path}`), "SHA-256"));
  const res = await fetch(`https://api.coinbase.com${path}?limit=1`, {
    headers: {
      "CB-ACCESS-KEY": c.apiKey,
      "CB-ACCESS-SIGN": sign,
      "CB-ACCESS-TIMESTAMP": ts,
      "Content-Type": "application/json",
    },
  });
  return evaluate("Coinbase", res);
}

async function testKraken(c: Creds): Promise<ExchangeTestResult> {
  const path = "/0/private/Balance";
  const nonce = Date.now().toString();
  const postData = `nonce=${nonce}`;
  const hashed = await sha256(enc.encode(nonce + postData));
  const message = new Uint8Array(path.length + hashed.length);
  message.set(enc.encode(path), 0);
  message.set(hashed, path.length);
  const sign = toBase64(await hmac(fromBase64(c.apiSecret), message, "SHA-512"));
  const res = await fetch(`https://api.kraken.com${path}`, {
    method: "POST",
    headers: {
      "API-Key": c.apiKey,
      "API-Sign": sign,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: postData,
  });
  return evaluate("Kraken", res, (body) => {
    try {
      const parsed = JSON.parse(body) as { error?: string[] };
      if (parsed.error?.length) return `Kraken rechazó la clave: ${parsed.error.join(", ")}`;
    } catch {
      /* respuesta no JSON */
    }
    return null;
  });
}

async function testBybit(c: Creds): Promise<ExchangeTestResult> {
  const ts = Date.now().toString();
  const recv = "5000";
  const query = "accountType=UNIFIED";
  const sign = toHex(
    await hmac(enc.encode(c.apiSecret), enc.encode(ts + c.apiKey + recv + query), "SHA-256"),
  );
  const res = await fetch(`https://api.bybit.com/v5/account/wallet-balance?${query}`, {
    headers: {
      "X-BAPI-API-KEY": c.apiKey,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv,
      "X-BAPI-SIGN": sign,
    },
  });
  return evaluate("Bybit", res, (body) => {
    try {
      const parsed = JSON.parse(body) as { retCode?: number; retMsg?: string };
      if (parsed.retCode && parsed.retCode !== 0) return `Bybit: ${parsed.retMsg ?? "error"}`;
    } catch {
      /* respuesta no JSON */
    }
    return null;
  });
}

async function testOkx(c: Creds): Promise<ExchangeTestResult> {
  const ts = new Date().toISOString();
  const path = "/api/v5/account/balance";
  const sign = toBase64(await hmac(enc.encode(c.apiSecret), enc.encode(`${ts}GET${path}`), "SHA-256"));
  const res = await fetch(`https://www.okx.com${path}`, {
    headers: {
      "OK-ACCESS-KEY": c.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": c.passphrase ?? "",
      "Content-Type": "application/json",
    },
  });
  return evaluate("OKX", res, (body) => {
    try {
      const parsed = JSON.parse(body) as { code?: string; msg?: string };
      if (parsed.code && parsed.code !== "0") return `OKX: ${parsed.msg || parsed.code}`;
    } catch {
      /* respuesta no JSON */
    }
    return null;
  });
}

async function testKucoin(c: Creds): Promise<ExchangeTestResult> {
  const ts = Date.now().toString();
  const endpoint = "/api/v1/accounts";
  const sign = toBase64(
    await hmac(enc.encode(c.apiSecret), enc.encode(`${ts}GET${endpoint}`), "SHA-256"),
  );
  const passphrase = toBase64(
    await hmac(enc.encode(c.apiSecret), enc.encode(c.passphrase ?? ""), "SHA-256"),
  );
  const res = await fetch(`https://api.kucoin.com${endpoint}`, {
    headers: {
      "KC-API-KEY": c.apiKey,
      "KC-API-SIGN": sign,
      "KC-API-TIMESTAMP": ts,
      "KC-API-PASSPHRASE": passphrase,
      "KC-API-KEY-VERSION": "2",
    },
  });
  return evaluate("KuCoin", res, (body) => {
    try {
      const parsed = JSON.parse(body) as { code?: string; msg?: string };
      if (parsed.code && parsed.code !== "200000") return `KuCoin: ${parsed.msg || parsed.code}`;
    } catch {
      /* respuesta no JSON */
    }
    return null;
  });
}

/** Prueba de solo lectura: consulta saldos, nunca crea órdenes ni mueve fondos. */
export async function testExchange(exchange: ExchangeId, creds: Creds): Promise<ExchangeTestResult> {
  try {
    switch (exchange) {
      case "coinbase":
        return await testCoinbase(creds);
      case "kraken":
        return await testKraken(creds);
      case "bybit":
        return await testBybit(creds);
      case "okx":
        return await testOkx(creds);
      case "kucoin":
        return await testKucoin(creds);
      default:
        return {
          ok: false,
          restricted: false,
          code: "unsupported",
          message: "Binance se configura en su propia tarjeta de esta página.",
        };
    }
  } catch (error) {
    return {
      ok: false,
      restricted: false,
      code: "network_error",
      message: `No se pudo contactar con el exchange: ${
        error instanceof Error ? error.message : "error de red"
      }`,
    };
  }
}
