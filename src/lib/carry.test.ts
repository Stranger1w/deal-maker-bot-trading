import { describe, expect, test } from "bun:test";

import { calcularCarry, pnlCarry, type Cuota } from "./carry.server";

/** Cuotas sinteticas: 3 al dia (cada 8 h) durante `dias`. */
function cuotas(dias: number, tasaPorCuota: number, desde = "2024-01-01T00:00:00Z"): Cuota[] {
  const salida: Cuota[] = [];
  const inicio = Date.parse(desde);
  for (let i = 0; i < dias * 3; i++) {
    salida.push({ t: inicio + i * 8 * 3_600_000, r: tasaPorCuota });
  }
  return salida;
}

describe("carry (comprar spot y vender perpetuo)", () => {
  test("las cuotas se suman y se anualizan", () => {
    const c = cuotas(365, 0.0001); // 0,01 % por cuota, 3 al dia
    const r = calcularCarry({
      cuotas: c,
      spotInicial: 100,
      spotFinal: 100,
      perpInicial: 100,
      perpFinal: 100,
    });
    // 1095 cuotas x 0,0001 = 10,95 % al año.
    expect(r.total).toBeCloseTo(0.1095, 6);
    expect(r.anualizado).toBeGreaterThan(10);
    expect(r.dias).toBe(365);
    expect(r.porAnyo.length).toBe(1);
    expect(r.porAnyo[0]?.anio).toBe(2024);
  });

  test("el carry no depende de la direccion del precio", () => {
    const c = cuotas(365, 0.0001);
    // El spot sube un 50 % y el perp tambien: las dos patas se cancelan.
    const r = pnlCarry({
      cuotas: c,
      spotInicial: 100,
      spotFinal: 150,
      perpInicial: 100,
      perpFinal: 150,
    });
    expect(r).toBeCloseTo(0.1095, 6);
    // Y si el precio baja un 50 %: lo mismo.
    const r2 = pnlCarry({
      cuotas: c,
      spotInicial: 100,
      spotFinal: 50,
      perpInicial: 100,
      perpFinal: 50,
    });
    expect(r2).toBeCloseTo(0.1095, 6);
  });

  test("el 'basis' se mide en los dos extremos", () => {
    const r = calcularCarry({
      cuotas: cuotas(30, 0.0001),
      spotInicial: 100,
      spotFinal: 100,
      perpInicial: 100.5,
      perpFinal: 99.8,
    });
    expect(r.basisInicialPct).toBeCloseTo(0.5, 6);
    expect(r.basisFinalPct).toBeCloseTo(-0.2, 6);
  });

  test("los años se separan y se anualizan por separado", () => {
    const c = [...cuotas(180, 0.0001), ...cuotas(185, 0.0002, "2025-01-01T00:00:00Z")];
    const r = calcularCarry({
      cuotas: c,
      spotInicial: 100,
      spotFinal: 100,
      perpInicial: 100,
      perpFinal: 100,
    });
    expect(r.porAnyo.length).toBe(2);
    expect(r.porAnyo[0]?.anio).toBe(2024);
    expect(r.porAnyo[1]?.anio).toBe(2025);
    // El segundo año con el doble de cuota: mas anualizado.
    expect(r.porAnyo[1]!.anualizado).toBeGreaterThan(r.porAnyo[0]!.anualizado);
  });

  test("sin cuotas no hay carry (no se inventa)", () => {
    const r = calcularCarry({
      cuotas: [],
      spotInicial: 100,
      spotFinal: 100,
      perpInicial: 100,
      perpFinal: 100,
    });
    expect(r.total).toBe(0);
    expect(r.porAnyo.length).toBe(0);
    expect(Number.isFinite(r.anualizado)).toBe(true);
  });
});
