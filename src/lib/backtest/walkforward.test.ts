import { describe, expect, test } from "bun:test";

import { ejecutarBacktest } from "./engine";
import type { ConfigBacktest, Vela } from "./types";
import { walkForward } from "./walkforward";

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
  fraccionPorOperacion: 0.5,
  stopLossPct: 0,
  takeProfitPct: 0,
  costes: { comision: 0, slippage: 0, descuentoBnb: 0 },
  indicadores: ["close_price"],
  parametros: { close_price: { periodo: 3 } },
};

describe("walkForward", () => {
  test("parte las velas en bloques y evalua cada uno FUERA de muestra", () => {
    const serie = velas(
      Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 8) * 10 + i * 0.05),
    );
    const r = walkForward(serie, config, { folds: 4, simbolo: "TEST" });
    expect(r.folds.length).toBe(4);
    expect(r.folds[0]!.indice).toBe(1);
    expect(r.folds[3]!.indice).toBe(4);
    // Los bloques son consecutivos y no se solapan.
    expect(r.folds[0]!.hasta).toBeLessThan(r.folds[1]!.desde);
    expect(r.resumen.operaciones).toBeGreaterThanOrEqual(0);
  });

  test("con pocos datos no inventa bloques", () => {
    const serie = velas([100, 101, 102, 103]);
    const r = walkForward(serie, config, { folds: 4, minimoPorFold: 50 });
    expect(r.folds.length).toBe(0);
  });

  test("el bloque evaluado se puede volver a correr con el backtest y da lo mismo", () => {
    const serie = velas(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1));
    const r = walkForward(serie, config, { folds: 2, simbolo: "TEST" });
    const fold = r.folds[0]!;
    const bloque = serie.filter((v) => v.time >= fold.desde && v.time <= fold.hasta);
    const directo = ejecutarBacktest(bloque, config, { simbolo: "TEST" });
    expect(directo.metricas.retornoNetoPct).toBeCloseTo(fold.fueraDeMuestra.retornoNetoPct, 6);
  });

  test("el aviso dice que el walk-forward no optimiza", () => {
    const serie = velas(Array.from({ length: 200 }, (_, i) => 100 + i));
    const r = walkForward(serie, config, { folds: 2 });
    expect(r.aviso).toContain("sobreajuste");
  });
});
