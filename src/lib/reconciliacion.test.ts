import { describe, expect, test } from "bun:test";

import { compararPosicion } from "./reconciliacion";

describe("compararPosicion", () => {
  test("todo cuadra: sin discrepancias", () => {
    expect(compararPosicion({ cantidad: 0.5, precio: 100 }, 0.5)).toEqual([]);
  });

  test("el motor cree que tiene posicion y el exchange no", () => {
    const d = compararPosicion({ cantidad: 0.5, precio: 100 }, 0);
    expect(d.length).toBe(1);
    expect(d[0]!.tipo).toBe("posicion_sin_exchange");
    expect(d[0]!.local).toBe(0.5);
  });

  test("el exchange tiene una posicion que el motor no conoce", () => {
    const d = compararPosicion(null, 1.25);
    expect(d.length).toBe(1);
    expect(d[0]!.tipo).toBe("sin_posicion_local");
  });

  test("las cantidades no coinciden (venta parcial o fill parcial)", () => {
    const d = compararPosicion({ cantidad: 0.5, precio: 100 }, 0.3);
    expect(d.length).toBe(1);
    expect(d[0]!.tipo).toBe("cantidad_distinta");
    expect(d[0]!.exchange).toBe(0.3);
  });

  test("sin datos del exchange NO se inventa una discrepancia de posicion", () => {
    const d = compararPosicion({ cantidad: 0.5, precio: 100 }, null);
    expect(d.length).toBe(1);
    expect(d[0]!.detalle).toContain("No se pudo consultar");
  });

  test("diferencias minimas se consideran iguales", () => {
    expect(compararPosicion({ cantidad: 0.5, precio: 100 }, 0.500000001)).toEqual([]);
  });

  test("sin posicion local y sin saldo en el exchange: nada que hacer", () => {
    expect(compararPosicion(null, 0)).toEqual([]);
  });
});
