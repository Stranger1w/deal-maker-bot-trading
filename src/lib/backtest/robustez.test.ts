import { describe, expect, test } from "bun:test";

import { backtestAleatorio, compararConAleatoria, prng, senalAleatoria } from "./aleatorio";
import { ejecutarBacktest } from "./engine";
import { analizarSensibilidad } from "./sensibilidad";
import type { ConfigBacktest, Vela } from "./types";

function velas(cierres: number[]): Vela[] {
  return cierres.map((cierre, i) => ({
    time: Date.UTC(2026, 0, 1) + i * 3_600_000,
    open: i === 0 ? cierre : (cierres[i - 1]! + cierre) / 2,
    high: cierre * 1.002,
    low: cierre * 0.998,
    close: cierre,
    volume: 100,
  }));
}

const config: ConfigBacktest = {
  capitalInicial: 1000,
  fraccionPorOperacion: 0.2,
  stopLossPct: 2,
  takeProfitPct: 4,
  costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
  indicadores: ["close_price"],
  parametros: { close_price: { periodo: 3 } },
};

describe("prng", () => {
  test("la misma semilla da la misma secuencia", () => {
    const a = prng(42);
    const b = prng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test("semillas distintas dan secuencias distintas", () => {
    const a = prng(1);
    const b = prng(2);
    expect(a()).not.toBe(b());
  });
});

describe("backtestAleatorio", () => {
  test("es determinista con la misma semilla", () => {
    const serie = velas(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 7) * 8));
    const a = backtestAleatorio(serie, config, 7);
    const b = backtestAleatorio(serie, config, 7);
    expect(a).toBe(b);
  });

  test("semillas distintas dan resultados distintos", () => {
    const serie = velas(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 7) * 8));
    const a = backtestAleatorio(serie, config, 1);
    const b = backtestAleatorio(serie, config, 99);
    expect(a).not.toBe(b);
  });

  test("con los mismos costes, en un mercado que no se mueve, pierde (los costes mandan)", () => {
    const serie = velas(Array.from({ length: 300 }, () => 100));
    const r = backtestAleatorio(serie, config, 3);
    expect(r).toBeLessThan(0);
  });

  test("opera un numero parecido de veces que la estrategia real (si no, la comparacion no vale)", () => {
    const serie = velas(
      Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 7) * 8 + i * 0.05),
    );
    const real = ejecutarBacktest(serie, config, { simbolo: "T" });
    const aleatorio = ejecutarBacktest(
      serie,
      {
        ...config,
        senal: senalAleatoria(5, 0.1),
      },
      { simbolo: "A" },
    );
    // La referencia tiene que estar en el mismo orden de magnitud.
    const diferencia = Math.abs(aleatorio.metricas.operaciones - real.metricas.operaciones);
    expect(diferencia).toBeLessThan(Math.max(40, real.metricas.operaciones));
  });
});

describe("compararConAleatoria", () => {
  test("una estrategia que gana a casi todas las aleatorias se reconoce", () => {
    const r = compararConAleatoria(10, [-5, -3, -1, 0, 1, 2, 3]);
    expect(r.percentil).toBeGreaterThan(60);
    expect(r.mejorQueLaMayoria).toBe(true);
  });

  test("una estrategia en el medio de las aleatorias NO tiene ventaja", () => {
    const r = compararConAleatoria(0, [-5, -3, -1, 0, 1, 3, 5]);
    expect(r.mejorQueLaMayoria).toBe(false);
    expect(r.veredicto).toContain("azar");
  });

  test("sin ejecuciones no se concluye nada", () => {
    const r = compararConAleatoria(5, []);
    expect(r.ejecuciones).toBe(0);
    expect(r.veredicto).toContain("no se puede concluir");
  });
});

describe("analizarSensibilidad", () => {
  test("mide el resultado al mover un parametro del indicador", () => {
    const serie = velas(
      Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 9) * 12 + i * 0.05),
    );
    const r = analizarSensibilidad({
      velas: serie,
      config,
      indicador: "close_price",
      parametro: "periodo",
      valores: [2, 3, 5],
    });
    expect(r.variantes.length).toBe(3);
    expect(r.variantes.map((v) => v.valor)).toEqual([2, 3, 5]);
    for (const v of r.variantes) {
      expect(Number.isFinite(v.retornoPct)).toBe(true);
      expect(v.operaciones).toBeGreaterThan(0);
    }
    expect(typeof r.estable).toBe("boolean");
  });
});
