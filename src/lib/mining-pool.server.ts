// Pools de minería reales: consulta pública por UID, sin credenciales.
//
// Solo se usan APIs oficiales y públicas de cada pool. Si la pool no responde,
// lo decimos explícitamente (`ok:false`) en vez de inventar hashrate o ganancias:
// mientras un worker esté entrenando (simulado) se muestra simulación; cuando se
// conecta a una pool, los números que se muestran son los reales de esa cuenta.
//
// Monero (XMR) en Nanopool tiene su propio flujo (`fetchMoneroPoolOverview`):
// la pool reparte los datos en varias rutas (`/hashrate`, `/balance`, `/payments`, …)
// y su ruta `/user` está averiada (devuelve `status:false,"Error"` incluso para
// cuentas activas), por lo que la validación se apoya en `/accountexist` + `/hashrate`
// + `/balance` y en la validación local de la dirección Monero.

import { validateMoneroAddress } from "./monero-address";
import { NANOPOOL_LABEL, NANOPOOL_XMR_ENDPOINTS, XMR } from "./nanopool-xmr";

export type PoolId = "hiveon" | "nanopool" | "none";

export type PoolMeta = {
  id: PoolId;
  label: string;
  /** Monedas cubiertas por la API pública. */
  coins: string[];
  /** URL base del endpoint por UID. */
  url: (uid: string, coin: string) => string;
  /** Documentación pública del endpoint. */
  docs: string;
};

export const MINING_POOLS: Record<Exclude<PoolId, "none">, PoolMeta> = {
  hiveon: {
    id: "hiveon",
    label: "Hiveon Pool (legado · GPU/ASIC)",
    coins: ["ETH", "ETC"],
    url: (uid, coin) =>
      `https://${coin.toLowerCase()}-api.hiveon.com/stats/${encodeURIComponent(uid)}`,
    docs: "https://hiveon.com/",
  },
  nanopool: {
    id: "nanopool",
    label: NANOPOOL_LABEL,
    // Monero es la única moneda viable en CPU de esta integración (RandomX).
    coins: [XMR],
    url: (uid) => NANOPOOL_XMR_ENDPOINTS.user(uid),
    docs: "https://xmr.nanopool.org/",
  },
};

export const POOL_IDS = Object.keys(MINING_POOLS) as Exclude<PoolId, "none">[];

/** Normaliza lo que el usuario escribió a un id de pool válido (o "none"). */
export function resolvePoolId(raw: string | null | undefined): PoolId {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return "none";
  if (value.includes("hiveon")) return "hiveon";
  if (value.includes("nano")) return "nanopool";
  return "none";
}

export function poolMeta(raw: string | null | undefined): PoolMeta | null {
  const id = resolvePoolId(raw);
  return id === "none" ? null : MINING_POOLS[id];
}

/** Etiqueta legible para la UI y los logs. */
export function poolLabel(raw: string | null | undefined): string {
  const trimmed = String(raw ?? "").trim();
  return poolMeta(raw)?.label ?? (trimmed || "Sin pool");
}

/**
 * Valida el UID de la pool. Los formatos son alfanuméricos; no aceptamos vacíos,
 * espacios ni valores con pinta de placeholder.
 */
export function isValidPoolUid(raw: string | null | undefined): boolean {
  const uid = String(raw ?? "").trim();
  if (uid.length < 3 || uid.length > 128) return false;
  if (/\s/.test(uid)) return false;
  if (!/^[A-Za-z0-9._:@+-]+$/.test(uid)) return false;
  return !/^(uid|tu-uid|xxx+|test|ejemplo)$/i.test(uid);
}

/**
 * Valida la wallet de Monero que se usa como UID en Nanopool: formato, longitud,
 * prefijo de red y checksum. Es local (sin red), así que sirve antes de consultar.
 */
export function validateXmrWallet(raw: string | null | undefined) {
  return validateMoneroAddress(raw);
}

