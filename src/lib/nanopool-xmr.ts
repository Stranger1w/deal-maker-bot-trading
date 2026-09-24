// Nanopool · Monero (XMR): endpoints públicos y datos de conexión del minero.
// Módulo sin dependencias de servidor: las URLs se usan desde los server functions
// y las constantes de stratum/comando desde la UI de /mineria.

export const XMR = "XMR";
export const NANOPOOL_ID = "nanopool";
export const NANOPOOL_LABEL = "Nanopool (Monero · CPU)";
export const NANOPOOL_DOCS = "https://xmr.nanopool.org/";

const BASE = "https://api.nanopool.org/v1/xmr";

/**
 * Endpoints públicos de Nanopool para XMR (sin API key).
 * Documentación: https://xmr.nanopool.org/api
 */
export const NANOPOOL_XMR_ENDPOINTS = {
  /** Datos completos de la cuenta. En XMR esta ruta está averiada en la pool. */
  user: (wallet: string) => `${BASE}/user/${encodeURIComponent(wallet)}`,
  /** `status:true` + "Account exist" cuando la pool conoce la wallet. */
  accountExist: (wallet: string) => `${BASE}/accountexist/${encodeURIComponent(wallet)}`,
  /** Hashrate actual en H/s. `status:false` = sin minero reportando. */
  hashrate: (wallet: string) => `${BASE}/hashrate/${encodeURIComponent(wallet)}`,
  /** Saldo confirmado pendiente de pago, en XMR. */
  balance: (wallet: string) => `${BASE}/balance/${encodeURIComponent(wallet)}`,
  /** Historial de pagos reales de la pool. */
  payments: (wallet: string) => `${BASE}/payments/${encodeURIComponent(wallet)}`,
  /** Medias de hashrate (h1, h3, h6, h12, h24) en H/s. */
  avgHashrate: (wallet: string) => `${BASE}/avghashrate/${encodeURIComponent(wallet)}`,
  /** Workers activos de la cuenta. */
  workers: (wallet: string) => `${BASE}/workers/${encodeURIComponent(wallet)}`,
  /** Serie histórica de hashrate (una muestra cada 10 minutos). */
  history: (wallet: string) => `${BASE}/history/${encodeURIComponent(wallet)}`,
  /** Contexto de la pool (hashrate total y workers activos). */
  poolHashrate: `${BASE}/pool/hashrate`,
  poolActiveWorkers: `${BASE}/pool/activeworkers`,
} as const;

/** Endpoints exigidos por el flujo de XMR real (los que consulta el dashboard). */
export const NANOPOOL_XMR_REQUIRED_ENDPOINTS = [
  NANOPOOL_XMR_ENDPOINTS.user,
  NANOPOOL_XMR_ENDPOINTS.hashrate,
  NANOPOOL_XMR_ENDPOINTS.balance,
  NANOPOOL_XMR_ENDPOINTS.payments,
] as const;

/**
 * Stratum de Nanopool para XMR. Hosts y puertos verificados por DNS + conexión TCP;
 * no se inventan servidores que no existan.
 */
export const NANOPOOL_XMR_STRATUM = {
  servers: [
    { region: "Europa", host: "xmr-eu1.nanopool.org" },
    { region: "Europa 2", host: "xmr-eu2.nanopool.org" },
    { region: "EE. UU. este", host: "xmr-us-east1.nanopool.org" },
    { region: "EE. UU. oeste", host: "xmr-us-west1.nanopool.org" },
    { region: "Asia", host: "xmr-asia1.nanopool.org" },
  ],
  /** Puerto stratum estándar. */
  port: 14444,
  /** Puerto para conexión cifrada (`--tls`). */
  tlsPort: 14433,
  /** Algoritmo de Monero: RandomX, minado por CPU. */
  algorithm: "RandomX (CPU)",
} as const;

/** Nanopool actualiza las estadísticas cada pocos minutos: no refrescamos en tiempo real. */
export const XMR_REFRESH_OPTIONS = [
  { value: 60000, label: "Cada 1 minuto" },
  { value: 120000, label: "Cada 2 minutos" },
  { value: 300000, label: "Cada 5 minutos (recomendado)" },
] as const;

export const XMR_REFRESH_DEFAULT_MS = 300000;
export const XMR_REFRESH_STORAGE_KEY = "dealmaker:xmr-refresh-ms";

/** Comando listo para pegar en PowerShell/CMD con XMRig apuntando a esta wallet. */
export function xmrigCommand(options: {
  wallet: string;
  workerName?: string;
  host?: string;
  port?: number;
  tls?: boolean;
}): string {
  const host = options.host ?? NANOPOOL_XMR_STRATUM.servers[0].host;
  const port =
    options.port ?? (options.tls ? NANOPOOL_XMR_STRATUM.tlsPort : NANOPOOL_XMR_STRATUM.port);
  const worker = (options.workerName ?? "dealmaker").replace(/\s+/g, "-").slice(0, 32);
  const tls = options.tls ? " --tls" : "";
  return `xmrig.exe -a rx/0 -o ${host}:${port} -u ${options.wallet}.${worker} -p x --donate-level 1${tls}`;
}
