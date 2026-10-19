import { describe, expect, test } from "bun:test";

import { calcularCantidad, ejecutarBacktest } from "./engine";
import { calcularMetricas, comprarYMantener, maxDrawdownPct } from "./metrics";
import type { ConfigBacktest, Vela } from "./types";

/** Velas deterministas: los cierres los decide la funcion. */
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

const SIN_COSTES = { comision: 0, slippage: 0, descuentoBnb: 0 };

function config(extra: Partial<ConfigBacktest> = {}): ConfigBacktest {
  return {
    capitalInicial: 1000,
    fraccionPorOperacion: 0.5,
    stopLossPct: 0,
    takeProfitPct: 0,
    costes: SIN_COSTES,
    indicadores: ["close_price"],
    parametros: { close_price: { periodo: 3 } },
    ...extra,
  };
}

describe("calcularCantidad", () => {
  test("respeta el stepSize", () => {
    const cantidad = calcularCantidad({
      monto: 100,
      precio: 3,
      stepSize: 0.001,
      minQty: 0,
      minNotional: 0,
    });
    expect(cantidad).toBe(33.333);
  });

  test("por debajo del minNotional no se compra nada", () => {
    const cantidad = calcularCantidad({
      monto: 5,
      precio: 100,
      stepSize: 0.001,
      minQty: 0,
      minNotional: 10,
    });
    expect(cantidad).toBe(0);
  });

  test("por debajo del minQty no se compra nada", () => {
    const cantidad = calcularCantidad({
      monto: 5,
      precio: 100,
      stepSize: 0.001,
      minQty: 1,
      minNotional: 0,
    });
    expect(cantidad).toBe(0);
  });
});

describe("ejecutarBacktest", () => {
  test("tendencia alcista: entra una vez y sale con beneficio", () => {
    const serie = velas([100, 101, 102, 103, 104, 105, 106, 107]);
    const r = ejecutarBacktest(serie, config({ takeProfitPct: 5 }), { simbolo: "TEST" });
    expect(r.operaciones.length).toBe(1);
    const op = r.operaciones[0]!;
    expect(op.pnl).toBeGreaterThan(0);
    expect(r.metricas.operaciones).toBe(1);
    expect(r.metricas.retornoNetoPct).toBeGreaterThan(0);
  });

  test("la senal NO mira la vela en curso: entra en la vela siguiente", () => {
    // Con 3 cierres alcistas (velas 0,1,2) la senal 'buy' existe al cierre
    // de la vela 2, asi que la entrada es a la apertura de la vela 3.
    const serie = velas([100, 101, 102, 103, 104]);
    const r = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    const op = r.operaciones[0]!;
    expect(op.entrada).toBe(serie[3]!.time);
    expect(op.precioEntrada).toBeCloseTo(serie[3]!.open, 6);
  });

  test("caida: el stop loss corta y la operacion pierde", () => {
    const serie = velas([100, 101, 102, 101, 99, 97, 95]);
    const r = ejecutarBacktest(serie, config({ stopLossPct: 2 }), { simbolo: "TEST" });
    expect(r.operaciones.length).toBe(1);
    const op = r.operaciones[0]!;
    expect(op.motivo).toBe("stop_loss");
    expect(op.pnl).toBeLessThan(0);
  });

  test("sin stop loss ni take profit, la posicion se cierra al final de los datos", () => {
    const serie = velas([100, 101, 102, 103, 104]);
    const r = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    expect(r.operaciones.length).toBe(1);
    expect(r.operaciones[0]!.motivo).toBe("fin_datos");
  });

  test("sin senal no se abre nada (mercado lateral)", () => {
    const serie = velas([100, 101, 100, 101, 100, 101]);
    const r = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    expect(r.operaciones.length).toBe(0);
    expect(r.metricas.retornoNetoPct).toBe(0);
  });

  test("el importe por debajo de minNotional no abre operacion", () => {
    const serie = velas([100, 101, 102, 103, 104]);
    const r = ejecutarBacktest(
      serie,
      config({
        capitalInicial: 10,
        fraccionPorOperacion: 0.1,
        reglas: { stepSize: 0.001, minQty: 0, minNotional: 50 },
      }),
      { simbolo: "TEST" },
    );
    expect(r.operaciones.length).toBe(0);
  });

  test("los costes se comen la ganancia (el mismo mercado, peor resultado)", () => {
    const serie = velas([100, 101, 102, 103, 104, 105, 106]);
    const sinCostes = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    const conCostes = ejecutarBacktest(
      serie,
      config({ costes: { comision: 0.001, slippage: 0.001, descuentoBnb: 0 } }),
      { simbolo: "TEST" },
    );
    expect(conCostes.metricas.pnlNeto).toBeLessThan(sinCostes.metricas.pnlNeto);
    expect(conCostes.metricas.costeTotal).toBeGreaterThan(0);
  });

  test("es determinista: dos corridas dan el mismo resultado", () => {
    const serie = velas([100, 101, 102, 103, 104, 105]);
    const a = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    const b = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    expect(a.metricas.pnlNeto).toBe(b.metricas.pnlNeto);
    expect(a.operaciones.length).toBe(b.operaciones.length);
  });

  test("invariante de caja: capital final = capital inicial + suma de P&L", () => {
    const serie = velas([100, 101, 102, 103, 104, 102, 101, 103, 105, 104]);
    const r = ejecutarBacktest(
      serie,
      config({ costes: { comision: 0.001, slippage: 0.0005, descuentoBnb: 0.1 } }),
      { simbolo: "TEST" },
    );
    const sumaPnl = r.operaciones.reduce((a, o) => a + o.pnl, 0);
    expect(r.metricas.capitalFinal).toBeCloseTo(1000 + sumaPnl, 6);
    expect(r.metricas.pnlNeto).toBeCloseTo(sumaPnl, 6);
  });

  test("sin operaciones, los avisos avisan de que no hay evidencia", () => {
    const serie = velas([100, 100, 100, 100]);
    const r = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    expect(r.operaciones.length).toBe(0);
    expect(r.avisos.join(" ")).toContain("operaciones");
  });

  test("avisa de que no es validacion fuera de muestra", () => {
    const serie = velas([100, 101, 102, 103, 104]);
    const r = ejecutarBacktest(serie, config(), { simbolo: "TEST" });
    expect(r.avisos.join(" ")).toContain("fuera de muestra");
  });
});

