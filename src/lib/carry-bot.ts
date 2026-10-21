/**
 * EL BOT DE COBERTURA (carry): decide si abrir, mantener o cerrar.
 *
 * QUE ES
 * Comprar el spot y vender el perpetuo. El perpetuo suele cotizar por encima
 * del spot, y esa diferencia (la cuota de financiacion) la paga el que esta
 * vendido en el perpetuo. Es un ingreso que NO depende de la direccion del
 * precio: por eso es la unica estrategia medida que funciona.
 *
 * LAS REGLAS (y por que)
 *  - Abrir: el perpetuo esta por encima del spot (basis positivo) y la
 *    financiacion media de los ultimos periodos es positiva. Si el basis es
 *    enorme (> 1 %), puede desmontarse de golpe: no se entra.
 *  - Mantener: la financiacion sigue positiva.
 *  - Cerrar: la financiacion se vuelve negativa (N periodos seguidos) o el
 *    perpetuo pasa por debajo del spot (el basis se invierte y la cobertura
 *    deja de cobrar).
 *
 * TODO AQUI ES PURO: se puede testear sin internet y sin Binance.
 */

export type AccionCobertura = "abrir" | "mantener" | "cerrar";

export type DecisionCobertura = {
  accion: AccionCobertura;
  /** Por que se toma esa decision (se escribe en el log del bot). */
  motivo: string;
  /** El "basis" (perp - spot) en %. */
  basePct: number;
  /** La financiacion media de los ultimos periodos (%). */
  mediaCuotasPct: number;
  /** La ultima cuota de financiacion (%). */
  ultimaCuotaPct: number;
};

export type OpcionesCobertura = {
  /** true si el bot ya tiene las dos patas abiertas. */
  tienePosicion: boolean;
  /** El "basis" actual (perp - spot) en %. */
  basePct: number;
  /** La financiacion media de los ultimos periodos (%). */
  mediaCuotasPct: number;
  /** La ultima cuota de financiacion (%). */
  ultimaCuotaPct: number;
  /** Cuotas negativas SEGUIDAS desde la ultima positiva (para cerrar). */
  periodosNegativos: number;
  /** El basis minimo para abrir (0,05 % = 5 puntos basicos). */
  umbralBasePct?: number;
  /** El basis maximo para abrir (1 %): si es mas ancho, puede desmontarse. */
  umbralBaseMaxPct?: number;
  /** Cuotas negativas seguidas para cerrar (2). */
  umbralPeriodosNegativos?: number;
};

export const UMBRAL_BASE_MIN = 0.05;
export const UMBRAL_BASE_MAX = 1;
export const UMBRAL_PERIODOS_NEGATIVOS = 2;

/**
 * Decide que hacer con las dos patas del carry.
 */
export function decidirCobertura(args: OpcionesCobertura): DecisionCobertura {
  const umbralBase = args.umbralBasePct ?? UMBRAL_BASE_MIN;
  const umbralBaseMax = args.umbralBaseMaxPct ?? UMBRAL_BASE_MAX;
  const umbralNegativos = args.umbralPeriodosNegativos ?? UMBRAL_PERIODOS_NEGATIVOS;

  const base = {
    basePct: args.basePct,
    mediaCuotasPct: args.mediaCuotasPct,
    ultimaCuotaPct: args.ultimaCuotaPct,
  };

  if (!args.tienePosicion) {
    if (args.basePct < umbralBase) {
      return {
        ...base,
        accion: "mantener",
        motivo: `El perpetuo cotiza ${args.basePct.toFixed(3)} % por debajo del spot: no hay diferencia que cobrar.`,
      };
    }
    if (args.basePct > umbralBaseMax) {
      return {
        ...base,
        accion: "mantener",
        motivo: `El basis es de ${args.basePct.toFixed(3)} % (muy ancho): si se desmonta de golpe, la cobertura se queda sin la diferencia que la hace rentable. No se entra.`,
      };
    }
    if (args.mediaCuotasPct <= 0) {
      return {
        ...base,
        accion: "mantener",
        motivo: `La financiacion media de los ultimos periodos es ${args.mediaCuotasPct.toFixed(4)} %: no se cobra por vender el perpetuo.`,
      };
    }
    return {
      ...base,
      accion: "abrir",
      motivo: `Basis de ${args.basePct.toFixed(3)} % y financiacion media de ${args.mediaCuotasPct.toFixed(4)} %: se abre la cobertura.`,
    };
  }

  // Con las dos patas abiertas.
  if (args.basePct <= 0) {
    return {
      ...base,
      accion: "cerrar",
      motivo: `El perpetuo ha pasado por debajo del spot (basis ${args.basePct.toFixed(3)} %): la cobertura ya no cobra, se cierra.`,
    };
  }
  if (args.periodosNegativos >= umbralNegativos) {
    return {
      ...base,
      accion: "cerrar",
      motivo: `${args.periodosNegativos} cuotas de financiacion negativas seguidas: se cierra la cobertura.`,
    };
  }
  return {
    ...base,
    accion: "mantener",
    motivo: `La cobertura sigue cobrando (financiacion media ${args.mediaCuotasPct.toFixed(4)} %): se mantiene.`,
  };
}

/**
 * El P&L de la cobertura, en fraccion del capital-coverto.
 *
 *   P&L = (spot final - spot inicial) + (perp inicial - perp final) + cuotas
 *
 * Las dos primeras se cancelan casi siempre (por eso el carry depende de las
 * cuotas, no de la direccion). Las cuotas son las que la financiacion ha
 * pagado de verdad (se leen de la cuenta de futuros).
 */
export function pnlCobertura(args: {
  spotInicial: number;
  spotFinal: number;
  perpInicial: number;
  perpFinal: number;
  /** Las cuotas cobradas en total (fraccion, positivo = cobradas). */
  cuotas: number;
  /** Las comisiones de las cuatro ordenes (fraccion del nocional). */
  comisiones?: number;
}): number {
  const { spotInicial, spotFinal, perpInicial, perpFinal, cuotas } = args;
  const pnlSpot = (spotFinal - spotInicial) / spotInicial;
  const pnlPerpCorto = (perpInicial - perpFinal) / perpInicial;
  return pnlSpot + pnlPerpCorto + cuotas - (args.comisiones ?? 0);
}
