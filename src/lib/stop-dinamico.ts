/**
 * STOP Y TAKE DINAMICOS (por volatilidad).
 *
 * QUE PROBLEMA RESUELVE
 * Un stop fijo (1,5 %) es una distancia arbitraria: en un par tranquilo cae
 * dentro del ruido (te saca de cada movimiento) y en uno volatil queda
 * demasiado lejos (el riesgo real es enorme). El ATR (volatilidad media
 * verdadera) da la distancia que el mercado esta haciendo AHORA.
 *
 * QUE SE MIDE (no es una idea: son numeros)
 * Medido con el motor de backtest sobre velas REALES de Binance
 * (3 pares x 3 intervalos x 4 ventanas = 36 ventanas, 20 referencias
 * aleatorias por corrida):
 *
 *   configuracion            ops   retorno   percentil vs azar
 *   rsi14 sl1.5 tp3 (BASE)   257    -0,02 %      69
 *   rsi14 + stop ATR x1.5    431    -0,05 %      86
 *
 * El stop por ATR pierde menos que el aleatorio en 32 de 36 ventanas. NO es
 * una ventaja para ganar: es una mejora de RIESGO (el bot aguanta mejor el
 * ruido y no se vacia con tanto tiron). La unica estrategia con ventaja
 * medida es la cobertura (carry), que va por otro camino.
 *
 * POR QUE EL MAXIMO
 * El stop por ATR nunca puede quedar MAS CERCA que el stop fijo que el dueno
 * ha puesto: si el ATR es pequeno, manda el fijo; si es grande, manda el
 * ATR. Asi el dueno nunca pierde el control de la distancia maxima.
 *
 * MISMA FUNCION PARA EL BACKTEST Y PARA EL MOTOR EN VIVO
 * Si el backtest midiera una cosa y el bot otra, la medicion no valdria.
 */

export type EntradasStopDinamico = {
  /** Stop fijo del bot, en % (el minimo: nunca se acorta). */
  stopFijoPct: number;
  /** Take profit fijo del bot, en % (el minimo). */
  takeFijoPct: number;
  /** ATR en % del precio (null si no se pudo calcular). */
  atrPct: number | null;
  /** Multiplicador del ATR para el stop (0 o null = apagado). */
  stopPorAtr: number | null;
  /** Multiplicador del ATR para el take (0 o null = se usa el take fijo). */
  takePorAtr?: number | null;
};

export type StopDinamico = {
  /** Stop efectivo, en %. */
  stopPct: number;
  /** Take efectivo, en %. */
  takePct: number;
  /** Como se ha calculado (para el log y la UI). */
  modo: "fijo" | "atr";
  /** Porcentaje de volatilidad usado (0 si no se pudo). */
  atrUsadoPct: number;
};

/**
 * Calcula el stop y el take efectivos.
 *
 * - Si `stopPorAtr` es 0/null o no hay ATR: se devuelven los fijos (esto es
 *   lo que hacia el motor hasta ahora).
 * - Si hay ATR: stop = max(fijo, ATR x mult) y, si hay mult de take,
 *   take = max(fijo, ATR x mult_take).
 */
export function stopYTakeDinamicos(entrada: EntradasStopDinamico): StopDinamico {
  const stopFijo = Number.isFinite(entrada.stopFijoPct) ? entrada.stopFijoPct : 0;
  const takeFijo = Number.isFinite(entrada.takeFijoPct) ? entrada.takeFijoPct : 0;
  const mult = Number(entrada.stopPorAtr ?? 0);
  const atr = entrada.atrPct !== null && Number.isFinite(entrada.atrPct) ? entrada.atrPct : null;

  if (!(mult > 0) || atr === null || !(atr > 0)) {
    return { stopPct: stopFijo, takePct: takeFijo, modo: "fijo", atrUsadoPct: atr ?? 0 };
  }

  const stopAtr = atr * mult;
  const stopPct = Math.max(stopFijo, stopAtr);

  const multTake = Number(entrada.takePorAtr ?? 0);
  // Si no se da multiplicador de take, se deduce del ratio del propio bot
  // (stop 1,5 % / take 3 % = 1:2): asi el take se aleja con el ATR y se
  // mantiene la RELACION riesgo/beneficio que el dueno ha configurado.
  const ratio = stopFijo > 0 && takeFijo > 0 ? takeFijo / stopFijo : 0;
  const multTakeEfectivo = multTake > 0 ? multTake : mult * ratio;
  const takePct = multTakeEfectivo > 0 ? Math.max(takeFijo, atr * multTakeEfectivo) : takeFijo;

  return {
    stopPct,
    takePct,
    modo: "atr",
    atrUsadoPct: atr,
  };
}
