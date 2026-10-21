/**
 * CLI del backtest. Se ejecuta con bun desde la raiz del repo:
 *
 *   bun scripts/backtest.ts --simbolo BTCUSDT --intervalo 1h --velas 2000 \
 *     --indicadores close_price --capital 1000 --stop 2 --take 4
 *
 * Solo lee datos publicos de Binance. NO toca la base de datos, NO envia
 * ordenes y NO usa claves.
 *
 * Opciones:
 *   --simbolo BTCUSDT        Par a probar
 *   --intervalo 1h           1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w
 *   --velas 2000             Cuantas velas (max 10000)
 *   --indicadores close_price,macd   Indicadores (ver src/lib/indicators)
 *   --parametros '{"close_price":{"periodo":3}}'  Params de los indicadores
 *   --capital 1000           Capital inicial
 *   --fraccion 0.02          Fraccion del capital por operacion
 *   --stop 2                 Stop loss en %
 *   --take 4                 Take profit en %
 *   --comision 0.001         Comision por lado (0,1 % de Binance spot)
 *   --slippage 0.0005        Slippage por lado
 *   --descuento-bnb 0.1      Descuento por pagar con BNB (0,1 = 10 %)
 *   --estrategia optimal     fixed | conservative | optimal | aggressive
 *   --walk-forward 4         Numero de bloques de validacion fuera de muestra
 *   --archivo datos/x.json   Lee las velas de un fichero (para probar SIN
 *                            internet). Ver scripts/guardar-velas.ts.
 */

import { readFileSync } from "node:fs";

import { buscarEstrategia } from "../src/lib/strategies/index";
import { ejecutarBacktest } from "../src/lib/backtest/engine";
import { velasDeBinance } from "../src/lib/velas.server";
import { walkForward } from "../src/lib/backtest/walkforward";
import type { ConfigBacktest, Vela } from "../src/lib/backtest/types";
import { getBinanceSymbolRules } from "../src/lib/binance-trading.server";

function arg(nombre: string, porDefecto?: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i === -1) return porDefecto;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : porDefecto;
}
function num(nombre: string, porDefecto: number): number {
  const v = arg(nombre);
  const n = v === undefined ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : porDefecto;
}

const simbolo = (arg("simbolo", "BTCUSDT") ?? "BTCUSDT").toUpperCase();
const intervalo = arg("intervalo", "1h") ?? "1h";
const limite = num("velas", 2000);
const indicadores = (arg("indicadores", "close_price") ?? "close_price")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const parametrosBrutos = arg("parametros");
const parametros = parametrosBrutos
  ? (JSON.parse(parametrosBrutos) as Record<string, Record<string, number>>)
  : undefined;

/** ¿Este conjunto de indicadores necesita los datos de traders? */
function necesitaTradersIndicadores(ids: readonly string[]): boolean {
  return ids.some((id) => id === "top_traders" || id === "taker_flow");
}

const estrategiaId = arg("estrategia", "fixed") ?? "fixed";
const folds = num("walk-forward", 0);

const config: ConfigBacktest = {
  capitalInicial: num("capital", 1000),
  fraccionPorOperacion: num("fraccion", 0.02),
  stopLossPct: num("stop", 2),
  takeProfitPct: num("take", 4),
  ...(num("stop-atr", 0) > 0 ? { stopAtrMult: num("stop-atr", 0) } : {}),
  ...(num("trailing", 0) > 0 ? { trailingStopPct: num("trailing", 0) } : {}),
  ...(num("break-even", 0) > 0 ? { breakEvenPct: num("break-even", 0) } : {}),
  costes: {
    comision: num("comision", 0.001),
    slippage: num("slippage", 0.0005),
    descuentoBnb: num("descuento-bnb", 0),
  },
  indicadores,
  ...(parametros ? { parametros } : {}),
  etiqueta: `${simbolo} ${intervalo} ${indicadores.join("+")}`,
};
const estrategia = buscarEstrategia(estrategiaId);
if (estrategia) config.estrategia = estrategia;

console.log(`\n=== Backtest: ${simbolo} · ${intervalo} ===`);
console.log(
  `indicadores: ${indicadores.join(", ")} | estrategia: ${estrategiaId} | capital: ${config.capitalInicial}`,
);
console.log(
  `costes: comision ${(config.costes.comision * 100).toFixed(3)} %/lado, slippage ${(config.costes.slippage * 100).toFixed(3)} %/lado, stop ${config.stopLossPct} %, take ${config.takeProfitPct} %` +
    `${config.stopAtrMult ? `, stop por ATR x${config.stopAtrMult}` : ""}` +
    `${config.trailingStopPct ? `, stop trazado ${config.trailingStopPct} %` : ""}` +
    `${config.breakEvenPct ? `, break-even ${config.breakEvenPct} %` : ""}`,
);

