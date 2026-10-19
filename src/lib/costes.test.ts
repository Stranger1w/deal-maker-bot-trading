import { describe, expect, test } from "bun:test";

import { COMISION_SPOT, costeIdaYVuelta, tpCubreCostes } from "./costes";

describe("costeIdaYVuelta", () => {
  test("comisiones y slippage de ida y vuelta, con margen", () => {
    // 0,1 % x 2 lados con 10 % de descuento = 0,18 %; slippage 0,05 % x 2 = 0,1 %.
    // Con margen 2: (0,0018 + 0,001) x 2 = 0,56 %.
    expect(costeIdaYVuelta({ margen: 1 })).toBeCloseTo(0.0028, 6);
    expect(costeIdaYVuelta()).toBeCloseTo(0.0056, 6);
  });

  test("sin descuento BNB el coste es mayor", () => {
    expect(costeIdaYVuelta({ descuentoBnb: 0, margen: 1 })).toBeCloseTo(0.003, 6);
  });
});

describe("tpCubreCostes", () => {
  test("un take-profit de 0,2 % no cubre el coste: se rechaza", () => {
    const v = tpCubreCostes(0.2);
    expect(v.ok).toBe(false);
    expect(v.motivo).toContain("no cubre el coste");
    expect(v.minimoPct).toBeGreaterThan(0.2);
  });

  test("un take-profit de 4 % lo cubre de sobra", () => {
    const v = tpCubreCostes(4);
    expect(v.ok).toBe(true);
    expect(v.minimoPct).toBeCloseTo(0.56, 2);
  });

  test("un take-profit justo en el minimo se acepta", () => {
    const minimo = tpCubreCostes(0).minimoPct;
    expect(tpCubreCostes(minimo).ok).toBe(true);
  });

  test("take-profit 0 o negativo: se rechaza con otro motivo", () => {
    expect(tpCubreCostes(0).ok).toBe(false);
    expect(tpCubreCostes(-1).ok).toBe(false);
    expect(tpCubreCostes(0).motivo).toContain("mayor que cero");
  });

  test("el minimo depende del modelo de costes", () => {
    const barato = tpCubreCostes(0.1, { comision: 0, slippage: 0, margen: 1 });
    expect(barato.ok).toBe(true);
    const caro = tpCubreCostes(0.1, { comision: COMISION_SPOT, slippage: 0.002, margen: 1 });
    expect(caro.ok).toBe(false);
  });
});
