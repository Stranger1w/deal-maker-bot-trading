// Detección de restricción geográfica de Binance (módulo puro, usable en cliente y servidor).
// No contiene secretos ni credenciales.

export const GEO_RESTRICTED_CODE = "binance_geo_restricted";

export const GEO_RESTRICTED_MESSAGE =
  "Binance no está disponible desde la ubicación del servidor actual. Esta es una restricción geográfica de Binance, no un problema con tus claves.";

export const GEO_RESTRICTED_HINTS = [
  "Verifica en la documentación oficial de Binance la lista de países y territorios admitidos para tu cuenta y para el uso de la API.",
  "Usa una región o plataforma de despliegue oficialmente admitida por Binance para alojar el backend que firma las peticiones.",
  "Si tu jurisdicción usa un dominio distinto (por ejemplo una entidad local de Binance), opera con esa plataforma admitida y sus credenciales.",
  "No intentes eludir la restricción con VPN, proxies o reenvío de tráfico: incumple los términos de Binance y puede bloquear la cuenta.",
];

/**
 * Reconoce la respuesta de ubicación restringida de Binance a partir del
 * estado HTTP y del cuerpo (`msg`/`code`). Cubre HTTP 451 y 403, y el texto
 * "Service unavailable from a restricted location ... Eligibility".
 */
export function isBinanceGeoRestricted(status: number, rawBody: string): boolean {
  const body = rawBody.toLowerCase();
  if (status === 451) return true;
  if (
    body.includes("restricted location") ||
    body.includes("eligibility") ||
    body.includes("service unavailable from a restricted location")
  ) {
    return true;
  }
  // Binance devuelve -1000/-2015 con texto de elegibilidad en algunos entornos.
  return status === 403 && (body.includes("restricted") || body.includes("unavailable"));
}

/** Mensaje seguro para guardar/auditar: sin claves, firmas ni cabeceras. */
export function safeBinanceError(status: number, rawBody: string): string {
  const trimmed = rawBody.replace(/\s+/g, " ").slice(0, 300);
  return `HTTP ${status}${trimmed ? ` · ${trimmed}` : ""}`;
}
