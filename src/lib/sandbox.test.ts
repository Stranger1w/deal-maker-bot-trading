import { describe, expect, test } from "bun:test";

import { buscarEstrategia } from "./strategies/index";
import { ejecutarBacktest } from "./backtest/engine";
import { backtestAleatorio, compararConAleatoria } from "./backtest/aleatorio";
import type { ConfigBacktest, Vela } from "./backtest/types";

/** Velas sinteticas SOLO para el test (aqui no se mide nada: se comprueba
 *  que el motor es determinista y que las cuentas cuadran). */
function velas(count: number, precioInicial = 100): Vela[] {
  const velas: Vela[] = [];
  let precio = precioInicial;
  for (let i = 0; i < count; i++) {
    // Ondula para que haya senales de compra y venta.
    precio *= 1 + Math.sin(i / 7) * 0.01;
    velas.push({
      time: 1_700_000_000_000 + i * 3_600_000,
      open: precio,
      high: precio * 1.002,
      low: precio * 0.998,
      close: precio,
      volume: 1000,
    });
  }
  return velas;
}

describe("motor de backtest (el mismo que usa el sandbox y el motor en vivo)", () => {
  test("es determinista: dos ejecuciones dan lo mismo", () => {
    const config: ConfigBacktest = {
      capitalInicial: 1000,
      fraccionPorOperacion: 0.02,
      stopLossPct: 2,
      takeProfitPct: 4,
      costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
      indicadores: ["close_price"],
    };
    const a = ejecutarBacktest(velas(400), config);
    const b = ejecutarBacktest(velas(400), config);
    expect(a.metricas.retornoNetoPct).toBe(b.metricas.retornoNetoPct);
    expect(a.metricas.operaciones).toBe(b.metricas.operaciones);
    expect(a.curva.length).toBe(b.curva.length);
  });

  test("las cuentas cuadran: capital final = inicial + P&L", () => {
    const config: ConfigBacktest = {
      capitalInicial: 1000,
      fraccionPorOperacion: 0.02,
      stopLossPct: 2,
      takeProfitPct: 4,
      costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
      indicadores: ["close_price"],
    };
    const r = ejecutarBacktest(velas(400), config);
    expect(r.metricas.capitalInicial).toBe(1000);
    expect(
      Math.abs(r.metricas.capitalFinal - (r.metricas.capitalInicial + r.metricas.pnlNeto)),
    ).toBeLessThan(0.01);
  });

  test("sin velas no hay resultado (no se inventa)", () => {
    const config: ConfigBacktest = {
      capitalInicial: 1000,
      fraccionPorOperacion: 0.02,
      stopLossPct: 2,
      takeProfitPct: 4,
      costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
      indicadores: ["close_price"],
    };
    const r = ejecutarBacktest([], config);
    expect(r.metricas.operaciones).toBe(0);
    expect(r.metricas.retornoNetoPct).toBe(0);
  });

  test("la estrategia del motor en vivo se puede usar en el backtest", () => {
    const estrategia = buscarEstrategia("fixed");
    expect(estrategia).not.toBeNull();
    const config: ConfigBacktest = {
      capitalInicial: 1000,
      fraccionPorOperacion: 0.02,
      stopLossPct: 2,
      takeProfitPct: 4,
      costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
      indicadores: ["close_price"],
      ...(estrategia ? { estrategia } : {}),
    };
    const r = ejecutarBacktest(velas(400), config);
    expect(Number.isFinite(r.metricas.retornoNetoPct)).toBe(true);
  });
});

describe("referencia aleatoria (el sandbox mide si hay ventaja o es azar)", () => {
  const config: ConfigBacktest = {
    capitalInicial: 1000,
    fraccionPorOperacion: 0.02,
    stopLossPct: 2,
    takeProfitPct: 4,
    costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0 },
    indicadores: ["close_price"],
  };

  test("la referencia aleatoria es determinista (misma semilla, mismo resultado)", () => {
    const a = backtestAleatorio(velas(400), config, 1234);
    const b = backtestAleatorio(velas(400), config, 1234);
    expect(a).toBe(b);
  });

  test("el percentil dice si la estrategia gana al azar", () => {
    // Una estrategia que gana al 90 % de las aleatorias.
    const aleatorios = [-1, -2, -3, -4, -5, -6, -7, -8, -9, 0];
    const ref = compararConAleatoria(5, aleatorios);
    expect(ref.ejecuciones).toBe(10);
    expect(ref.percentil).toBe(100);
    expect(ref.mejorQueLaMayoria).toBe(true);
    expect(ref.veredicto).toContain("azar");
  });

  test("una estrategia en el tercio bajo no se distingue del azar", () => {
    const aleatorios = [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8];
    // -6 solo gana a 3 de las 10 aleatorias (incluida ella): percentil 30.
    const ref = compararConAleatoria(-6, aleatorios);
    expect(ref.percentil).toBe(30);
    expect(ref.mejorQueLaMayoria).toBe(false);
    expect(ref.veredicto).toContain("azar");
  });

  test("sin referencia aleatoria no se concluye nada", () => {
    const ref = compararConAleatoria(5, []);
    expect(ref.ejecuciones).toBe(0);
    expect(ref.mejorQueLaMayoria).toBe(false);
    expect(ref.veredicto).toContain("no se puede concluir");
  });
});
