/**
 * Tipos del motor de backtesting.
 *
 * REGLA DE DISENO (la importante)
 * El backtest usa las MISMAS funciones puras que el motor en vivo:
 *  - `senalDe` de src/lib/indicators (los 7 indicadores)
 *  - `decidir` de src/lib/strategies (el tamaño de la operacion)
 * Si el motor en vivo y el backtest usaran codigos distintos, el backtest
 * no mediria nada real.
 *
 * El backtest es PURO: no toca base de datos, ni red, ni el reloj. Recibe
 * velas y devuelve un resultado. Asi se puede testear y comparar rapido.
 */

import type { StrategyDef } from "../strategies/types";
import type { PriceSeries, SignalDirection } from "../indicators/types";

/** Vela OHLCV ya cerrada. */
export type Vela = {
  /** Apertura de la vela en milisegundos epoch. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Costes de ejecucion (los que se comen la ganancia). */
export type Costes = {
  /** Comision por lado, en fraccion (0.001 = 0,1 % de Binance spot). */
  comision: number;
  /** Slippage por lado, en fraccion del precio (0.001 = 0,1 %). */
  slippage: number;
  /** Descuento por pagar la comision con BNB (0.1 = 10 % de descuento). */
  descuentoBnb: number;
};

/** Reglas del simbolo en el exchange (Binance). */
export type ReglasSimbolo = {
  stepSize: number;
  minQty: number;
  minNotional: number;
};

export type ConfigBacktest = {
  /** Capital inicial en la moneda de cotizacion (USDT). */
  capitalInicial: number;
  /** Fraccion del capital usada por operacion (el motor en vivo usa 0,02). */
  fraccionPorOperacion: number;
  /** Stop loss en porcentaje (obligatorio: sin SL no se opera). */
  stopLossPct: number;
  /** Take profit en porcentaje. */
  takeProfitPct: number;
  /** Maximo de operaciones por dia (0 = sin limite). */
  maxOperacionesDia?: number;
  /**
   * Estrategia de tamaño (la misma del motor en vivo: src/lib/strategies).
   * Si se indica, el monto de cada operacion lo calcula `decidir`.
   */
  estrategia?: StrategyDef;
  /** Tope de capital total. */
  maxCapital?: number;
  /** Tope por operacion como fraccion del capital (5 % en la estrategia Optima). */
  topeFraccionCapital?: number;
  costes: Costes;
  reglas?: ReglasSimbolo;
  /** Ids de indicadores (los de src/lib/indicators). */
  indicadores: string[];
  /**
   * Señal personalizada (en vez de la de los indicadores). Sirve para la
   * referencia ALEATORIA: el MISMO motor (mismas reglas de salida, mismo
   * tamaño, mismos costes) pero con una entrada al azar. Si la estrategia
   * real no gana a esa referencia, no hay ventaja: solo hay suerte.
   */
  senal?: (serie: PriceSeries) => SignalDirection;
  /** Parametros por indicador. */
  parametros?: Record<string, Record<string, number>>;
  /** Parametros de la estrategia (formato plano, como los de src/lib/strategies). */
  parametrosEstrategia?: Record<string, number>;
  /** Etiqueta libre para identificar la corrida. */
  etiqueta?: string;
};

/** Una operacion cerrada. */
export type Operacion = {
  lado: "buy" | "sell";
  /** Precio de entrada (con slippage). */
  precioEntrada: number;
  /** Precio de salida (con slippage). */
  precioSalida: number;
  cantidad: number;
  /** P&L NETO (ya con comisiones y slippage). */
  pnl: number;
  /** P&L bruto (sin costes), para poder ver cuanto se comieron. */
  pnlBruto: number;
  /** Comisiones pagadas (entrada + salida), en dinero. */
  comisiones: number;
  /** Slippage pagado (entrada + salida), en dinero. */
  costeSlippage: number;
  /** Coste total (comisiones + slippage) en dinero. */
  costes: number;
  /** Efectivo recibido al cerrar (antes de la comision de salida). */
  efectivo: number;
  /** Momento de entrada (epoch ms). */
  entrada: number;
  /** Momento de salida (epoch ms). */
  salida: number;
  /** Motivo de salida. */
  motivo: "take_profit" | "stop_loss" | "senal" | "fin_datos";
  /** Duracion en milisegundos. */
  duracionMs: number;
};

/** Metricas de la corrida. */
export type Metricas = {
  capitalInicial: number;
  capitalFinal: number;
  /** Retorno neto en porcentaje. */
  retornoNetoPct: number;
  /** P&L neto en dinero. */
  pnlNeto: number;
  /** Drawdown maximo en porcentaje (sobre el pico de la curva de capital). */
  maxDrawdownPct: number;
  /** Numero de operaciones cerradas. */
  operaciones: number;
  /** Operaciones ganadoras / perdedoras. */
  ganadoras: number;
  perdedoras: number;
  /** Win rate en porcentaje. */
  winRatePct: number;
  /** Ganancia media por operacion. */
  expectancy: number;
  /** Suma de ganancias / suma de perdidas (absolutas). */
  profitFactor: number;
  /** Coste total (comisiones + slippage) en dinero. */
  costeTotal: number;
  /** Coste total como porcentaje del capital inicial. */
  costePct: number;
  /** Sharpe simple (retorno por operacion / desviacion). */
  sharpe: number;
  /** Sortino simple (retorno por operacion / desviacion negativa). */
  sortino: number;
  /** Duracion total en milisegundos. */
  duracionMs: number;
};

export type ResultadoBacktest = {
  etiqueta: string;
  simbolo: string;
  velas: number;
  desde: number;
  hasta: number;
  metricas: Metricas;
  operaciones: Operacion[];
  /** Curva de capital (un punto por vela cerrada). */
  curva: number[];
  /** Comparacion con comprar y mantener en el mismo periodo, con los mismos costes. */
  benchmark: {
    retornoPct: number;
    pnlNeto: number;
    /** El backtest supero al benchmark? */
    superar: boolean;
  };
  /** Avisos honestos: lo que el resultado NO demuestra. */
  avisos: string[];
};
