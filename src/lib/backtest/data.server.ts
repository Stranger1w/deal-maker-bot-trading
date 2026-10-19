/**
 * Datos historicos para el backtest (server-only, solo endpoint publico).
 *
 * Las velas viven en src/lib/velas.server.ts porque el motor en vivo tambien
 * las necesita (para alimentar los indicadores). Aqui solo se reexportan.
 */

export { INTERVALOS_MS, parsearKlines, velasDeBinance } from "../velas.server";
export type { OpcionesVelas } from "../velas.server";
