/**
 * Tipos compartidos del motor de trading.
 *
 * Reglas de diseno (se respetan en todas las fases):
 *  - Una IndicatorDef es una FUNCION PURA: recibe cierres y parametros, devuelve
 *    una senal. Sin I/O, sin red, sin base de datos. Asi es testeable y el
 *    backtest usa exactamente el mismo codigo que el motor en vivo.
 *  - Ningun indicador decide por si solo si se compra o se vende cuando hay
 *    varios seleccionados: esa combinacion vive en `combineSignals`.
 */

/** Direccion de una senal. `null` significa "sin senal" (se mantiene la posicion). */
export type SignalDirection = "buy" | "sell" | null;

/** Parametro editable de un indicador. */
export type IndicatorParam = {
  /** Clave estable, se persiste en indicator_params. */
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  help?: string;
};

/**
 * Como falla el indicador, para explicarselo al usuario sin adivinar.
 * Se calcula en `diagnose`, no dentro de `signal`.
 */
export type IndicatorFailure =
  | "datos_insuficientes"
  | "rango_lateral"
  | "tendencia_fuerte"
  | "senal_tardia"
  | "ruido"
  | "ninguno";

/** Ficha completa de un indicador tecnico. */
export type IndicatorDef = {
  id: string;
  nombre: string;
  /** Una linea, tal cual aparece en la tarjeta. */
  descripcionCorta: string;
  /** Que mide, como genera la senal, cuando falla. Se despliega en "Mostrar detalles". */
  detalles: {
    queMide: string;
    comoSenala: string;
    cuandoFalla: string;
    aviso?: string;
  };
  parametros: IndicatorParam[];
  /**
   * Funcion pura. `closes` son cierres ordenados de mas antiguo a mas reciente.
   * Solo usa los ultimos `lookback` valores que necesite cada indicador.
   */
  signal: (closes: number[], params: Record<string, number>) => SignalDirection;
  /**
   * Diagnostico del contexto actual: por que la senal es debil o inexistente.
   * Opcional: no todos los indicadores saben autodiagnosticarse.
   */
  diagnose?: (
    closes: number[],
    params: Record<string, number>,
  ) => { failure: IndicatorFailure; detalle: string };
  /** Minimo de velas necesarias. Si hay menos, no hay senal. */
  minSamples: number;
  /** El AI Indicator necesita historial propio del bot: se explica aparte. */
  requiereHistorial?: boolean;
  /** Minimo de operaciones historicas antes de que el AI intervene. */
  minMuestras?: number;
};

/** Serie de precio compartida por todos los indicadores. */
export type PriceSeries = {
  closes: number[];
  volumes?: number[];
  highs?: number[];
  lows?: number[];
  /** Marca de tiempo de cada cierre (ISO), para el AI Indicator (hora del dia). */
  times?: string[];
};
