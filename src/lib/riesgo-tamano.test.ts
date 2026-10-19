import { describe, expect, test } from "bun:test";

import { detectarRegimen, operarEnRegimen } from "./regimen";
import { atr, tamanoPorRiesgo } from "./riesgo-tamano";

/** Serie plana: sin tendencia y sin volatilidad. */
function planas(n: number) {
  return Array.from({ length: n }, () => ({ high: 100, low: 100, close: 100 }));
}

/** Serie que sube de forma constante (tendencia alcista suave). */
function subiendo(n: number, paso = 1) {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i * paso;
    return { high: c + 0.2, low: c - 0.2, close: c };
  });
}

/** Serie que baja de forma constante. */
function bajando(n: number, paso = 1) {
  return Array.from({ length: n }, (_, i) => {
    const c = 200 - i * paso;
    return { high: c + 0.2, low: c - 0.2, close: c };
  });
}

describe("atr", () => {
  test("no hay ATR con pocas velas", () => {
    expect(atr(planas(5))).toBeNull();
  });

  test("serie plana: el rango es cero (no se inventa volatilidad)", () => {
    expect(atr(planas(20))).toBeNull();
  });

  test("serie con rango: el ATR es positivo", () => {
    const velas = Array.from({ length: 30 }, (_, i) => ({
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
    }));
    const valor = atr(velas);
    expect(valor).not.toBeNull();
    expect(valor!).toBeGreaterThan(0);
  });
});

describe("tamanoPorRiesgo", () => {
  test("el monto sale del riesgo y la distancia del stop", () => {
    // 1000 de capital, 1 % de riesgo, stop del 2 %: se arriesga 10 USDT
    // y el stop esta al 2 %, asi que la posicion es de 500.
    const r = tamanoPorRiesgo({
      capital: 1000,
      riesgoPorOperacion: 0.01,
      precio: 100,
      stopLossPct: 2,
      topeFraccionCapital: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.monto).toBeCloseTo(500, 4);
    expect(r.riesgoPct).toBeCloseTo(1, 4);
  });

  test("un stop mas estrecho NO da un monto mayor (el tope manda)", () => {
    const base = {
      capital: 1000,
      riesgoPorOperacion: 0.01,
      precio: 100,
      topeFraccionCapital: 0.1,
    };
    const estrecho = tamanoPorRiesgo({ ...base, stopLossPct: 1 });
    const ancho = tamanoPorRiesgo({ ...base, stopLossPct: 4 });
    // El tope del 10 % del capital manda en los dos casos.
    expect(estrecho.monto).toBeCloseTo(100, 4);
    expect(ancho.monto).toBeCloseTo(100, 4);
  });

  test("sin stop no se opera (no se inventa el riesgo)", () => {
    const r = tamanoPorRiesgo({
      capital: 1000,
      riesgoPorOperacion: 0.01,
      precio: 100,
      stopLossPct: 0,
      topeFraccionCapital: 0.1,
    });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain("stop-loss");
  });

  test("el stop por ATR amplia el stop si el par es volatil", () => {
    const conVol = tamanoPorRiesgo({
      capital: 1000,
      riesgoPorOperacion: 0.01,
      precio: 100,
      stopLossPct: 2,
      topeFraccionCapital: 1,
      atrPct: 5,
      stopPorAtr: 1.5,
    });
    // stop = 1,5 x 5 % = 7,5 % -> posicion de 1000 x 1 % / 7,5 % = 133,3
    expect(conVol.stopUsadoPct).toBeCloseTo(7.5, 4);
    expect(conVol.monto).toBeCloseTo(133.33, 1);
  });

  test("capital cero: no se opera", () => {
    expect(
      tamanoPorRiesgo({
        capital: 0,
        riesgoPorOperacion: 0.01,
        precio: 100,
        stopLossPct: 2,
        topeFraccionCapital: 1,
      }).ok,
    ).toBe(false);
  });

  test("sin precio tambien se puede calcular el monto (va en moneda de cotizacion)", () => {
    const r = tamanoPorRiesgo({
      capital: 1000,
      riesgoPorOperacion: 0.01,
      stopLossPct: 2,
      topeFraccionCapital: 1,
    });
    expect(r.ok).toBe(true);
    expect(r.monto).toBeCloseTo(500, 4);
  });
});

describe("detectarRegimen", () => {
  test("serie plana: lateral", () => {
    const r = detectarRegimen(planas(40));
    expect(r.regimen).toBe("lateral");
  });

  test("serie que sube: tendencia alcista", () => {
    const r = detectarRegimen(subiendo(40));
    expect(r.regimen).toBe("tendencia_alcista");
  });

  test("serie que baja: tendencia bajista", () => {
    const r = detectarRegimen(bajando(40));
    expect(r.regimen).toBe("tendencia_bajista");
  });

  test("volatilidad extrema manda sobre la tendencia", () => {
    const volatil = Array.from({ length: 40 }, (_, i) => ({
      high: 100 + (i % 2 === 0 ? 6 : -6),
      low: 100 + (i % 2 === 0 ? -6 : 6),
      close: 100 + i * 0.1,
    }));
    const r = detectarRegimen(volatil, { umbralVolatilidadPct: 3 });
    expect(r.regimen).toBe("volatilidad_extrema");
  });
});

describe("operarEnRegimen", () => {
  test("volatilidad extrema: no se opera nunca", () => {
    const r = operarEnRegimen({
      regimen: "volatilidad_extrema",
      tipoEstrategia: "tendencia",
      activo: true,
    });
    expect(r.permitido).toBe(false);
  });

  test("reversion en tendencia fuerte: no se opera", () => {
    const r = operarEnRegimen({
      regimen: "tendencia_bajista",
      tipoEstrategia: "reversion",
      activo: true,
    });
    expect(r.permitido).toBe(false);
  });

  test("tendencia en tendencia contraria: no se opera", () => {
    const r = operarEnRegimen({
      regimen: "tendencia_bajista",
      tipoEstrategia: "tendencia",
      activo: true,
    });
    expect(r.permitido).toBe(false);
  });

  test("reversion en lateral: se opera", () => {
    const r = operarEnRegimen({
      regimen: "lateral",
      tipoEstrategia: "reversion",
      activo: true,
    });
    expect(r.permitido).toBe(true);
  });

  test("con el filtro apagado, se opera siempre", () => {
    const r = operarEnRegimen({
      regimen: "volatilidad_extrema",
      tipoEstrategia: "reversion",
      activo: false,
    });
    expect(r.permitido).toBe(true);
  });
});
