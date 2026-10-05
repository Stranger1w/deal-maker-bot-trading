/**
 * Tipos del motor de estrategias de tamaño.
 *
 * Una estrategia NO decide si se compra o se vende: eso lo dicen los
 * indicadores. Aqui solo se responde a "de cuanto es la proxima operacion",
 * en funcion de como van las ultimas operaciones cerradas.
 *
 * Reglas comunes a todas (las aplica `decidir`):
 *  - El monto se redondea a 2 decimales.
 *  - Ningun monto supera el 10% del saldo disponible (5% para Optima).
 *  - Si tras recortar el monto queda por debajo de minNotional, se devuelve
 *    null: el motor OMITE la operacion, nunca sube el monto para llegar al minimo.
 */

/** Estado de rachas de un bot. Se persiste en engine_strategies. */
export type StrategyState = {
  /** Operaciones cerradas seguidas con P&L > 0. */
  consecutivasGanadas: number;
  /** Operaciones cerradas seguidas con P&L < 0. */
  consecutivasPerdidas: number;
  /** Escalon de martingala (solo Agresiva). */
  nivel: number;
  /** El motor se detuvo por esta estrategia y no debe arrancar solo. */
  pausada: boolean;
  /** Motivo de la pausa, si la hay. */
  motivoPausa?: string;
};

export function estadoInicial(): StrategyState {
  return { consecutivasGanadas: 0, consecutivasPerdidas: 0, nivel: 0, pausada: false };
}

/** Datos que necesita la estrategia para calcular el monto. */
export type StrategyContext = {
  /** Monto base configurado por el usuario (amount_per_trade). */
  base: number;
  /** Saldo disponible del bot. */
  capital: number;
  /** minNotional del par segun las reglas del exchange. */
  minNotional: number;
};

/** Resultado de calcular el monto. */
export type StrategyDecision = {
  monto: number;
  /** Factor que se aplico antes del recorte de capital. */
  factor: number;
  /** El tope de capital recortó el monto. Debe registrarse en el log. */
  recortadoPorCapital: boolean;
};

export type NivelRiesgo = "bajo" | "medio" | "alto";

export type StrategyDef = {
  id: string;
  nombre: string;
  nivelRiesgo: NivelRiesgo;
  descripcionCorta: string;
  detalles: {
    /** Texto para la tarjeta. */
    resumen: string;
    /** Como cambia el monto. */
    calculo: string;
    /** Que riesgo assume de verdad. */
    advertencia?: string;
  };
  /** Fraccion maxima del saldo disponible que puede usarse en una operacion. */
  topeFraccionCapital: number;
  /** La agresiva exige escribir "ACEPTO" antes de poder usarse. */
  requiereAcepto?: boolean;
  /** Solo se permite en cuenta Real si el bot tiene historial en testnet. */
  soloTestnet?: boolean;
  /** Fraccion multiplicadora segun el estado. */
  factor: (estado: StrategyState, params?: Record<string, number>) => number;
  /** Actualiza el estado con el P&L de una operacion recien cerrada. */
  registrarResultado: (
    estado: StrategyState,
    pnl: number,
    params: Record<string, number>,
  ) => { estado: StrategyState; pausar: boolean; motivo?: string };
};

/**
 * Calcula el monto final aplicando el factor, el tope de capital y el
 * redondeo. Devuelve null si el monto queda por debajo de minNotional.
 */
export function decidir(
  def: StrategyDef,
  ctx: StrategyContext,
  estado: StrategyState,
  params: Record<string, number>,
): StrategyDecision | null {
  if (!Number.isFinite(ctx.base) || ctx.base <= 0) return null;
  if (!Number.isFinite(ctx.capital) || ctx.capital <= 0) return null;

  const factor = def.factor(estado, params);
  if (!Number.isFinite(factor) || factor <= 0) return null;

  const bruto = ctx.base * factor;
  const tope = ctx.capital * def.topeFraccionCapital;
  const monto = Math.round(Math.min(bruto, tope) * 100) / 100;
  const recortadoPorCapital = bruto > tope;

  // Por debajo del minimo del exchange: se omite, no se agranda el monto.
  if (monto < ctx.minNotional) return null;

  return { monto, factor, recortadoPorCapital };
}