// Velas: del fichero (offline) o de Binance.
const archivo = arg("archivo");
let velas: Vela[];
let simboloFinal = simbolo;
if (archivo) {
  const datos = JSON.parse(readFileSync(archivo, "utf8")) as {
    simbolo?: string;
    intervalo?: string;
    velas: Vela[];
  };
  velas = datos.velas ?? [];
  simboloFinal = datos.simbolo ?? simbolo;
  console.log(
    `velas del fichero ${archivo} (${datos.simbolo ?? simbolo} ${datos.intervalo ?? ""})`,
  );
} else {
  velas = await velasDeBinance({
    simbolo,
    intervalo,
    limite,
    // Los indicadores de traders usan datos de FUTUROS: el precio tiene que
    // ser del mismo mercado que el flujo y el posicionamiento.
    mercado: necesitaTradersIndicadores(indicadores) ? "futuros" : "spot",
  });
  if (velas.length === 0) {
    console.error(
      "No se han descargado velas. Sin internet: descarga las velas antes con 'bun scripts/guardar-velas.ts' y despues usa --archivo.",
    );
    process.exit(1);
  }
}
if (velas.length === 0) {
  console.error("El fichero no tiene velas.");
  process.exit(1);
}

// Reglas del símbolo: hacen falta aunque no haya internet (van en el
// fichero de ExchangeInfo, que se cachean aparte). Sin internet se usan las
// reglas por defecto, con un aviso.
if (archivo) {
  config.reglas = { stepSize: 0.00001, minQty: 0, minNotional: 5 };
  console.log("reglas por defecto (sin internet): stepSize 0.00001, minNotional 5 USDT");
} else {
  const reglas = await getBinanceSymbolRules(simboloFinal, "production");
  config.reglas = {
    stepSize: reglas.stepSize,
    minQty: reglas.minQty,
    minNotional: reglas.minNotional,
  };
}
console.log(
  `velas: ${velas.length} (${new Date(velas[0]!.time).toISOString().slice(0, 10)} → ${new Date(velas[velas.length - 1]!.time).toISOString().slice(0, 10)}) | stepSize ${config.reglas?.stepSize} | minNotional ${config.reglas?.minNotional}`,
);

// ── Datos de traders reales (solo si el indicador los necesita) ────────────
const necesitaTraders = indicadores.some((id) => id === "top_traders" || id === "taker_flow");
let aux: Record<string, number[]> | undefined;
if (necesitaTraders) {
  const { obtenerSeriesTraders, alinearTradersConVelas } =
    await import("../src/lib/traders.server");
  console.log("descargando datos reales de traders (posicionamiento y flujo)...");
  const series = await obtenerSeriesTraders(simboloFinal, "1h", 1000);
  aux = alinearTradersConVelas(velas, series);
  const conDato = (aux["traders_top_long_short"] ?? []).filter((v) => Number.isFinite(v)).length;
  console.log(
    `datos de traders: ${series.top.length} lecturas (cuentas grandes) | ${series.taker.length} (flujo) | ${conDato} velas con dato`,
  );
  if (conDato === 0) {
    console.error(
      "No hay datos de traders para este par/periodo: los indicadores de copy trading NO pueden dar señal (no se inventa).",
    );
  }
}

const r = ejecutarBacktest(velas, config, { simbolo: simboloFinal, operacionesMinimas: 100, aux });
const m = r.metricas;

console.log("\n--- RESULTADO ---");
console.log(`capital final      : ${m.capitalFinal.toFixed(2)} (inicial ${m.capitalInicial})`);
console.log(`retorno neto       : ${m.retornoNetoPct.toFixed(2)} %`);
console.log(`P&L neto           : ${m.pnlNeto.toFixed(2)}`);
console.log(
  `operaciones        : ${m.operaciones} (${m.ganadoras} ganadoras / ${m.perdedoras} perdedoras)`,
);
console.log(`win rate           : ${m.winRatePct.toFixed(2)} %`);
console.log(`profit factor      : ${m.profitFactor.toFixed(2)}`);
console.log(`expectancy         : ${m.expectancy.toFixed(4)} por operacion`);
console.log(`max drawdown       : ${m.maxDrawdownPct.toFixed(2)} %`);
console.log(
  `costes             : ${m.costeTotal.toFixed(2)} (${m.costePct.toFixed(2)} % del capital)`,
);
console.log(`sharpe / sortino   : ${m.sharpe.toFixed(3)} / ${m.sortino.toFixed(3)}`);
console.log(
  `comprar y mantener  : ${r.benchmark.retornoPct.toFixed(2)} %  →  ${r.benchmark.superar ? "el bot lo supera" : "el bot NO lo supera"}`,
);

