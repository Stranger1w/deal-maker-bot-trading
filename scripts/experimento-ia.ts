/**
 * EXPERIMENTO: QUE MEJORA REALMENTE A LOS BOTS DEL MOTOR.
 *
 * QUE HACE
 * Descarga velas REALES de Binance y corre el MISMO motor de backtest que usa
 * el bot en vivo (mismas senales, mismos costes, mismo tamano) sobre varias
 * ventanas y varios pares. Cada configuracion se compara con 20 ejecuciones
 * de la MISMA estrategia pero con la entrada al azar: si no gana a la
 * mayoria de las aleatorias, no hay ventaja, solo suerte.
 *
 * COMO SE LEE EL RESULTADO
 * - "oper" menor que 30: no se puede afirmar nada (pocos datos).
 * - "percentil" es la posicion frente a las aleatorias: 50 = indistinguible
 *   del azar, 60+ = gana a la mayoria.
 * - Solo seTJ3ede cambiar algo del motor si gana en VARIAS ventanas y en
 *   VARIOS pares. Con una sola ventana, es ruido.
 *
 * USO: bun scripts/experimento-ia.ts [simbolo] [intervalo]
 */
import { ejecutarBacktest } from "../src/lib/backtest/engine";
import { backtestAleatorio, compararConAleatoria } from "../src/lib/backtest/aleatorio";
import type { ConfigBacktest, Vela } from "../src/lib/backtest/types";
import { buscarEstrategia } from "../src/lib/strategies/index";
import { velasDeBinance } from "../src/lib/velas.server";

const arg = (n: number, porDefecto: string) => process.argv[n] ?? porDefecto;

const simboloArg = arg(2, "BTCUSDT,ETHUSDT,SOLUSDT").toUpperCase();
const simbolos = simboloArg
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const intervaloArg = arg(3, "5m,15m,1h");
const intervalos = intervaloArg
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const VENTANAS = 4;
const ALEATORIOS = 20;

type Candidato = {
  nombre: string;
  config: ConfigBacktest;
};

function base(over: Partial<ConfigBacktest> = {}): ConfigBacktest {
  return {
    capitalInicial: 1000,
    fraccionPorOperacion: 0.02,
    stopLossPct: 1.5,
    takeProfitPct: 3,
    costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
    indicadores: ["rsi"],
    ...over,
  };
}

const rsiParams = (sobreventa: number, sobrecompra: number, periodo = 14) => ({
  rsi: { periodo, sobreventa, sobrecompra },
});

const CANDIDATOS: Candidato[] = [
  { nombre: "BASE rsi14 30/70 sl1.5 tp3", config: base({ parametros: rsiParams(30, 70) }) },
  { nombre: "rsi14 25/75", config: base({ parametros: rsiParams(25, 75) }) },
  { nombre: "rsi14 20/80", config: base({ parametros: rsiParams(20, 80) }) },
  { nombre: "rsi14 35/65", config: base({ parametros: rsiParams(35, 65) }) },
  { nombre: "rsi7 30/70", config: base({ parametros: rsiParams(30, 70, 7) }) },
  { nombre: "rsi21 30/70", config: base({ parametros: rsiParams(30, 70, 21) }) },
  {
    nombre: "rsi14 sl1 tp2",
    config: base({ parametros: rsiParams(30, 70), stopLossPct: 1, takeProfitPct: 2 }),
  },
  { nombre: "rsi14 sl1.5 tp6", config: base({ parametros: rsiParams(30, 70), takeProfitPct: 6 }) },
  {
    nombre: "rsi14 sl2 tp4",
    config: base({ parametros: rsiParams(30, 70), stopLossPct: 2, takeProfitPct: 4 }),
  },
  {
    nombre: "rsi14 sl3 tp6",
    config: base({ parametros: rsiParams(30, 70), stopLossPct: 3, takeProfitPct: 6 }),
  },
  {
    nombre: "rsi14 + ATR x1 (stop y take)",
    config: base({ parametros: rsiParams(30, 70), stopAtrMult: 1 }),
  },
  {
    nombre: "rsi14 + ATR x1.5 (stop y take)",
    config: base({ parametros: rsiParams(30, 70), stopAtrMult: 1.5 }),
  },
  {
    nombre: "rsi14 + ATR x2 (stop y take)",
    config: base({ parametros: rsiParams(30, 70), stopAtrMult: 2 }),
  },
  {
    nombre: "rsi14 + ATR x2.5 (stop y take)",
    config: base({ parametros: rsiParams(30, 70), stopAtrMult: 2.5 }),
  },
  {
    nombre: "rsi14 + filtro regimen",
    config: base({
      parametros: rsiParams(30, 70),
      takeProfitPct: 6,
      filtroRegimen: { activo: true },
    }),
  },
  { nombre: "precio_justo", config: base({ indicadores: ["precio_justo"] }) },
  { nombre: "bollinger", config: base({ indicadores: ["bollinger"] }) },
  { nombre: "macd", config: base({ indicadores: ["macd"] }) },
  { nombre: "stochastic", config: base({ indicadores: ["stochastic"] }) },
  { nombre: "cci", config: base({ indicadores: ["cci"] }) },
];

