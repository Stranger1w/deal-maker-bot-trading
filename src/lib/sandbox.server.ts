/**
 * SANDBOX REAL: el "campo de entrenamiento" deja de inventar resultados.
 *
 * QUE PASABA ANTES
 * El sandbox generaba los numeros con Math.random(): un retorno entre -8 %
 * y +20 %, un drawdown entre 2 % y 14 % y un win rate entre 42 % y 71 %. O
 * sea: una moneda aleatoria con apariencia de simulacion. Los avisos
 * "simulacion acelerada x10" lo hacian aun mas creible.
 *
 * QUE HACE AHORA
 * Descarga las velas REALES de Binance, monta el MISMO motor de backtest que
 * usa el CLI y el motor en vivo (mismas reglas de salida, mismo tamano, mismos
 * costes) y devuelve las cifras que salen de verdad: retorno neto, drawdown,
 * win rate, profit factor, coste y comparacion con comprar y mantener.
 *
 * Si no hay datos (sin internet, par inexistente, velas insuficientes) NO se
 * inventa nada: se devuelve sinDatos=true con el motivo, y el dueno lo ve.
 */

import { ejecutarBacktest } from "./backtest/engine";
import { backtestAleatorio, compararConAleatoria } from "./backtest/aleatorio";
import type { ReferenciaAleatoria } from "./backtest/aleatorio";
import type { ConfigBacktest, Vela } from "./backtest/types";
import { buscarEstrategia } from "./strategies/index";
import { velasDeBinance } from "./velas.server";
import { getBinanceSymbolRules } from "./binance-trading.server";
import { AUX_TRADERS_TAKER, AUX_TRADERS_TOP } from "./indicators/auxiliares";

/**
 * Indicadores que dependen de los datos de positionamiento de Binance.
 * Esos datos solo existen para los ultimos ~30 dias: en un periodo
 * pasado no hay senal (y el motor no inventa ninguna).
 */
const INDICADORES_CON_TRADERS = new Set(["top_traders", "taker_flow"]);

/**
 * Medida de UN indicador por separado.
 *
 * El motor exige que TODOS los indicadores coincidan (es el diseno del
 * motor en vivo: no se cambia aqui). Con muchos indicadores eso significa
 * cero senales, asi que el sandbox mide cada uno por separado para que se
 * vea cual produce senal y cual no.
 */
export type MedidaIndicador = {
  indicador: string;
  operaciones: number;
  retornoPct: number | null;
  winRatePct: number | null;
  benchmarkPct: number | null;
  /** Por que no abrio operaciones (si no abrio ninguna). */
  motivo: string | null;
};

export type EvaluacionUsada = {
  indicadores: string[];
  estrategia: string;
  stopLossPct: number;
  takeProfitPct: number;
  capital: number;
  intervalo: string;
  comisionPct: number;
  slippagePct: number;
};

/** Con datos de verdad: todas las cifras son numeros. */
export type EvaluacionConDatos = {
  /** Periodo realmente medido (ISO): el sandbox tiene que decir que midio. */
  desde: string;
  hasta: string;
  sinDatos: false;
  simbolo: string;
  velas: number;
  operaciones: number;
  retornoPct: number;
  drawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  costePct: number;
  benchmarkPct: number;
  superaBenchmark: boolean;
  /** Lo que el resultado NO demuestra (los avisos del motor). */
  avisos: string[];
  /** Comparacion con la MISMA estrategia pero con la senal al azar. */
  referencia: ReferenciaAleatoria | null;
  /** Medida de cada indicador por separado (cuando no hubo operaciones). */
  porIndicador: MedidaIndicador[];
  motivo: null;
  usado: EvaluacionUsada;
};

/** Sin datos: no se inventa nada y se dice por que. */
export type EvaluacionSinDatos = {
  desde: string;
  hasta: string;
  sinDatos: true;
  simbolo: string;
  velas: number;
  operaciones: 0;
  retornoPct: null;
  drawdownPct: null;
  winRatePct: null;
  profitFactor: null;
  costePct: null;
  benchmarkPct: null;
  superaBenchmark: null;
  avisos: string[];
  referencia: ReferenciaAleatoria | null;
  /** Medida de cada indicador por separado (cuando no hubo operaciones). */
  porIndicador: MedidaIndicador[];
  motivo: string;
  usado: EvaluacionUsada;
};

