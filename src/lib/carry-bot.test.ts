import { describe, expect, test } from "bun:test";

import { decidirCobertura, pnlCobertura } from "./carry-bot";

describe("decision del bot de cobertura", () => {
  const base = {
    basePct: 0.1,
    mediaCuotasPct: 0.005,
    ultimaCuotaPct: 0.006,
    periodosNegativos: 0,
  };

  test("sin posicion y con basis y financiacion positivos: abre", () => {
    const d = decidirCobertura({ ...base, tienePosicion: false });
    expect(d.accion).toBe("abrir");
    expect(d.motivo).toContain("Basis");
  });

  test("sin posicion y sin diferencia (basis negativo): no abre", () => {
    const d = decidirCobertura({ ...base, tienePosicion: false, basePct: -0.05 });
    expect(d.accion).toBe("mantener");
    expect(d.motivo).toContain("por debajo del spot");
  });

  test("sin posicion y con la financiacion media negativa: no abre", () => {
    const d = decidirCobertura({
      ...base,
      tienePosicion: false,
      mediaCuotasPct: -0.001,
    });
    expect(d.accion).toBe("mantener");
    expect(d.motivo).toContain("financiacion media");
  });

  test("sin posicion y con el basis muy ancho: no entra (puede desmontarse)", () => {
    const d = decidirCobertura({ ...base, tienePosicion: false, basePct: 1.8 });
    expect(d.accion).toBe("mantener");
    expect(d.motivo).toContain("muy ancho");
  });

  test("con posicion y financiacion positiva: mantiene", () => {
    const d = decidirCobertura({ ...base, tienePosicion: true });
    expect(d.accion).toBe("mantener");
    expect(d.motivo).toContain("sigue cobrando");
  });

  test("con posicion y el basis invertido: cierra", () => {
    const d = decidirCobertura({ ...base, tienePosicion: true, basePct: -0.01 });
    expect(d.accion).toBe("cerrar");
    expect(d.motivo).toContain("pasado por debajo");
  });

  test("con posicion y dos cuotas negativas seguidas: cierra", () => {
    const d = decidirCobertura({
      ...base,
      tienePosicion: true,
      periodosNegativos: 2,
      ultimaCuotaPct: -0.002,
    });
    expect(d.accion).toBe("cerrar");
    expect(d.motivo).toContain("negativas seguidas");
  });
});

describe("PnL de la cobertura", () => {
  test("no depende de la direccion del precio (solo de las cuotas)", () => {
    const a = pnlCobertura({
      spotInicial: 100,
      spotFinal: 150,
      perpInicial: 100,
      perpFinal: 150,
      cuotas: 0.05,
    });
    const b = pnlCobertura({
      spotInicial: 100,
      spotFinal: 50,
      perpInicial: 100,
      perpFinal: 50,
      cuotas: 0.05,
    });
    expect(a).toBeCloseTo(0.05, 9);
    expect(b).toBeCloseTo(0.05, 9);
  });

  test("las comisiones se restan", () => {
    const p = pnlCobertura({
      spotInicial: 100,
      spotFinal: 100,
      perpInicial: 100,
      perpFinal: 100,
      cuotas: 0.05,
      comisiones: 0.004,
    });
    expect(p).toBeCloseTo(0.046, 9);
  });

  test("si el perp se aleja del spot al alza, la cobertura pierde (basis)", () => {
    // El perp SUBE y se separa del spot: la pata corta pierde.
    const p = pnlCobertura({
      spotInicial: 100,
      spotFinal: 100,
      perpInicial: 100.2,
      perpFinal: 100.6,
      cuotas: 0.05,
    });
    expect(p).toBeLessThan(0.05);
  });
});
