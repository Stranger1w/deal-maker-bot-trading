/**
 * Registro de estrategias de tamaño.
 *
 * El orden es el que ve el usuario en el modal, de menor a mayor riesgo.
 */

import {
  agresiva,
  factorAgresiva,
  FRASE_ACEPTACION,
  MAX_NIVEL,
  MAX_PERDIDAS_CONSECUTIVAS,
} from "./aggressive";
import {
  conservadora,
  factorConservadora,
  MIN_FACTOR as MIN_FACTOR_CONSERVADORA,
} from "./conservative";
import { fija } from "./fixed";
import { factorOptima, MAX_FACTOR as MAX_FACTOR_OPTIMA, optima } from "./optimal";
import {
  decidir,
  estadoInicial,
  type StrategyContext,
  type StrategyDef,
  type StrategyState,
} from "./types";

export const ESTRATEGIAS: StrategyDef[] = [fija, conservadora, optima, agresiva];

export const ESTRATEGIA_POR_DEFECTO = "fixed";

export function buscarEstrategia(id: string): StrategyDef | null {
  return ESTRATEGIAS.find((e) => e.id === id) ?? null;
}

export type FilaRacha = {
  /** Operacion de la racha, empezando en 1. */
  paso: number;
  /** Escalon de martingala en ese momento (0 si la estrategia no lo usa). */
  nivel: number;
  factor: number;
  /** Monto que se operaria, o null si el motor lo omitiria por minNotional. */
  monto: number | null;
  recortado: boolean;
  /** La estrategia pidio pausar el motor en este paso. */
  pausa: boolean;
};

/**
 * Tabla de montos para una racha de perdidas. Es lo que muestra "Mostrar
 * detalles" en la tarjeta, para que el usuario vea a donde le lleva la racha
 * ANTES de hacerla. Simula `rachas` perdidas seguidas desde el estado inicial.
 */
export function tablaDeRacha(
  estrategiaId: string,
  rachas: number,
  ctx: StrategyContext,
  params: Record<string, number> = {},
): FilaRacha[] {
  const def = buscarEstrategia(estrategiaId);
  if (!def) return [];
  let estado = estadoInicial();
  const filas: FilaRacha[] = [];
  for (let i = 0; i < rachas; i++) {
    const decision = decidir(def, ctx, estado, params);
    const r = def.registrarResultado(estado, -1, params);
    filas.push({
      paso: i + 1,
      nivel: estado.nivel,
      factor: def.factor(estado, params),
      monto: decision?.monto ?? null,
      recortado: decision?.recortadoPorCapital ?? false,
      pausa: r.pausar,
    });
    estado = r.estado;
    if (r.pausar) break;
  }
  return filas;
}

export {
  agresiva,
  conservadora,
  decidir,
  estadoInicial,
  factorAgresiva,
  factorConservadora,
  factorOptima,
  fija,
  optima,
  FRASE_ACEPTACION,
  MAX_NIVEL,
  MAX_PERDIDAS_CONSECUTIVAS,
  MIN_FACTOR_CONSERVADORA,
  MAX_FACTOR_OPTIMA,
};
export type { StrategyContext, StrategyDef, StrategyState };
