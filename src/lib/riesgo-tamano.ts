/**
 * Tamaño de la posicion por RIESGO (no por un porcentaje fijo).
 *
 * QUE PROBLEMA RESUELVE
 * Con un tamaño fijo, un bot que gana el 3 % en un par tranquilo se
 * lleva una pérdida del 3 % en un par volatil: el riesgo real de cada
 * operacion es distinto segun el par y el momento. El tamaño correcto sale
 * de cuanto se puede PERDER en esa operacion concreta:
 *
 *   monto = (capital · riesgoPorOperacion) / distanciaDelStop
 *
 * Es la formula clasica de gestion de riesgo por posicion: se arriesga el
 * MISMO porcentaje del capital en cada operacion, y el tamaño se ajusta a
 * la distancia del stop-loss. Con un stop del 2 % y un riesgo del 1 % del
 * capital, la posicion es del 50 % del capital; con un stop del 4 %, del
 * 25 %.
 *
 * Todo aqui es PURO (se puede testear sin mercado) y se combina con la
 * estrategia: el tamaño final es el MENOR entre el que dice el riesgo, el
 * que dice la estrategia y el tope de capital.
 */

export type VelaOHLC = { high: number; low: number; close: number };

/**
 * ATR (Average True Range) de Wilder: la volatilidad media del par.
 * Con 14 velas es el periodo habitual.
 */
export function atr(velas: readonly VelaOHLC[], periodo = 14): number | null {
  if (velas.length < periodo + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < velas.length; i++) {
    const v = velas[i]!;
    const previo = velas[i - 1]!;
    const rango = v.high - v.low;
    const rangoAlto = Math.abs(v.high - previo.close);
    const gapBajo = Math.abs(v.low - previo.close);
    trs.push(Math.max(rango, rangoAlto, gapBajo));
  }
  if (trs.length < periodo) return null;

  let media = trs.slice(0, periodo).reduce((a, b) => a + b, 0) / periodo;
  for (let i = periodo; i < trs.length; i++) {
    media = (media * (periodo - 1) + trs[i]!) / periodo;
  }
  return Number.isFinite(media) && media > 0 ? media : null;
}

/** Volatilidad relativa: el ATR en porcentaje del precio. */
export function atrPct(velas: readonly VelaOHLC[], periodo = 14): number | null {
  const valor = atr(velas, periodo);
  const ultimo = velas[velas.length - 1];
  if (valor === null || !ultimo || ultimo.close <= 0) return null;
  return (valor / ultimo.close) * 100;
}

export type TamanoPorRiesgo = {
  /** true si se puede calcular (falta ATR o stop). */
  ok: boolean;
  /** Monto a operar en la moneda de cotizacion. */
  monto: number;
  /** Porcentaje del capital que se arriesga con el stop. */
  riesgoPct: number;
  /** Distancia del stop en porcentaje (la que se ha usado). */
  stopUsadoPct: number;
  /** Motivo si no se puede calcular. */
  motivo?: string;
};

export type EntradaTamano = {
  /** Capital disponible del bot. */
  capital: number;
  /** Fraccion del capital que se arriesga por operacion (0,01 = 1 %). */
  riesgoPorOperacion: number;
  /**
   * Precio de entrada. NO es necesario para calcular el monto (el monto va
   * en la moneda de cotizacion), pero si se pasa se usa para comprobar que
   * la operacion tiene sentido.
   */
  precio?: number;
  /** Stop-loss en porcentaje. */
  stopLossPct: number;
  /** Tope maximo del capital en una operacion (0,1 = 10 %). */
  topeFraccionCapital: number;
  /** ATR en porcentaje (null si no hay datos). */
  atrPct?: number | null;
  /** Stop en porcentaje derivado del ATR (si se usa sizing por volatilidad). */
  stopPorAtr?: number | null;
};

/**
 * Calcula el monto a operar por riesgo.
 *
 * - El stop sale del stop-loss configurado, o del ATR si se pide sizing por
 *   volatilidad (un stop fijo en un par muy volatil es demasiado estrecho).
 * - El monto nunca supera el tope de capital por operacion.
 * - Si no hay datos de volatilidad, se usa el stop configurado (no se
 *   inventa nada).
 */
export function tamanoPorRiesgo(entrada: EntradaTamano): TamanoPorRiesgo {
  const {
    capital,
    riesgoPorOperacion,
    stopLossPct,
    topeFraccionCapital,
    atrPct: vol,
    stopPorAtr,
  } = entrada;

  if (!(capital > 0)) {
    return { ok: false, monto: 0, riesgoPct: 0, stopUsadoPct: 0, motivo: "Sin capital." };
  }
  if (!(riesgoPorOperacion > 0)) {
    return {
      ok: false,
      monto: 0,
      riesgoPct: 0,
      stopUsadoPct: 0,
      motivo: "El riesgo por operación debe ser mayor que cero.",
    };
  }

  // Distancia del stop: el configurado, o el derivado del ATR si es mayor
  // (un stop fijo en un par volatil queda demasiado pegado al precio).
  let stop = stopLossPct;
  if (stopPorAtr && vol && stopPorAtr > 0) {
    const stopAtr = stopPorAtr * vol;
    if (stopAtr > stop) stop = stopAtr;
  }
  if (!(stop > 0)) {
    return {
      ok: false,
      monto: 0,
      riesgoPct: 0,
      stopUsadoPct: 0,
      motivo: "Falta stop-loss: sin stop no se puede calcular el riesgo.",
    };
  }

  // Monto por riesgo: se arriesga `riesgoPorOperacion` del capital, y la
  // perdida en el stop es `stop` del monto.
  const porRiesgo = (capital * riesgoPorOperacion) / (stop / 100);
  const porTope = capital * (topeFraccionCapital > 0 ? topeFraccionCapital : 1);
  const monto = Math.min(porRiesgo, porTope);
  const riesgoEfectivo = (monto * (stop / 100)) / capital;

  return {
    ok: true,
    monto: Number(monto.toFixed(8)),
    riesgoPct: Number((riesgoEfectivo * 100).toFixed(4)),
    stopUsadoPct: Number(stop.toFixed(4)),
  };
}