export type PoolStats = {
  ok: boolean;
  pool: string;
  poolLabel: string;
  uid: string;
  coin: string;
  /** Hashrate reportado por la pool, en H/s. */
  hashrate: number;
  /** Media de 24 h si la pool la publica. */
  hashrate24h: number;
  /** Saldo confirmado pendiente de pago. */
  balance: number;
  /** Saldo sin confirmar. */
  unconfirmed: number;
  /** Total pagado histórico. */
  paid: number;
  /** Workers activos según la pool. */
  workers: number;
  fetchedAt: string;
  error: string | null;
};

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Consulta las estadísticas reales de un worker en su pool (API pública por UID).
 * Nunca lanza: si algo falla devuelve `ok:false` con el motivo.
 */
export async function fetchPoolStats(
  pool: string | null | undefined,
  uid: string,
  coin: string,
  timeoutMs = 8000,
): Promise<PoolStats> {
  const meta = poolMeta(pool);
  const base: PoolStats = {
    ok: false,
    pool: meta?.id ?? "none",
    poolLabel: meta?.label ?? "Sin pool",
    uid,
    coin: coin.toUpperCase(),
    hashrate: 0,
    hashrate24h: 0,
    balance: 0,
    unconfirmed: 0,
    paid: 0,
    workers: 0,
    fetchedAt: new Date().toISOString(),
    error: null,
  };

  if (!meta) {
    return { ...base, error: "Pool no soportada: usa Hiveon o Nanopool." };
  }
  if (!isValidPoolUid(uid)) {
    return { ...base, error: "UID de pool inválido." };
  }
  if (!meta.coins.includes(coin.toUpperCase())) {
    return { ...base, error: `${meta.label} no cubre ${coin.toUpperCase()} en su API pública.` };
  }

  // Monero en Nanopool se reparte en varias rutas: ver `fetchMoneroPoolOverview`.
  if (meta.id === "nanopool" && coin.toUpperCase() === XMR) {
    const overview = await fetchMoneroPoolOverview(uid, { timeoutMs });
    return {
      ...base,
      ok: overview.ok,
      hashrate: overview.hashrate,
      hashrate24h: overview.avgHashrate.h24 || overview.hashrate,
      balance: overview.balance,
      unconfirmed: overview.unconfirmed,
      paid: overview.paidTotal,
      workers: overview.workersActive,
      error: overview.error,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(meta.url(uid, coin.toUpperCase()), {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ...base, error: `${meta.label} respondió HTTP ${res.status}.` };
    }
    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(raw));
    } catch {
      return { ...base, error: `${meta.label} devolvió una respuesta ilegible.` };
    }
    const status = pick(payload, ["status"]);
    if (status === false) {
      const message = pick(payload, ["error", "message"]);
      return { ...base, error: String(message ?? "La pool rechazó la consulta.") };
    }
    // Hiveon anida la información bajo `stats`; Nanopool bajo `data`.
    const data = { ...asRecord(payload["stats"]), ...asRecord(payload["data"]) };
    const source = Object.keys(data).length ? data : payload;
    const avg = asRecord(pick(source, ["avgHashrate", "hashrate_avg"]));
    const workersRaw = pick(source, ["workers"]);
    const workers = Array.isArray(workersRaw)
      ? workersRaw.length
      : num(pick(source, ["workers_count", "activeWorkers"]));

    const hashrate = num(pick(source, ["hashrate", "hashRate", "reportedHashrate", "hashrate_1h"]));
    const hashrate24h =
      num(
        pick(avg, ["h24", "h12", "h6", "h3", "h1"]) ??
          pick(source, ["hashrate_24h", "hashrate24h", "avg_hashrate"]),
      ) || hashrate;

    return {
      ...base,
      ok: true,
      hashrate,
      hashrate24h,
      balance: num(pick(source, ["balance"])),
      unconfirmed: num(pick(source, ["unconfirmed_balance", "unconfirmed"])),
      paid: num(pick(source, ["paid", "total_paid", "payouts_sum"])),
      workers,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ...base,
      error: aborted
        ? `La pool ${meta.label} no respondió a tiempo.`
        : `No se pudo consultar ${meta.label}: ${error instanceof Error ? error.message : "error de red"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------- NANOPOOL · MONERO (XMR) ------------------------- */

export type MoneroPayment = {
  /** Hash de la transacción del pago en la red Monero. */
  txHash: string;
  amount: number;
  /** ISO 8601 (la pool devuelve epoch en segundos). */
  date: string;
  confirmed: boolean;
};

export type MoneroHashratePoint = { date: string; hashrate: number };

export type MoneroAvgHashrate = { h1: number; h3: number; h6: number; h12: number; h24: number };

export type MoneroPoolOverview = {
  ok: boolean;
  pool: "nanopool";
  poolLabel: string;
  coin: "XMR";
  wallet: string;
  /** "standard" | "subaddress" | "integrated" cuando la dirección es válida. */
  addressKind: string | null;
  addressValid: boolean;
  addressMessage: string;
  /** La pool conoce la wallet (aunque ahora mismo no reporte hashrate). */
  accountExists: boolean;
  /** Hay un minero reportando ahora mismo. */
  hasActivity: boolean;
  /** Explicación lista para la UI (estado "sin actividad"). */
  activityNote: string | null;
  hashrate: number;
  avgHashrate: MoneroAvgHashrate;
  /** Saldo confirmado pendiente de pago, en XMR. */
  balance: number;
  unconfirmed: number;
  paidTotal: number;
  paymentsCount: number;
  paidLast24h: number;
  workersActive: number;
  lastShareAt: string | null;
  payments: MoneroPayment[];
  /** Últimas ~24 h de hashrate real (una muestra cada 10 min). */
  history: MoneroHashratePoint[];
  poolHashrate: number | null;
  poolActiveWorkers: number | null;
  /** La ruta `/user` respondió con datos (hoy en XMR devuelve `status:false`). */
  userEndpointWorking: boolean;
  fetchedAt: string;
  error: string | null;
};

type JsonResult = { ok: boolean; payload: Record<string, unknown> | null; error: string | null };

const ZERO_AVG: MoneroAvgHashrate = { h1: 0, h3: 0, h6: 0, h12: 0, h24: 0 };

async function getJson(url: string, timeoutMs: number): Promise<JsonResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    const raw = await res.text();
    if (!res.ok) return { ok: false, payload: null, error: `HTTP ${res.status}` };
    return { ok: true, payload: asRecord(JSON.parse(raw) as unknown), error: null };
  } catch (error) {
    return {
      ok: false,
      payload: null,
      error:
        error instanceof Error && error.name === "AbortError" ? "tiempo agotado" : "error de red",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** `data` de una respuesta de Nanopool, solo si `status` no es `false`. */
function nanopoolData(result: JsonResult): unknown {
  if (!result.ok || !result.payload) return undefined;
  if (result.payload["status"] === false) return undefined;
  return result.payload["data"];
}

function epochToIso(value: unknown): string | null {
  const seconds = num(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Reúne las estadísticas reales de una wallet Monero en Nanopool a partir de sus
 * rutas públicas (`/user`, `/hashrate`, `/balance`, `/payments`, medias, workers,
 * histórico y contexto de la pool). Nunca lanza: si la pool no responde devuelve
 * `ok:false`; si responde pero la wallet no tiene minero, `ok:true` + `hasActivity:false`.
 */
export async function fetchMoneroPoolOverview(
  wallet: string,
  options: { timeoutMs?: number; history?: boolean; poolContext?: boolean } = {},
): Promise<MoneroPoolOverview> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const address = validateMoneroAddress(wallet);
  const base: MoneroPoolOverview = {
    ok: false,
    pool: "nanopool",
    poolLabel: NANOPOOL_LABEL,
    coin: "XMR",
    wallet: address.address,
    addressKind: address.ok ? address.kind : null,
    addressValid: address.ok,
    addressMessage: address.message,
    accountExists: false,
    hasActivity: false,
    activityNote: null,
    hashrate: 0,
    avgHashrate: { ...ZERO_AVG },
    balance: 0,
    unconfirmed: 0,
    paidTotal: 0,
    paymentsCount: 0,
    paidLast24h: 0,
    workersActive: 0,
    lastShareAt: null,
    payments: [],
    history: [],
    poolHashrate: null,
    poolActiveWorkers: null,
    userEndpointWorking: false,
    fetchedAt: new Date().toISOString(),
    error: null,
  };

  if (!address.ok) return { ...base, error: address.message };

  const skipped: JsonResult = { ok: false, payload: null, error: "omitido" };
  const [
    account,
    user,
    hashrate,
    balance,
    avg,
    workers,
    payments,
    history,
    poolHashrate,
    poolWorkers,
  ] = await Promise.all([
    getJson(NANOPOOL_XMR_ENDPOINTS.accountExist(address.address), timeoutMs),
    getJson(NANOPOOL_XMR_ENDPOINTS.user(address.address), timeoutMs),
    getJson(NANOPOOL_XMR_ENDPOINTS.hashrate(address.address), timeoutMs),
    getJson(NANOPOOL_XMR_ENDPOINTS.balance(address.address), timeoutMs),
    getJson(NANOPOOL_XMR_ENDPOINTS.avgHashrate(address.address), timeoutMs),
    getJson(NANOPOOL_XMR_ENDPOINTS.workers(address.address), timeoutMs),
    getJson(NANOPOOL_XMR_ENDPOINTS.payments(address.address), timeoutMs),
    options.history === false
      ? Promise.resolve(skipped)
      : getJson(NANOPOOL_XMR_ENDPOINTS.history(address.address), timeoutMs),
    options.poolContext === false
      ? Promise.resolve(skipped)
      : getJson(NANOPOOL_XMR_ENDPOINTS.poolHashrate, timeoutMs),
    options.poolContext === false
      ? Promise.resolve(skipped)
      : getJson(NANOPOOL_XMR_ENDPOINTS.poolActiveWorkers, timeoutMs),
  ]);

  const accountData = nanopoolData(account);
  const hashrateData = nanopoolData(hashrate);
  const balanceData = nanopoolData(balance);
  const userData = asRecord(nanopoolData(user));

  // Si ninguna ruta base respondió, el problema es la pool (no la wallet).
  if (!account.ok && !hashrate.ok && !balance.ok) {
    const reason = account.error ?? hashrate.error ?? balance.error ?? "sin respuesta";
    return { ...base, error: `Nanopool no respondió (${reason}). Reintenta en unos minutos.` };
  }

  return buildOverview(base, {
    accountData,
    hashrateData,
    balanceData,
    userData,
    userEndpointWorking: user.payload?.["status"] === true,
    avg: nanopoolData(avg),
    workers: nanopoolData(workers),
    payments: nanopoolData(payments),
    history: nanopoolData(history),
    poolHashrate: nanopoolData(poolHashrate),
    poolWorkers: nanopoolData(poolWorkers),
  });
}

type OverviewInput = {
  accountData: unknown;
  hashrateData: unknown;
  balanceData: unknown;
  userData: Record<string, unknown>;
  userEndpointWorking: boolean;
  avg: unknown;
  workers: unknown;
  payments: unknown;
  history: unknown;
  poolHashrate: unknown;
  poolWorkers: unknown;
};

/** Normaliza la respuesta cruda de Nanopool al contrato que consume la UI. */
function buildOverview(base: MoneroPoolOverview, input: OverviewInput): MoneroPoolOverview {
  const hashrate = num(input.hashrateData);
  const avgData = asRecord(input.avg);
  const avgHashrate: MoneroAvgHashrate = {
    h1: num(avgData["h1"]),
    h3: num(avgData["h3"]),
    h6: num(avgData["h6"]),
    h12: num(avgData["h12"]),
    h24: num(avgData["h24"]),
  };

  const workersList = Array.isArray(input.workers) ? (input.workers as unknown[]) : [];
  const workersActive = workersList.length;
  const lastShareAt =
    workersList
      .map((row) => epochToIso(asRecord(row)["lastShare"]))
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;

  // La pool crea la cuenta en el primer share: `/accountexist` o cualquiera de las
  // rutas de la cuenta contestando con `status:true` significa que la wallet existe.
  const accountExists =
    input.accountData !== undefined ||
    input.hashrateData !== undefined ||
    input.balanceData !== undefined ||
    Object.keys(input.userData).length > 0;

  const hasActivity = hashrate > 0 || workersActive > 0;
  const activityNote = hasActivity
    ? null
    : accountExists
      ? "Sin actividad — conecta un minero (XMRig) a esta wallet."
      : "Nanopool todavía no registra esta wallet: aparecerá en cuanto XMRig envíe el primer share.";

  const seen = new Set<string>();
  const payments: MoneroPayment[] = (
    Array.isArray(input.payments) ? (input.payments as unknown[]) : []
  )
    .map((row) => {
      const record = asRecord(row);
      return {
        txHash: String(record["txHash"] ?? record["tx_hash"] ?? ""),
        amount: num(record["amount"]),
        date: epochToIso(record["date"]) ?? new Date(0).toISOString(),
        confirmed: record["confirmed"] !== false,
      };
    })
    .filter((payment) => {
      if (payment.amount <= 0 || !payment.txHash || seen.has(payment.txHash)) return false;
      seen.add(payment.txHash);
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const dayAgo = Date.now() - 24 * 3600_000;
  const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const paidLast24h = payments
    .filter((payment) => Date.parse(payment.date) >= dayAgo)
    .reduce((sum, payment) => sum + payment.amount, 0);

  const history: MoneroHashratePoint[] = (
    Array.isArray(input.history) ? (input.history as unknown[]) : []
  )
    .map((row) => {
      const date = epochToIso(asRecord(row)["date"]);
      return date ? { date, hashrate: num(asRecord(row)["hashrate"]) } : null;
    })
    .filter((point): point is MoneroHashratePoint => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-144);

  const poolHashrate = num(input.poolHashrate);
  const poolWorkers = num(input.poolWorkers);

  return {
    ...base,
    ok: true,
    accountExists,
    hasActivity,
    activityNote,
    hashrate,
    avgHashrate,
    balance: num(input.balanceData),
    unconfirmed: num(input.userData["unconfirmed_balance"]),
    paidTotal,
    paymentsCount: payments.length,
    paidLast24h,
    workersActive,
    lastShareAt,
    payments,
    history,
    poolHashrate: poolHashrate > 0 ? poolHashrate : null,
    poolActiveWorkers: poolWorkers > 0 ? poolWorkers : null,
    userEndpointWorking: input.userEndpointWorking,
  };
}

/**
 * Precio XMR/USD público (Kraken, sin API key) para valorar los pagos en USD.
 * Si falla devuelve `null`: entonces la UI muestra el importe sin conversión.
 */
export async function fetchXmrUsdPrice(timeoutMs = 6000): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.kraken.com/0/public/Ticker?pair=XMRUSD", {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = asRecord((await res.json()) as unknown);
    const result = asRecord(payload["result"]);
    const ticker = asRecord(Object.values(result)[0]);
    const last = Array.isArray(ticker["c"]) ? num((ticker["c"] as unknown[])[0]) : 0;
    return last > 0 ? last : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
