/**
 * Optima (riesgo medio).
 *
 * "Ajusta el monto segun una fraccion del capital disponible y el rendimiento
 * reciente: sube un poco tras rachas ganadoras (tope +50%) y baja tras
 * perdidas. Equilibra crecimiento y proteccion."
 *
 * factor = clamp(1 + 0.10 * racha_ganadas - 0.15 * racha_perdidas, 0.5, 1.5)
 *
 * Solo cuenta la racha actual: en cuanto hay una operacion contraria, la otra
 * racha vuelve a cero.
 */

import type { StrategyDef, StrategyState } from "./types";

export const SUBNIDA_POR_GANADA = 0.1;
export const BAJA_POR_PERDIDA = 0.15;
export const MIN_FACTOR = 0.5;
export const MAX_FACTOR = 1.5;

export function factorOptima(ganadas: number, perdidas: number): number {
  if (!Number.isFinite(ganadas) || ganadas < 0) ganadas = 0;
  if (!Number.isFinite(perdidas) || perdidas < 0) perdidas = 0;
  const bruto = 1 + SUBNIDA_POR_GANADA * ganadas - BAJA_POR_PERDIDA * perdidas;
  return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, bruto));
}

export const optima: StrategyDef = {
  id: "optimal",
  nombre: "Óptima",
  nivelRiesgo: "medio",
  descripcionCorta:
    "Ajusta el monto según una fracción del capital disponible y el rendimiento reciente: sube un poco tras rachas ganadoras (tope +50%) y baja tras pérdidas. Equilibra crecimiento y protección.",
  detalles: {
    resumen:
      "Crece cuando llevas varias ganancias seguidas y se encoge cuando encadenas pérdidas, sin pasarse nunca de la mitad ni del doble y media.",
    calculo:
      "factor = clamp(1 + 0.10 × racha_ganadoras − 0.15 × racha_perdidas, 0.5, 1.5). Solo cuenta la racha actual.",
    advertencia:
      "Usa un tope de capital más estricto que el resto: ninguna operación pasa del 5% del saldo disponible, frente al 10% de las demás.",
  },
  // La Óptima es la única con tope del 5%.
  topeFraccionCapital: 0.05,

  factor(estado: StrategyState) {
    return factorOptima(estado.consecutivasGanadas, estado.consecutivasPerdidas);
  },

  registrarResultado(estado, pnl) {
    if (estado.pausada) return { estado, pausar: false };
    if (!Number.isFinite(pnl) || pnl === 0) return { estado, pausar: false };
    if (pnl > 0) {
      return {
        estado: {
          ...estado,
          consecutivasGanadas: estado.consecutivasGanadas + 1,
          consecutivasPerdidas: 0,
        },
        pausar: false,
      };
    }
    return {
      estado: {
        ...estado,
        consecutivasPerdidas: estado.consecutivasPerdidas + 1,
        consecutivasGanadas: 0,
      },
      pausar: false,
    };
  },
};