if (r.avisos.length) {
  console.log("\n--- AVISOS (esto es lo que el resultado NO demuestra) ---");
  for (const aviso of r.avisos) console.log(`  · ${aviso}`);
}

if (folds >= 2) {
  const wf = walkForward(velas, config, { folds, simbolo: simboloFinal });
  console.log(`\n--- WALK-FORWARD (${folds} bloques fuera de muestra) ---`);
  for (const f of wf.folds) {
    console.log(
      `  bloque ${f.indice}: fuera de muestra ${f.fueraDeMuestra.retornoNetoPct.toFixed(2)} % (${f.fueraDeMuestra.operaciones} ops, DD ${f.fueraDeMuestra.maxDrawdownPct.toFixed(2)} %) | dentro de muestra ${f.dentroDeMuestra.retornoNetoPct.toFixed(2)} %`,
    );
  }
  console.log(
    `  resumen: ${wf.resumen.bloquesPositivos}/${wf.folds.length} bloques positivos, ${wf.resumen.operaciones} operaciones, retorno medio ${wf.resumen.retornoMedioPct.toFixed(2)} %, drawdown maximo ${wf.resumen.maxDrawdownPct.toFixed(2)} %`,
  );
  console.log(`  aviso: ${wf.aviso}`);
}

// Referencia ALEATORIA: la estrategia tiene que ganarle a entrar al azar
// con los mismos costes, o solo ha tenido suerte.
const ejecucionesAleatorias = num("aleatorio", 0);
if (ejecucionesAleatorias > 0) {
  const { backtestAleatorio, compararConAleatoria } = await import("../src/lib/backtest/aleatorio");
  const aleatorios: number[] = [];
  for (let s = 1; s <= ejecucionesAleatorias; s++) {
    aleatorios.push(backtestAleatorio(velas, config, s, { operacionesObjetivo: m.operaciones }));
  }
  const ref = compararConAleatoria(m.retornoNetoPct, aleatorios);
  console.log(`\n--- REFERENCIA ALEATORIA (${ref.ejecuciones} ejecuciones) ---`);
  console.log(
    `  la estrategia: ${ref.nuestraPct.toFixed(2)} % | aleatorias: mejor ${ref.mejorPct.toFixed(2)} %, mediana ${ref.medianaPct.toFixed(2)} %, peor ${ref.peorPct.toFixed(2)} %`,
  );
  console.log(`  percentil: ${ref.percentil} %`);
  console.log(`  veredicto: ${ref.veredicto}`);
}

// Sensibilidad de parametros: si al mover un parametro el resultado se
// hunde, la configuracion esta afinada a un valor concreto.
const sensibilidadParam = arg("sensibilidad-param");
const sensibilidadValores = (arg("sensibilidad-valores", "") ?? "")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v));
if (sensibilidadParam && sensibilidadValores.length > 1 && indicadores.length > 0) {
  const { analizarSensibilidad } = await import("../src/lib/backtest/sensibilidad");
  const [indicador, ...resto] = sensibilidadParam.split(".");
  const parametro = resto.join(".") || "periodo";
  const s = analizarSensibilidad({
    velas,
    config,
    indicador,
    parametro,
    valores: sensibilidadValores,
    simbolo: simboloFinal,
  });
  console.log(`\n--- SENSIBILIDAD (${indicador}.${parametro}) ---`);
  console.log(
    `  referencia: ${s.referencia.retornoPct.toFixed(2)} % (${s.referencia.operaciones} ops)`,
  );
  for (const v of s.variantes) {
    console.log(
      `  ${String(v.valor).padStart(6)}: ${v.retornoPct.toFixed(2)} % (${v.operaciones} ops, deviation ${v.desviacionPct.toFixed(2)} puntos)`,
    );
  }
  console.log(`  veredicto: ${s.veredicto}`);
}

console.log("");