type ResultadoVentana = {
  operaciones: number;
  retornoPct: number;
  winRatePct: number;
  profitFactor: number;
  drawdownPct: number;
  benchmarkPct: number;
  percentil: number;
  medianaAleatoriaPct: number;
};

function medir(velas: Vela[], config: ConfigBacktest, simbolo: string): ResultadoVentana {
  const r = ejecutarBacktest(velas, config, { simbolo });
  const m = r.metricas;
  const aleatorios: number[] = [];
  for (let i = 0; i < ALEATORIOS; i++) {
    aleatorios.push(
      backtestAleatorio(velas, config, 1000 + i * 37, { operacionesObjetivo: m.operaciones }),
    );
  }
  const ref = compararConAleatoria(m.retornoNetoPct, aleatorios);
  return {
    operaciones: m.operaciones,
    retornoPct: Number(m.retornoNetoPct.toFixed(2)),
    winRatePct: Number(m.winRatePct.toFixed(1)),
    profitFactor: Number(m.profitFactor.toFixed(2)),
    drawdownPct: Number(m.maxDrawdownPct.toFixed(2)),
    benchmarkPct: Number(r.benchmark.retornoPct.toFixed(2)),
    percentil: ref.percentil,
    medianaAleatoriaPct: ref.medianaPct,
  };
}

function partir(velas: Vela[], partes: number): Vela[][] {
  const out: Vela[][] = [];
  const tam = Math.floor(velas.length / partes);
  for (let i = 0; i < partes; i++) {
    out.push(velas.slice(i * tam, (i + 1) * tam));
  }
  return out;
}

const resultados = new Map<string, ResultadoVentana[]>();
const mercado = new Map<string, { velas: number; desde: string; hasta: string }>();

for (const simbolo of simbolos) {
  for (const intervalo of intervalos) {
    const velas = await velasDeBinance({ simbolo, intervalo, limite: 3000, mercado: "spot" });
    if (velas.length < 300) {
      console.log(`${simbolo} ${intervalo}: solo ${velas.length} velas, se omite.`);
      continue;
    }
    mercado.set(`${simbolo} ${intervalo}`, {
      velas: velas.length,
      desde: new Date(velas[0]!.time).toISOString().slice(0, 10),
      hasta: new Date(velas[velas.length - 1]!.time).toISOString().slice(0, 10),
    });
    const ventanas = partir(velas, VENTANAS);
    for (const c of CANDIDATOS) {
      const porVentana = resultados.get(c.nombre) ?? [];
      for (const v of ventanas) {
        try {
          porVentana.push(medir(v, c.config, simbolo));
        } catch {
          porVentana.push({
            operaciones: 0,
            retornoPct: 0,
            winRatePct: 0,
            profitFactor: 0,
            drawdownPct: 0,
            benchmarkPct: 0,
            percentil: 50,
            medianaAleatoriaPct: 0,
          });
        }
      }
      resultados.set(c.nombre, porVentana);
    }
  }
}

console.log("\nPeriodos medidos:");
for (const [k, v] of mercado) console.log(`  ${k}: ${v.velas} velas · ${v.desde} → ${v.hasta}`);
console.log(
  `\nVentanas por mercado: ${VENTANAS} · Referencias aleatorias por corrida: ${ALEATORIOS}\n`,
);

const fmt = (n: number, d = 2) => n.toFixed(d).padStart(7);
console.log(
  "configuracion".padEnd(30) +
    "ops  ret%  win%   PF   dd%   azar   pct  | ventanas que ganan al azar",
);
console.log("-".repeat(110));
const filas = [...resultados.entries()].map(([nombre, rs]) => {
  const ops = rs.reduce((s, r) => s + r.operaciones, 0);
  const ret = rs.reduce((s, r) => s + r.retornoPct, 0) / rs.length;
  const win = rs.reduce((s, r) => s + r.winRatePct, 0) / rs.length;
  const pf = rs.reduce((s, r) => s + r.profitFactor, 0) / rs.length;
  const dd = rs.reduce((s, r) => s + r.drawdownPct, 0) / rs.length;
  const azar = rs.reduce((s, r) => s + r.medianaAleatoriaPct, 0) / rs.length;
  const pct = rs.reduce((s, r) => s + r.percentil, 0) / rs.length;
  const gana = rs.filter((r) => r.percentil >= 60).length;
  return { nombre, ops, ret, win, pf, dd, azar, pct, gana };
});
filas.sort((a, b) => b.pct - a.pct);
for (const f of filas) {
  console.log(
    f.nombre.padEnd(30) +
      String(f.ops).padStart(5) +
      fmt(f.ret) +
      fmt(f.win, 1) +
      fmt(f.pf) +
      fmt(f.dd) +
      fmt(f.azar) +
      fmt(f.pct, 1) +
      `  | ${f.gana}/${VENTANAS}`,
  );
}
console.log(
  "\npercentil = posicion frente a las 20 referencias aleatorias (50 = igual que el azar).",
);
console.log("ops < 30: no hay datos suficientes para afirmar nada.\n");

// La estrategia de tamaño por defecto del motor.
const estrategia = buscarEstrategia("fixed");
console.log(
  "Estrategias de tamaño disponibles:",
  Object.keys(buscarEstrategia("fixed") ? {} : {}).length ? "" : "",
);
void estrategia;
