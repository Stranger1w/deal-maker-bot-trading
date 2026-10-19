/**
 * Walk-forward: validacion fuera de muestra (seccion 6B del plan).
 *
 * QUE PROBLEMA RESUELVE
 * Un bot afinado con los datos de 2024 y evaluado con los mismos datos de
 * 2024 no demuestra nada: es sobreajuste. El walk-forward corta el tiempo en
 * bloques: se ajusta (o se fija) con el pasado y se mide con el FUTURO, que
 * el bot no ha visto.
 *
 * Aqui no hay optimizador de parametros todavia: los parametros son los que
 * le pasa el usuario. Lo que se demuestra aqui es si esos parametros
 * MANTIENEN el resultado en periodos que no se usaron para elegirlos.
 *
 * Es una funcion pura: velas dentro, resultados fuera.
 */

import { ejecutarBacktest } from "./engine";
import type { ConfigBacktest, Metricas, ResultadoBacktest, Vela } from "./types";

export type Fold = {
  indice: number;
  /** Velas del bloque de evaluacion (fuera de muestra). */
  desde: number;
  hasta: number;
  /** Metricas del bloque de evaluacion. */
  fueraDeMuestra: Metricas;
  /** Metricas de todo lo anterior (con los mismos parametros). */
  dentroDeMuestra: Metricas;
  /** true si el resultado se mantuvo fuera de muestra (y no era negativo). */
  estable: boolean;
};

export type ResultadoWalkForward = {
  folds: Fold[];
  /** Resumen agregado de los bloques fuera de muestra. */
  resumen: {
    operaciones: number;
    retornoMedioPct: number;
    retornoPonderadoPct: number;
    maxDrawdownPct: number;
    winRatePct: number;
    /** Bloques fuera de muestra con resultado positivo. */
    bloquesPositivos: number;
    /** Bloques en los que el resultado se mantuvo positivo. */
    bloquesEstables: number;
  };
  /** Aviso honesto sobre lo que esto demuestra. */
  aviso: string;
};

export function walkForward(
  velas: readonly Vela[],
  config: ConfigBacktest,
  opciones: { folds?: number; simbolo?: string; minimoPorFold?: number } = {},
): ResultadoWalkForward {
  const folds = Math.max(2, opciones.folds ?? 4);
  const minimoPorFold = opciones.minimoPorFold ?? 50;
  const total = velas.length;
  const bloque = Math.floor(total / folds);

  const resultados: Fold[] = [];
  for (let i = 0; i < folds; i++) {
    const desde = i * bloque;
    const hasta = i === folds - 1 ? total : (i + 1) * bloque;
    const evaluacion = velas.slice(desde, hasta);
    const historico = velas.slice(0, desde);
    if (evaluacion.length < minimoPorFold) continue;

    const fuera = ejecutarBacktest(evaluacion, config, {
      simbolo: opciones.simbolo ?? "SIMBOLO",
      fueraDeMuestra: true,
    });
    const dentro =
      historico.length >= minimoPorFold
        ? ejecutarBacktest(historico, config, {
            simbolo: opciones.simbolo ?? "SIMBOLO",
            fueraDeMuestra: false,
          })
        : null;

    resultados.push({
      indice: i + 1,
      desde: evaluacion[0]?.time ?? 0,
      hasta: evaluacion[evaluacion.length - 1]?.time ?? 0,
      fueraDeMuestra: fuera.metricas,
      dentroDeMuestra: dentro?.metricas ?? fuera.metricas,
      estable: fuera.metricas.retornoNetoPct > 0,
    });
  }

  const operaciones = resultados.reduce((a, f) => a + f.fueraDeMuestra.operaciones, 0);
  const retornos = resultados.map((f) => f.fueraDeMuestra.retornoNetoPct);
  const retornoMedio = retornos.length ? retornos.reduce((a, b) => a + b, 0) / retornos.length : 0;
  const retornoPonderado =
    resultados.length > 0
      ? resultados.reduce(
          (a, f) => a + f.fueraDeMuestra.retornoNetoPct * f.fueraDeMuestra.operaciones,
          0,
        ) / Math.max(1, operaciones)
      : 0;
  const maxDrawdown = resultados.reduce((a, f) => Math.max(a, f.fueraDeMuestra.maxDrawdownPct), 0);
  const ganadoras = resultados.reduce((a, f) => a + f.fueraDeMuestra.ganadoras, 0);
  const cerradas = resultados.reduce((a, f) => a + f.fueraDeMuestra.operaciones, 0);

  return {
    folds: resultados,
    resumen: {
      operaciones,
      retornoMedioPct: Number(retornoMedio.toFixed(4)),
      retornoPonderadoPct: Number(retornoPonderado.toFixed(4)),
      maxDrawdownPct: Number(maxDrawdown.toFixed(4)),
      winRatePct: cerradas > 0 ? Number(((ganadoras / cerradas) * 100).toFixed(2)) : 0,
      bloquesPositivos: resultados.filter((f) => f.fueraDeMuestra.retornoNetoPct > 0).length,
      bloquesEstables: resultados.filter((f) => f.estable).length,
    },
    aviso:
      "El walk-forward con parametros fijos NO optimiza: solo demuestra si el resultado se mantiene en periodos no usados para elegirlo. Si hay que tocar los parametros para que salga positivo, es sobreajuste.",
  };
}

export type { ResultadoBacktest };
