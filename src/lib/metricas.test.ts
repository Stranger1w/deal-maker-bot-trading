import { describe, expect, test } from "bun:test";

import {
  botsSinVentaja,
  horaDe,
  operacionesCerradas,
  resumenPor,
  type OperacionMedida,
} from "./metricas";

function op(
  campos: Partial<OperacionMedida> & { botId: string; botName: string },
): OperacionMedida {
  return {
    simbolo: "BTCUSDT",
    lado: "sell",
    pnl: 0,
    modo: "demo",
    precio: 100,
    cantidad: 1,
    createdAt: "2026-10-01T10:00:00.000Z",
    indicadores: ["rsi"],
    motivo: "cierre_senal",
    ...campos,
  };
}

describe("resumenPor", () => {
  test("resume un grupo: operaciones, P&L, win rate y profit factor", () => {
    const ops = [
      op({ botId: "b1", botName: "Alfa", pnl: 10 }),
      op({ botId: "b1", botName: "Alfa", pnl: -4 }),
      op({ botId: "b1", botName: "Alfa", pnl: 6 }),
    ];
    const g = resumenPor((o) => o.botId, ops)[0]!;
    expect(g.clave).toBe("b1");
    expect(g.operaciones).toBe(3);
    expect(g.pnlNeto).toBe(12);
    expect(g.ganadoras).toBe(2);
    expect(g.winRatePct).toBeCloseTo(66.67, 2);
    expect(g.profitFactor).toBe(4);
    expect(g.mejorOperacion).toBe(10);
    expect(g.peorOperacion).toBe(-4);
  });

  test("marca los grupos con pocas operaciones como sin significado", () => {
    const g = resumenPor((o) => o.botId, [op({ botId: "b1", botName: "Alfa" })])[0]!;
    expect(g.sinSignificado).toBe(true);
  });

  test("ordena por P&L: primero el que mas gana", () => {
    const ops = [
      op({ botId: "malo", botName: "Malo", pnl: -50 }),
      op({ botId: "bueno", botName: "Bueno", pnl: 50 }),
    ];
    const g = resumenPor((o) => o.botId, ops);
    expect(g[0]!.clave).toBe("bueno");
  });

  test("las claves null se ignoran", () => {
    const ops = [op({ botId: "b1", botName: "Alfa" })];
    expect(resumenPor(() => null, ops)).toEqual([]);
  });
});

describe("operacionesCerradas", () => {
  test("solo cuenta las ventas (las que tienen P&L)", () => {
    const ops = [
      op({ botId: "b1", botName: "Alfa", lado: "buy", pnl: 0 }),
      op({ botId: "b1", botName: "Alfa", lado: "sell", pnl: 5 }),
    ];
    const cerradas = operacionesCerradas(ops);
    expect(cerradas.length).toBe(1);
    expect(cerradas[0]!.pnl).toBe(5);
  });
});

describe("horaDe", () => {
  test("devuelve la hora UTC en dos digitos", () => {
    expect(horaDe("2026-10-01T09:05:00.000Z")).toBe("09");
    expect(horaDe("2026-10-01T23:30:00.000Z")).toBe("23");
  });
});

describe("botsSinVentaja", () => {
  test("avisa de los bots con muchas operaciones y profit factor bajo 1", () => {
    const ops = Array.from({ length: 40 }, (_, i) =>
      op({ botId: "quemado", botName: "Quemado", pnl: -1 * (i % 3) }),
    );
    ops.push(...Array.from({ length: 5 }, () => op({ botId: "poco", botName: "Poco", pnl: -1 })));
    const sinVentaja = botsSinVentaja(ops, { minimoOperaciones: 30 });
    expect(sinVentaja.length).toBe(1);
    expect(sinVentaja[0]!.botName).toBe("Quemado");
    expect(sinVentaja[0]!.operaciones).toBe(40);
  });

  test("con pocas operaciones no avisa (seria ruido)", () => {
    const ops = Array.from({ length: 5 }, () => op({ botId: "b1", botName: "Alfa", pnl: -1 }));
    expect(botsSinVentaja(ops, { minimoOperaciones: 30 })).toEqual([]);
  });

  test("un bot que gana no aparece", () => {
    const ops = Array.from({ length: 40 }, () => op({ botId: "b1", botName: "Alfa", pnl: 2 }));
    expect(botsSinVentaja(ops, { minimoOperaciones: 30 })).toEqual([]);
  });
});
