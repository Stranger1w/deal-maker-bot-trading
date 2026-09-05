// Diagnóstico de la ubicación efectiva del backend (server-only).
// Evidencia real, sin secretos: centro de datos/país de salida y respuesta pública de Binance.

import { isBinanceGeoRestricted, safeBinanceError } from "./binance-region";

export type RegionProbe = {
  platform: string;
  colo: string | null;
  country: string | null;
  binanceStatus: number | null;
  binanceRestricted: boolean;
  detail: string;
  checkedAt: string;
};

function detectPlatform(): string {
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "";
  if (ua.includes("Cloudflare-Workers")) return "Cloudflare Workers (edge gestionado por Lovable Cloud)";
  if (typeof process !== "undefined" && process.versions?.node) return "Node.js (servidor local/escritorio)";
  return "Desconocida";
}

/** Ejecuta la comprobación y la persiste como evidencia auditable. */
export async function probeRegion(): Promise<RegionProbe> {
  const platform = detectPlatform();
  let colo: string | null = null;
  let country: string | null = null;

  try {
    const trace = await fetch("https://cloudflare.com/cdn-cgi/trace");
    const text = await trace.text();
    colo = /(^|\n)colo=(.+)/.exec(text)?.[2]?.trim() ?? null;
    country = /(^|\n)loc=(.+)/.exec(text)?.[2]?.trim() ?? null;
  } catch {
    // Sin conectividad al servicio de trazas: se sigue con la prueba de Binance.
  }

  let binanceStatus: number | null = null;
  let binanceRestricted = false;
  let detail = "";

  try {
    const res = await fetch("https://api.binance.com/api/v3/ping");
    binanceStatus = res.status;
    const body = await res.text().catch(() => "");
    binanceRestricted = !res.ok && isBinanceGeoRestricted(res.status, body);
    detail = res.ok ? "Endpoint público de Binance accesible" : safeBinanceError(res.status, body);
  } catch (error) {
    detail = `No se pudo contactar con Binance: ${error instanceof Error ? error.message : "error de red"}`;
  }

  const probe: RegionProbe = {
    platform,
    colo,
    country,
    binanceStatus,
    binanceRestricted,
    detail,
    checkedAt: new Date().toISOString(),
  };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("backend_region_probes").insert({
      platform,
      colo,
      country,
      binance_status: binanceStatus,
      binance_restricted: binanceRestricted,
      detail,
    });
  } catch {
    // La evidencia se devuelve igual aunque falle el registro.
  }

  return probe;
}
