/**
 * SANDBOX DE COPY TRADING: seguir a los traders REALES.
 *
 * QUE MIDE
 * Con las velas de FUTUROS de Binance y los datos publicos de las cuentas con
 * las posiciones mas grandes ("top trader long/short ratio") y del flujo
 * agresivo de ordenes ("taker buy/sell volume ratio"), mide:
 *
 *  1. la estrategia que sigue el posicionamiento de los grandes,
 *  2. la estrategia que sigue el flujo de ordenes,
 *  3. las dos combinadas,
 *  4. y las compara con la REFERENCIA ALEATORIA (entrar al azar con los
 *     mismos costes) y con comprar y mantener.
 *
 * LO QUE NO HACE
 * No decide que la copia funciona: eso lo dicen los numeros. Con los datos
 * que hay hoy, la conclusion es que copiar a los grandes NO ha funcionado
 * (gana a menos aleatorias de las que gana al azar). La app lo enseña tal
 * cual, porque para eso sirve un sandbox.
 */

import { ejecutarBacktest } from "./backtest/engine";
import type { ConfigBacktest, Vela } from "./backtest/types";
import { backtestAleatorio, compararConAleatoria } from "./backtest/aleatorio";
import { buscarEstrategia } from "./strategies/index";
import { velasDeBinance } from "./velas.server";
import { obtenerSeriesTraders, alinearTradersConVelas } from "./traders.server";
import { getBinanceSymbolRules } from "./binance-trading.server";

export type CopiaTrader = {
  /** Nombre de la estrategia. */
  nombre: string;
  /** Indicadores usados. */
  indicadores: string[];
  /** Retorno neto (%). */
  retornoPct: number;
  /** Drawdown maximo (%). */
  drawdownPct: number;
  /** Win rate (%). */
  winRatePct: number;
  /** Profit factor. */
  profitFactor: number;
  /** Operaciones cerradas. */
  operaciones: number;
  /** Comprar y mantener en el mismo periodo (%). */
  benchmarkPct: number;
  /** Lo supera (con el matiz de mercado a la baja). */
  superaBenchmark: boolean;
  /** Si el benchmark tambien perdia, avisar de que perder menos no es ventaja. */
  benchmarkTambienPerdio: boolean;
  /** Percentil dentro de la referencia aleatoria (0-100). */
  percentilAleatorio: number;
  /** Avisos honestos del motor. */
  avisos: string[];
};

export type ResultadoCopyTrading = {
  simbolo: string;
  velas: number;
  desde: string;
  hasta: string;
  /** Lecturas de traders usadas. */
  lecturasTraders: number;
  /** Copy trading: los grandes. */
  topTraders: CopiaTrader | null;
  /** Copy trading: el flujo. */
  takerFlow: CopiaTrader | null;
  /** Las dos juntas. */
  combinado: CopiaTrader | null;
  /** Conclusion general. */
  veredicto: string;
  /** true si ninguna copia gana a la referencia aleatoria. */
  ningunaCopiaFunciona: boolean;
};

const NOMBRES: Record<string, string> = {
  top_traders: "Posicionamiento de los traders grandes",
  taker_flow: "Flujo real de órdenes",
  close_price: "Precio de cierre",
};

/** Compara una estrategia con la referencia aleatoria (mismos costes). */
function contraAleatoria(
  velas: readonly Vela[],
  config: ConfigBacktest,
  retornoPct: number,
  ejecuciones = 20,
) {
  const aleatorios: number[] = [];
  for (let i = 0; i < ejecuciones; i++) {
    aleatorios.push(backtestAleatorio(velas, config, 1000 + i * 7919, { operacionesObjetivo: 0 }));
  }
  return compararConAleatoria(retornoPct, aleatorios);
}

/**
 * Mide las estrategias de copy trading con datos reales.
 *
 * @param simbolo par a medir (BTCUSDT...)
 * @param limite velas de 1 h (max 2000)
 */
