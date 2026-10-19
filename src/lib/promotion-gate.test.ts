import { describe, expect, test } from "bun:test";

import { evaluarGate, metricasDeEjecuciones, type CriteriosPromocion } from "./promotion-gate";

const EJECUCIONES = [
  { side: "buy", pnl: 0, created_at: "2026-10-01T00:00:00Z" },
  { side: "sell", pnl: 10, created_at: "2026-10-01T01:00:00Z" },
  { side: "buy", pnl: 0, created_at: "2026-10-02T00:00:00Z" },
  { side: "sell", pnl: -5, created_at: "2026-10-02T01:00:00Z" },
];

const CRITERIOS: CriteriosPromocion = {
  dias: 30,
  minDias: 14,
  minOperaciones: 100,
  maxDrawdownPct: 20,
  exigirBenchmark: true,
  botReturnPct: 5,
  benchmarkReturnPct: 2,
  stopLossPct: 2,
  takeProfitPct: 4,
  binanceVerificado: true,
  capital: 1000,
};

describe("metricasDeEjecuciones", () => {
  test("solo cuentan las ventas (operaciones cerradas)", () => {
    const m = metricasDeEjecuciones(EJECUCIONES, 1000);
    expect(m.operaciones).toBe(2);
    expect(m.pnlNeto).toBe(5);
    expect(m.winRatePct).toBe(50);
    expect(m.profitFactor).toBe(2);
  });

  test("una compra sin su venta no cuenta como operacion", () => {
    const m = metricasDeEjecuciones(
      [{ side: "buy", pnl: 0, created_at: "2026-10-01T00:00:00Z" }],
      1000,
    );
    expect(m.operaciones).toBe(0);
    expect(m.pnlNeto).toBe(0);
  });

  test("el drawdown se mide sobre el capital", () => {
    // Gana 100 y luego pierde 200: el P&L acumulado pasa de +100 a -100, asi
    // que la caida desde el pico es de 200, un 20 % de 1000 de capital.
    const m = metricasDeEjecuciones(
      [
        { side: "sell", pnl: 100, created_at: "2026-10-01T00:00:00Z" },
        { side: "sell", pnl: -200, created_at: "2026-10-02T00:00:00Z" },
      ],
      1000,
    );
    expect(m.maxDrawdownPct).toBe(20);
  });

  test("sin operaciones no hay metricas inventadas", () => {
    const m = metricasDeEjecuciones([], 1000);
    expect(m.operaciones).toBe(0);
    expect(m.winRatePct).toBe(0);
    expect(m.profitFactor).toBe(0);
    expect(m.maxDrawdownPct).toBe(0);
  });
});

describe("evaluarGate", () => {
  test("pasa con todos los criterios cumplidos", () => {
    const metricas = metricasDeEjecuciones(
      Array.from({ length: 120 }, (_, i) => ({
        side: "sell",
        pnl: i % 4 === 0 ? -2 : 3,
        created_at: "2026-10-01T00:00:00Z",
      })),
      1000,
    );
    const r = evaluarGate(CRITERIOS, metricas);
    expect(r.razones).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("bloquea por pocas operaciones", () => {
    const r = evaluarGate(CRITERIOS, metricasDeEjecuciones(EJECUCIONES, 1000));
    expect(r.ok).toBe(false);
    expect(r.razones.join(" ")).toContain("operaciones cerradas");
  });

  test("bloquea por P&L negativo", () => {
    const r = evaluarGate(CRITERIOS, {
      operaciones: 200,
      pnlNeto: -50,
      winRatePct: 40,
      profitFactor: 0.8,
      maxDrawdownPct: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.razones.join(" ")).toContain("P&L neto");
  });

  test("bloquea por drawdown por encima del limite", () => {
    const r = evaluarGate(CRITERIOS, {
      operaciones: 200,
      pnlNeto: 100,
      winRatePct: 60,
      profitFactor: 1.5,
      maxDrawdownPct: 45,
    });
    expect(r.ok).toBe(false);
    expect(r.razones.join(" ")).toContain("Drawdown");
  });

  test("bloquea si no supera al benchmark", () => {
    const r = evaluarGate(
      { ...CRITERIOS, botReturnPct: 1, benchmarkReturnPct: 5 },
      {
        operaciones: 200,
        pnlNeto: 100,
        winRatePct: 60,
        profitFactor: 1.5,
        maxDrawdownPct: 5,
      },
    );
    expect(r.ok).toBe(false);
    expect(r.razones.join(" ")).toContain("benchmark");
  });

  test("exige stop loss, take profit y credenciales verificadas", () => {
    const r = evaluarGate(
      { ...CRITERIOS, stopLossPct: 0, takeProfitPct: 0, binanceVerificado: false },
      {
        operaciones: 200,
        pnlNeto: 100,
        winRatePct: 60,
        profitFactor: 1.5,
        maxDrawdownPct: 5,
      },
    );
    const texto = r.razones.join(" ");
    expect(texto).toContain("stop-loss");
    expect(texto).toContain("take-profit");
    expect(texto).toContain("API Keys");
  });

  test("devuelve TODOS los motivos, no solo el primero", () => {
    const r = evaluarGate(
      { ...CRITERIOS, dias: 5, minDias: 30, stopLossPct: 0 },
      metricasDeEjecuciones([], 1000),
    );
    expect(r.razones.length).toBeGreaterThanOrEqual(4);
  });
});
