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
const estrategiaId = arg("estrategia", "fixed") ?? "fixed";
const folds = num("walk-forward", 0);

const config: ConfigBacktest = {
  capitalInicial: num("capital", 1000),
  fraccionPorOperacion: num("fraccion", 0.02),
  stopLossPct: num("stop", 2),
  takeProfitPct: num("take", 4),
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
  `costes: comision ${(config.costes.comision * 100).toFixed(3)} %/lado, slippage ${(config.costes.slippage * 100).toFixed(3)} %/lado, stop ${config.stopLossPct} %, take ${config.takeProfitPct} %`,
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
  velas = await velasDeBinance({ simbolo, intervalo, limite });
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

const r = ejecutarBacktest(velas, config, { simbolo: simboloFinal, operacionesMinimas: 100 });
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
  const wf = walkForward(velas, config, { folds, simbolo });
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

console.log("");