export type EvaluacionSandbox = EvaluacionConDatos | EvaluacionSinDatos;

type Args = {
  simbolo: string;
  intervalo: string;
  limite: number;
  capital: number;
  stopLossPct: number;
  takeProfitPct: number;
  estrategiaId: string;
  indicadores: string[];
  /** Ignora la cache local y vuelve a descargar (boton "actualizar"). */
  refrescar?: boolean;
  /**
   * Final del periodo a medir (epoch ms). Sin esto se mediria "ahora" en
   * vez del tramo que eligio el dueno.
   */
  hasta?: number;
};

/**
 * Evalua una estrategia con el motor de backtest real.
 *
 * @param args.symbolo par a probar (BTCUSDT)
 * @param args.limite cuantas velas historicas
 */
/**
 * Mide cada indicador POR SEPARADO sobre las mismas velas.
 *
 * El motor en vivo exige que todos los indicadores coincidan, asi que una
 * seleccion de 5 indicadores puede no dar ni una senal en 2.000 velas. En vez
 * de quedarse con un 'no hay resultado', esto dice que indicador produce
 * senal y cuanto dio cada uno por separado.
 */
export function medirIndicadoresPorSeparado(
  velas: ReadonlyArray<Vela>,
  config: ConfigBacktest,
  indicadores: readonly string[],
  simbolo: string,
  aux: Record<string, number[]> | undefined,
): MedidaIndicador[] {
  const salida: MedidaIndicador[] = [];
  for (const id of indicadores) {
    try {
      const r = ejecutarBacktest(
        velas,
        { ...config, indicadores: [id] },
        { simbolo, ...(aux ? { aux } : {}) },
      );
      const m = r.metricas;
      salida.push({
        indicador: id,
        operaciones: m.operaciones,
        retornoPct: m.operaciones ? Number(m.retornoNetoPct.toFixed(2)) : null,
        winRatePct: m.operaciones ? Number(m.winRatePct.toFixed(1)) : null,
        benchmarkPct: Number(r.benchmark.retornoPct.toFixed(2)),
        motivo:
          m.operaciones === 0
            ? "Este indicador no dio ninguna senal en este periodo con estos parametros."
            : null,
      });
    } catch {
      salida.push({
        indicador: id,
        operaciones: 0,
        retornoPct: null,
        winRatePct: null,
        benchmarkPct: null,
        motivo: "No se pudo medir este indicador.",
      });
    }
  }
  return salida;
}
export async function evaluarEstrategia(args: Args): Promise<EvaluacionSandbox> {
  const simbolo = args.simbolo.toUpperCase();
  const indicadores = args.indicadores.length ? args.indicadores : ["close_price"];
  const usado = {
    indicadores: [] as string[],
    estrategia: args.estrategiaId,
    stopLossPct: args.stopLossPct,
    takeProfitPct: args.takeProfitPct,
    capital: args.capital,
    intervalo: args.intervalo,
    comisionPct: 0.1,
    slippagePct: 0.05,
  };

  let velas: Awaited<ReturnType<typeof velasDeBinance>> = [];
  let motivo: string | null = null;
  const conTraders = args.indicadores.some((id) => id === "top_traders" || id === "taker_flow");
  try {
    // Las velas salen de la cache local si estan; si no, de las plataformas.
    // Asi no hay que volver a descargarlo todo en cada medicion.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { velasConCache } = await import("./cache-mercado.server");
    const cache = await velasConCache(supabaseAdmin, simbolo, args.intervalo, args.limite, {
      // Con datos de traders, el precio es de FUTUROS: si no, se mezclarian
      // precios de spot con flujo de futuros.
      mercado: conTraders ? "futuros" : "spot",
      ...(args.hasta !== undefined ? { hasta: args.hasta } : {}),
      ...(args.refrescar ? { refrescar: true } : {}),
    });
    velas = cache.velas;
    if (!velas.length) {
      motivo =
        cache.aviso ??
        `No hay velas de ${simbolo} en ${args.intervalo}. Sin datos no hay resultado: no se inventa ninguno.`;
    }
  } catch (e) {
    motivo = e instanceof Error ? e.message : "No se pudieron descargar las velas.";
  }

  if (!velas.length) {
    return {
      simbolo,
      desde: "",
      hasta: "",
      velas: 0,
      operaciones: 0,
      retornoPct: null,
      drawdownPct: null,
      winRatePct: null,
      profitFactor: null,
      costePct: null,
      benchmarkPct: null,
      superaBenchmark: null,
      avisos: [],
      referencia: null,
      porIndicador: [],
      sinDatos: true,
      motivo:
        motivo ??
        `No hay velas de ${simbolo} en ${args.intervalo}. Sin datos no hay resultado: no se inventa ninguno.`,
      usado: { ...usado, indicadores },
    };
  }

  // Datos de traders reales (posicionamiento de las cuentas grandes y flujo
  // de ordenes), alineados con las velas.
  let aux: Record<string, number[]> | undefined;
  const avisosPrevios: string[] = [];
  let indicadoresMedidos = indicadores;
  if (conTraders) {
    try {
      const { obtenerSeriesTraders, alinearTradersConVelas } = await import("./traders.server");
      const series = await obtenerSeriesTraders(simbolo, "1h", 1000);
      aux = alinearTradersConVelas(velas, series);
    } catch {
      // Sin datos de traders no hay señal de esos indicadores: no se inventa.
      aux = undefined;
    }

    // ¿Los datos de traders existen para ESTE periodo? Binance solo guarda
    // los ultimos ~30 dias: para un rango pasado no hay nada y los
    // indicadores de traders se quedarian sin senal (y el bot no abriria
    // ninguna operacion). En ese caso se mide con los indicadores que si
    // tienen datos, y se dice.
    const claves = indicadoresMedidos.some((id) => id === "top_traders")
      ? [AUX_TRADERS_TOP, AUX_TRADERS_TAKER]
      : [AUX_TRADERS_TAKER];
    const conDato = Math.max(
      0,
      ...claves.map((clave) => (aux?.[clave] ?? []).filter((v) => Number.isFinite(v)).length),
    );
    const cobertura = conDato / Math.max(1, velas.length);
    if (cobertura < 0.5) {
      const quitados = indicadoresMedidos.filter((id) => INDICADORES_CON_TRADERS.has(id));
      indicadoresMedidos = indicadoresMedidos.filter((id) => !INDICADORES_CON_TRADERS.has(id));
      if (!indicadoresMedidos.length) indicadoresMedidos = ["close_price"];
      avisosPrevios.push(
        `Los datos de traders (${quitados.join(", ")}) no existen para ese periodo: Binance solo guarda los ultimos ~30 dias. ` +
          `La medicion se ha hecho con ${indicadoresMedidos.join(", ")}.`,
      );
    }
  }
  const config: ConfigBacktest = {
    capitalInicial: args.capital > 0 ? args.capital : 1000,
    fraccionPorOperacion: 0.02,
    stopLossPct: args.stopLossPct > 0 ? args.stopLossPct : 2,
    takeProfitPct: args.takeProfitPct > 0 ? args.takeProfitPct : 4,
    costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
    indicadores: indicadoresMedidos,
    etiqueta: `${simbolo} ${args.intervalo} ${indicadoresMedidos.join("+")}`,
  };
  const estrategia = buscarEstrategia(args.estrategiaId);
  if (estrategia) config.estrategia = estrategia;

  // Reglas reales del par (stepSize, minNotional): sin esto el backtest
  // permitiria operaciones que Binance no acepta.
  try {
    const reglas = await getBinanceSymbolRules(simbolo, "production");
    config.reglas = {
      stepSize: reglas.stepSize,
      minQty: reglas.minQty,
      minNotional: reglas.minNotional,
    };
  } catch {
    config.reglas = { stepSize: 0.00001, minQty: 0, minNotional: 5 };
  }

  const resultado = ejecutarBacktest(velas, config, {
    simbolo,
    ...(aux ? { aux } : {}),
  });
  const m = resultado.metricas;

  if (m.operaciones === 0) {
    // No hubo ni una operacion. Con varios indicadores es normal: el motor
    // exige que TODOS coincidan. Se mide cada uno por separado para que se
    // vea cual produce senal y cual no (en vez de un 'no hay resultado').
    const porIndicador = medirIndicadoresPorSeparado(
      velas,
      config,
      indicadoresMedidos,
      simbolo,
      aux,
    );
    const detalle = porIndicador
      .map(
        (m2) =>
          `${m2.indicador}: ${m2.operaciones} oper.${m2.retornoPct === null ? "" : ` (${m2.retornoPct} %)`}`,
      )
      .join("; ");
    const explicacion =
      indicadoresMedidos.length > 1
        ? ` Con ${indicadoresMedidos.length} indicadores el motor exige que TODOS coincidan: por eso no se abrio ni una operacion. Medidos por separado: ${detalle}.`
        : ` Medido por separado: ${detalle}.`;
    return {
      sinDatos: true,
      simbolo,
      desde: velas.length ? new Date(velas[0]!.time).toISOString() : "",
      hasta: velas.length ? new Date(velas[velas.length - 1]!.time).toISOString() : "",
      velas: resultado.velas,
      operaciones: 0,
      retornoPct: null,
      drawdownPct: null,
      winRatePct: null,
      profitFactor: null,
      costePct: null,
      benchmarkPct: null,
      superaBenchmark: null,
      avisos: resultado.avisos,
      referencia: null,
      porIndicador,
      motivo: `Con estos parametros no se cerro ninguna operacion en ${resultado.velas} velas: no hay resultado que mostrar.${explicacion}`,
      usado: { ...usado, indicadores: indicadoresMedidos },
    };
  }

  // La REFERENCIA ALEATORIA: la misma estrategia pero con la senal al azar.
  // Sin esto, un bot puede 'ganar' por suerte durante un mes.
  // 20 ejecuciones: suficiente para saber si hay ventaja o es azar.
  const EJECUCIONES_ALEATORIAS = 20;
  const aleatorios: number[] = [];
  for (let i = 0; i < EJECUCIONES_ALEATORIAS; i++) {
    try {
      aleatorios.push(
        backtestAleatorio(velas, config, 1000 + i, { operacionesObjetivo: m.operaciones }),
      );
    } catch {
      // Si una ejecucion falla, se sigue con las que hayan salido.
      break;
    }
  }
  const referencia = compararConAleatoria(m.retornoNetoPct, aleatorios);

  // Avisos: los del motor (que ya dicen lo de "perder menos no es ventaja")
  // mas los propios del sandbox. Se deduplican para no repetir la misma
  // frase dos veces.
  const avisos = [...new Set(resultado.avisos)];
  for (const previo of avisosPrevios) avisos.push(previo);
  if (m.retornoNetoPct <= 0) {
    avisos.push(
      `El resultado es negativo (${m.retornoNetoPct.toFixed(2)} %): con estos parametros, en este periodo, ` +
        `perdia dinero despues de costes.`,
    );
  }
  if (referencia.ejecuciones > 0 && !referencia.mejorQueLaMayoria) {
    avisos.push(
      "Referencia aleatoria: " +
        referencia.veredicto +
        " (20 ejecuciones con la misma estrategia pero la senal al azar).",
    );
  }

  return {
    sinDatos: false,
    simbolo,
    desde: velas.length ? new Date(velas[0]!.time).toISOString() : "",
    hasta: velas.length ? new Date(velas[velas.length - 1]!.time).toISOString() : "",
    velas: resultado.velas,
    operaciones: m.operaciones,
    retornoPct: Number(m.retornoNetoPct.toFixed(2)),
    drawdownPct: Number(m.maxDrawdownPct.toFixed(2)),
    winRatePct: Number(m.winRatePct.toFixed(2)),
    profitFactor: Number(m.profitFactor.toFixed(2)),
    costePct: Number(m.costePct.toFixed(2)),
    benchmarkPct: Number(resultado.benchmark.retornoPct.toFixed(2)),
    superaBenchmark: resultado.benchmark.superar,
    avisos,
    referencia,
    motivo: null,
    porIndicador: [],
    usado: { ...usado, indicadores: indicadoresMedidos },
  };
}
