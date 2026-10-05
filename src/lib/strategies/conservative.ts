/**
 * Conservadora (riesgo bajo).
 *
 * "Mantiene el monto base y lo reduce tras perdidas consecutivas (-25% por cada
 * 2 seguidas, minimo 25% del base). Vuelve al base tras una ganancia.
 * Prioriza proteger el capital."
 *
 * factor = max(0.25, 0.75 ^ floor(perdidas_consecutivas / 2))
 */

import type { StrategyDef, StrategyState } from "./types";

export const MIN_FACTOR = 0.25;

export function factorConservadora(perdidas: number): number {
  if (!Number.isFinite(perdidas) || perdidas < 0) return 1;
  const escalones = Math.floor(perdidas / 2);
  return Math.max(MIN_FACTOR, Math.pow(0.75, escalones));
}

export const conservadora: StrategyDef = {
  id: "conservative",
  nombre: "Conservadora",
  nivelRiesgo: "bajo",
  descripcionCorta:
    "Mantiene el monto base y lo reduce tras pérdidas consecutivas (-25% por cada 2 seguidas, mínimo 25% del base). Vuelve al base tras una ganancia. Prioriza proteger el capital.",
  detalles: {
    resumen:
      "Cada dos pérdidas seguidas el monto baja un 25%. En cuanto ganas una, vuelve al monto base completo.",
    calculo:
      "factor = max(0.25, 0.75 ^ floor(pérdidas / 2)). Con 0-1 pérdidas el factor es 1; con 2-3 es 0.75; con 4-5 es 0.5625; con 6-7 es 0.4219; con 8-9 es 0.3164; desde 10 se queda en el suelo de 0.25.",
    advertencia:
      "El suelo del 25% significa que nunca deja de operar por completo: siempre mantiene exposición.",
  },
  topeFraccionCapital: 0.1,

  factor(estado: StrategyState) {
    return factorConservadora(estado.consecutivasPerdidas);
  },

  registrarResultado(estado, pnl) {
    if (estado.pausada) return { estado, pausar: false };
    if (!Number.isFinite(pnl) || pnl === 0) return { estado, pausar: false }; // 0 no cambia rachas
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
