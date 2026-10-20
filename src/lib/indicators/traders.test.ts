import { describe, expect, test } from "bun:test";

import {
  AUX_TRADERS_TAKER,
  AUX_TRADERS_TOP,
  alinearSerie,
  unirAux,
  ultimoValor,
  ultimosUtiles,
} from "./auxiliares";
import { takerFlow, topTraders } from "./traders";
import type { PriceSeries } from "./types";

function serie(closes: number[], aux?: Record<string, number[]>): PriceSeries {
  return {
    open: closes.slice(),
    closes: closes.slice(),
    highs: closes.map((c) => c * 1.01),
    lows: closes.map((c) => c * 0.99),
    volumes: closes.map(() => 100),
    times: closes.map((_, i) => new Date(1_700_000_000_000 + i * 3_600_000).toISOString()),
    ...(aux ? { aux } : {}),
  };
}

describe("alinearSerie (datos de traders contra velas)", () => {
  test("cada vela toma el ultimo dato conocido en ese momento", () => {
    const velas = [{ time: 1000 }, { time: 2000 }, { time: 3000 }];
    const datos = [
      { time: 500, valor: 1.5 },
      { time: 1500, valor: 2.0 },
      { time: 2500, valor: 2.5 },
    ];
    const salida = alinearSerie(velas, datos, "x");
    expect(salida["x"]).toEqual([1.5, 2.0, 2.5]);
  });

  test("antes del primer dato no hay valor (NaN, no un numero inventado)", () => {
    const velas = [{ time: 100 }, { time: 2000 }];
    const datos = [{ time: 1500, valor: 2.0 }];
    const salida = alinearSerie(velas, datos, "x");
    expect(Number.isNaN(salida["x"]?.[0] ?? 0)).toBe(true);
    expect(salida["x"]?.[1]).toBe(2.0);
  });

  test("nunca mira el futuro: un dato posterior a la vela no se usa", () => {
    const velas = [{ time: 1000 }];
    const datos = [{ time: 5000, valor: 9.9 }];
    const salida = alinearSerie(velas, datos, "x");
    expect(Number.isNaN(salida["x"]?.[0] ?? 0)).toBe(true);
  });

  test("unirAux combina varias series", () => {
    const a = alinearSerie([{ time: 1 }], [{ time: 0, valor: 1 }], "a");
    const b = alinearSerie([{ time: 1 }], [{ time: 0, valor: 2 }], "b");
    const unido = unirAux([a, b]);
    expect(unido["a"]).toEqual([1]);
    expect(unido["b"]).toEqual([2]);
  });
});

describe("ultimoValor / ultimosUtiles", () => {
  test("el ultimo valor util ignora los NaN", () => {
    expect(ultimoValor([1, 2, Number.NaN])).toBe(2);
    expect(ultimoValor([Number.NaN])).toBeNull();
    expect(ultimoValor(undefined)).toBeNull();
  });

  test("ultimosUtiles devuelve los ultimos N sin NaN", () => {
    expect(ultimosUtiles([1, Number.NaN, 2, 3], 2)).toEqual([2, 3]);
  });
});

describe("indicador top_traders (copy trading de traders reales)", () => {
  test("sin datos de traders NO hay senal (no se inventa)", () => {
    const s = serie([100, 101, 102, 103]);
    expect(topTraders.signal(s, {})).toBeNull();
  });

  test("compra cuando los grandes estan comprados y la tendencia sube", () => {
    const s = serie([100, 101, 102, 103], { [AUX_TRADERS_TOP]: [1.5, 1.6, 1.7, 1.8] });
    expect(topTraders.signal(s, { umbral: 1.15, ventana: 3 })).toBe("buy");
  });

  test("vende cuando los grandes estan vendidos y la tendencia baja", () => {
    const s = serie([100, 101, 102, 103], { [AUX_TRADERS_TOP]: [0.6, 0.55, 0.5, 0.45] });
    expect(topTraders.signal(s, { umbral: 1.15, ventana: 3 })).toBe("sell");
  });

  test("en zona neutra no hay senal", () => {
    const s = serie([100, 101, 102, 103], { [AUX_TRADERS_TOP]: [1.0, 1.01, 1.0, 1.0] });
    expect(topTraders.signal(s, { umbral: 1.15, ventana: 3 })).toBeNull();
  });

  test("si el ratio se debilita, no compra aunque siga por encima del umbral", () => {
    const s = serie([100, 101, 102, 103], { [AUX_TRADERS_TOP]: [1.9, 1.8, 1.7, 1.6] });
    expect(topTraders.signal(s, { umbral: 1.15, ventana: 3 })).toBeNull();
  });
});

describe("indicador taker_flow (flujo real de ordenes)", () => {
  test("sin datos NO hay senal", () => {
    const s = serie(Array.from({ length: 30 }, (_, i) => 100 + i));
    expect(takerFlow.signal(s, {})).toBeNull();
  });

  test("compra si el flujo es comprador y el precio esta sobre su media", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const s = serie(closes, { [AUX_TRADERS_TAKER]: Array(30).fill(1.2) });
    expect(takerFlow.signal(s, { umbral: 1.05, periodo: 20 })).toBe("buy");
  });

  test("vende si el flujo es vendedor y el precio esta bajo su media", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 130 - i);
    const s = serie(closes, { [AUX_TRADERS_TAKER]: Array(30).fill(0.8) });
    expect(takerFlow.signal(s, { umbral: 1.05, periodo: 20 })).toBe("sell");
  });

  test("si el flujo no coincide con el precio, no hay senal", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const s = serie(closes, { [AUX_TRADERS_TAKER]: Array(30).fill(0.8) });
    expect(takerFlow.signal(s, { umbral: 1.05, periodo: 20 })).toBeNull();
  });
});
