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

/**
 * Direccion de una senal. `null` significa "sin senal" (se mantiene la posicion).
 *
 * ATENCION (relevante para la Fase 3, integracion en el motor):
 * en Binance SPOT una senal `sell` significa CERRAR una posicion larga que ya
 * existe. NO abre una posicion corta: el spot no permite vender algo que no
 * tienes. Si el bot no tiene posicion abierta, un `sell` NO DEBE generar una
 * orden de venta, sino omitirse.
 *
 * Los indicadores no saben nada del estado del bot (son funciones puras sobre
 * precios): es el motor quien debe aplicar esta regla al consumir la senal.
 */
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

/**
 * Familia del indicador, para avisar cuando se mezclan estilos opuestos.
 *
 *  - TENDENCIA: busca continuacion (MACD, Precio de cierre).
 *  - REVERSION: busca giro tras un extremo (RSI, Bollinger, Estocastico, CCI).
 *  - FILTRO:    no genera senal propia; modula a los demas (AI Indicator).
 *
 * Mezclar TENDENCIA con REVERSION hace que las senales se contradigan y el
 * motor se quede quieto, asi que el modal avisa. Los de tipo FILTRO quedan
 * fuera de ese aviso: no se oponen a nadie.
 */
export type IndicatorTipo = "tendencia" | "reversion" | "filtro";

/** Ficha completa de un indicador tecnico. */
export type IndicatorDef = {
  id: string;
  nombre: string;
  /** Familia del indicador. Determina el aviso al mezclar. */
  tipo: IndicatorTipo;
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
   * Funcion pura. Recibe la serie OHLCV (solo velas CERRADAS) y los parametros,
   * y devuelve la senal. Cada indicador usa lo que necesita: RSI/MACD/Bollinger
   * solo cierres, Estocastico y CCI tambien highs/lows.
   *
   * Regla de datos: la serie NUNCA debe incluir la vela en curso. Quien la
   * construye ya la descarta con `cerradas()`.
   */
  signal: (series: PriceSeries, params: Record<string, number>) => SignalDirection;
  /**
   * Diagnostico del contexto actual: por que la senal es debil o inexistente.
   * Opcional: no todos los indicadores saben autodiagnosticarse.
   */
  diagnose?: (
    series: PriceSeries,
    params: Record<string, number>,
  ) => { failure: IndicatorFailure; detalle: string };
  /** Minimo de velas necesarias. Si hay menos, no hay senal. */
  minSamples: number;
  /** El AI Indicator necesita historial propio del bot: se explica aparte. */
  requiereHistorial?: boolean;
  /** Minimo de operaciones historicas antes de que el AI intervene. */
  minMuestras?: number;
};

/**
 * Serie de precio compartida por todos los indicadores.
 *
 * IMPORTANTE: solo velas CERRADAS. La vela en curso se descarta antes de
 * llegar aqui (ver `cerradas()` en helpers.ts) porque un cierre provisional
 * puede cambiar y falsearia la senal.
 *
 * `highs`/`lows` son obligatorios solo para Estocastico y CCI. Si faltan, esos
 * indicadores devuelven `null` en vez de inventar un valor.
 */
export type PriceSeries = {
  /** Aperturas, mismo indice que el resto. No las usa ningun indicador por ahora. */
  open: number[];
  /** Cierres, de mas antiguo a mas reciente. Base de RSI, MACD y Bollinger. */
  closes: number[];
  highs: number[];
  lows: number[];
  volumes?: number[];
  /** Marca de tiempo de cada vela (ISO), para el AI Indicator (hora del dia). */
  times?: string[];
};
