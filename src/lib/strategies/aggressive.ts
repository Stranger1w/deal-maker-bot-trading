/**
 * Agresiva (riesgo alto, con candado).
 *
 * "Aumenta el monto tras cada perdida para recuperarla mas rapido (escalado
 * tipo martingala limitado). Una mala racha puede consumir gran parte del
 * capital."
 *
 * factor = 2 ^ nivel, con nivel 0..3  ->  1x, 2x, 4x, 8x
 *
 * TOPES DUROS, no negociables:
 *  - El nivel nunca pasa de 3, asi que el factor nunca supera 8.
 *  - Al alcanzar maxPerdidasConsecutivas (4 por defecto) el motor se PAUSA.
 *  - Al pausarse, el nivel NO se reinicia solo: el usuario tiene que arrancar
 *    el motor de nuevo, y al arrancar vuelve a 0.
 *
 * Exige escribir "ACEPTO" y esta prohibida en cuenta Real hasta que el bot
 * tenga historial en testnet.
 */

import type { StrategyDef, StrategyState } from "./types";

export const MAX_NIVEL = 3;
export const MAX_PERDIDAS_CONSECUTIVAS = 4;
export const FRASE_ACEPTACION = "ACEPTO";

export function factorAgresiva(nivel: number): number {
  if (!Number.isFinite(nivel)) return 1;
  // El tope duro: pase lo que pase, el factor nunca supera 8.
  const seguro = Math.min(MAX_NIVEL, Math.max(0, Math.floor(nivel)));
  return Math.pow(2, seguro);
}

export const agresiva: StrategyDef = {
  id: "aggressive",
  nombre: "Agresiva",
  nivelRiesgo: "alto",
  descripcionCorta:
    "Aumenta el monto tras cada pérdida para recuperarla más rápido (escalado tipo martingala limitado). Una mala racha puede consumir gran parte del capital.",
  detalles: {
    resumen:
      "Duplica el monto en cada pérdida: 1x, 2x, 4x y 8x. Al ganar una operación vuelve al monto base.",
    calculo:
      "factor = 2^nivel con nivel de 0 a 3 (1x, 2x, 4x, 8x). Tras una pérdida sube un nivel; tras una ganancia vuelve a 0.",
    advertencia:
      "Al llegar a 4 pérdidas seguidas el motor se pausa y el nivel no se reinicia solo: hay que arrancarlo de nuevo. Con un monto base de 20 y un saldo de 1000, la cuarta pérdida operaría con 100 (el tope del 10%), no con 160.",
  },
  topeFraccionCapital: 0.1,
  requiereAcepto: true,
  soloTestnet: true,

  factor(estado: StrategyState) {
    return factorAgresiva(estado.nivel);
  },

  registrarResultado(estado, pnl, params) {
    if (estado.pausada) return { estado, pausar: false };
    if (!Number.isFinite(pnl) || pnl === 0) return { estado, pausar: false };

    const maxPerdidas = params["maxPerdidasConsecutivas"] ?? MAX_PERDIDAS_CONSECUTIVAS;

    if (pnl > 0) {
      // Una ganancia reinicia el escalado por completo.
      return {
        estado: {
          ...estado,
          consecutivasGanadas: estado.consecutivasGanadas + 1,
          consecutivasPerdidas: 0,
          nivel: 0,
        },
        pausar: false,
      };
    }

    const perdidas = estado.consecutivasPerdidas + 1;
    const nivel = Math.min(MAX_NIVEL, estado.nivel + 1);

    if (perdidas >= maxPerdidas) {
      return {
        estado: {
          ...estado,
          consecutivasPerdidas: perdidas,
          consecutivasGanadas: 0,
          nivel,
          pausada: true,
        },
        pausar: true,
        motivo: `Agresiva: ${perdidas} pérdidas seguidas (tope ${maxPerdidas}). El motor se pausa y el nivel no se reinicia solo.`,
      };
    }

    return {
      estado: { ...estado, consecutivasPerdidas: perdidas, consecutivasGanadas: 0, nivel },
      pausar: false,
    };
  },
};