export async function medirCopyTrading(
  simbolo: string,
  limite = 700,
): Promise<ResultadoCopyTrading> {
  const simboloFinal = simbolo.toUpperCase();
  const velas = await velasDeBinance({
    simbolo: simboloFinal,
    intervalo: "1h",
    limite,
    mercado: "futuros",
  });
  const series = await obtenerSeriesTraders(simboloFinal, "1h", 1000);
  const aux = alinearTradersConVelas(velas, series);
  const lecturasTraders = (aux["traders_top_long_short"] ?? []).filter((v) =>
    Number.isFinite(v),
  ).length;

  let reglas = { stepSize: 0.00001, minQty: 0, minNotional: 5 };
  try {
    const r = await getBinanceSymbolRules(simboloFinal, "production");
    reglas = { stepSize: r.stepSize, minQty: r.minQty, minNotional: r.minNotional };
  } catch {
    // Reglas por defecto (como en el resto de la app).
  }

  const base: ConfigBacktest = {
    capitalInicial: 1000,
    fraccionPorOperacion: 0.02,
    stopLossPct: 2,
    takeProfitPct: 4,
    costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
    indicadores: ["top_traders"],
    reglas,
    etiqueta: `${simboloFinal} 1h`,
    ...(buscarEstrategia("fixed") ? { estrategia: buscarEstrategia("fixed")! } : {}),
  };

  const medir = (indicadores: string[]): CopiaTrader | null => {
    const config = { ...base, indicadores };
    const r = ejecutarBacktest(velas, config, { simbolo: simboloFinal, aux });
    const m = r.metricas;
    if (m.operaciones === 0) return null;
    const referencia = contraAleatoria(velas, config, m.retornoNetoPct, 20);
    return {
      nombre: indicadores.map((id) => NOMBRES[id] ?? id).join(" + "),
      indicadores,
      retornoPct: Number(m.retornoNetoPct.toFixed(2)),
      drawdownPct: Number(m.maxDrawdownPct.toFixed(2)),
      winRatePct: Number(m.winRatePct.toFixed(1)),
      profitFactor: Number(m.profitFactor.toFixed(2)),
      operaciones: m.operaciones,
      benchmarkPct: Number(r.benchmark.retornoPct.toFixed(2)),
      superaBenchmark: r.benchmark.superar,
      benchmarkTambienPerdio: r.benchmark.superar && r.benchmark.retornoPct < 0,
      percentilAleatorio: referencia.percentil,
      avisos: r.avisos,
    };
  };

  const topTraders = medir(["top_traders"]);
  const takerFlow = medir(["taker_flow"]);
  const combinado = medir(["top_traders", "taker_flow"]);

  const medidos = [topTraders, takerFlow, combinado].filter((c): c is CopiaTrader => c !== null);
  const ningunaCopiaFunciona =
    medidos.length > 0 && medidos.every((c) => c.percentilAleatorio < 50);

  let veredicto: string;
  if (!medidos.length) {
    veredicto =
      "Ninguna de las estrategias de copy trading cerró operaciones con estos datos: no hay nada que concluir.";
  } else if (ningunaCopiaFunciona) {
    veredicto =
      "Copiar a los traders grandes NO ha funcionado: ninguna de las estrategias gana a la referencia aleatoria (entrar al azar con los mismos costes). Es decir: no se distinguen del azar.";
  } else {
    const mejor = medidos.reduce((a, b) => (b.percentilAleatorio > a.percentilAleatorio ? b : a));
    veredicto = `La mejor es "${mejor.nombre}" (percentil ${mejor.percentilAleatorio} % dentro de la referencia aleatoria). Aun asi, con ${mejor.operaciones} operaciones eso es ruido: mide con walk-forward antes de creerte nada.`;
  }

  return {
    simbolo: simboloFinal,
    velas: velas.length,
    desde: velas.length ? new Date(velas[0]!.time).toISOString().slice(0, 10) : "",
    hasta: velas.length ? new Date(velas[velas.length - 1]!.time).toISOString().slice(0, 10) : "",
    lecturasTraders,
    topTraders,
    takerFlow,
    combinado,
    veredicto,
    ningunaCopiaFunciona,
  };
}