describe("metricas", () => {
  test("maxDrawdownPct mide la caida desde el pico", () => {
    expect(maxDrawdownPct([100, 120, 90, 110])).toBe(25);
  });

  test("profit factor, win rate y expectancy", () => {
    const m = calcularMetricas({
      capitalInicial: 1000,
      capitalFinal: 1100,
      curva: [1000, 1100],
      duracionMs: 1000,
      operaciones: [
        {
          pnl: 100,
          costes: 1,
          comisiones: 1,
          costeSlippage: 0,
          efectivo: 200,
          lado: "buy",
          precioEntrada: 1,
          precioSalida: 2,
          cantidad: 1,
          pnlBruto: 101,
          entrada: 0,
          salida: 1,
          motivo: "senal",
          duracionMs: 1,
        },
        {
          pnl: -50,
          costes: 1,
          comisiones: 1,
          costeSlippage: 0,
          efectivo: 50,
          lado: "buy",
          precioEntrada: 1,
          precioSalida: 1,
          cantidad: 1,
          pnlBruto: -49,
          entrada: 0,
          salida: 1,
          motivo: "senal",
          duracionMs: 1,
        },
      ],
    });
    expect(m.operaciones).toBe(2);
    expect(m.ganadoras).toBe(1);
    expect(m.perdedoras).toBe(1);
    expect(m.winRatePct).toBe(50);
    expect(m.profitFactor).toBe(2);
    expect(m.expectancy).toBe(25);
  });

  test("comprar y mantener con los mismos costes", () => {
    const serie = velas([100, 110, 120]);
    const r = comprarYMantener({
      velas: serie,
      capitalInicial: 1000,
      comision: 0,
      slippage: 0,
      descuentoBnb: 0,
    });
    expect(r.retornoPct).toBeCloseTo(20, 6);
  });
});
