/**
 * Cantidad fija (riesgo bajo).
 *
 * "Opera siempre el mismo monto, sin importar si ganas o pierdes. Es la mas
 * predecible y facil de controlar."
 */

import type { StrategyDef } from "./types";

export const fija: StrategyDef = {
  id: "fixed",
  nombre: "Cantidad fija",
  nivelRiesgo: "bajo",
  descripcionCorta:
    "Opera siempre el mismo monto, sin importar si ganas o pierdes. Es la más predecible y fácil de controlar.",
  detalles: {
    resumen: "El monto nunca cambia. Si ganas y pierdes por igual, llegas al mismo punto.",
    calculo: "Monto = base × 1. Siempre igual, en cada operación y en cada momento.",
  },
  topeFraccionCapital: 0.1,

  factor: () => 1,

  registrarResultado(estado) {
    // Registra las rachas para que el historial se vea, pero el monto no cambia.
    if (estado.pausada) return { estado, pausar: false };
    return { estado, pausar: false };
  },
};
