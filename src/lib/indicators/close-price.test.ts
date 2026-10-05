import { describe, expect, test } from "bun:test";
import { closePrice, soloBaja, soloSube } from "./close-price";
import { rsi, rsiWilder } from "./rsi";
import type { PriceSeries } from "./types";
import expected from "./__fixtures__/expected.json";
import dataset from "./__fixtures__/dataset.json";

const ref = (expected as { _series_desde_corte: Record<string, (number | null)[]> })
  ._series_desde_corte;
const cierres = (dataset as { closes: number[] }).closes;
const CORTE = (expected as { corte: number }).corte;

/** Construye una serie OHLCV sintetica a partir de los cierres. */
function serie(cierres: number[]): PriceSeries {
  return {
    open: cierres.slice(),
    closes: cierres,
    highs: cierres.map((c) => c + 1),
    lows: cierres.map((c) => c - 1),
  };
}

/** Serie ascendente: 1, 2, 3, ... n. */
function ascendente(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

/** Serie descendente: n, n-1, ... 1. */
function descendente(n: number): number[] {
  return Array.from({ length: n }, (_, i) => n - i);
}

/** Serie plana: 10, 10, 10... */
function plana(n: number): number[] {
  return Array.from({ length: n }, () => 10);
}

describe("close-price · deteccion de secuencia", () => {
  test("serie ascendente de 3 -> soloSube", () => {
    expect(soloSube([1, 2, 3], 3)).toBe(true);
    expect(soloBaja([1, 2, 3], 3)).toBe(false);
  });

  test("serie descendente de 3 -> soloBaja", () => {
    expect(soloBaja([3, 2, 1], 3)).toBe(true);
    expect(soloSube([3, 2, 1], 3)).toBe(false);
  });

  test("serie mixta -> ninguna de las dos", () => {
    expect(soloSube([1, 3, 2], 3)).toBe(false);
    expect(soloBaja([1, 3, 2], 3)).toBe(false);
  });

  test("serie plana -> ninguna (no hay direccion)", () => {
    expect(soloSube(plana(5), 3)).toBe(false);
    expect(soloBaja(plana(5), 3)).toBe(false);
  });

  test("empates exactos no cuentan como subida ni bajada", () => {
    expect(soloSube([1, 2, 2], 3)).toBe(false);
    expect(soloBaja([2, 1, 1], 3)).toBe(false);
  });
});

describe("close-price · senal", () => {
  test("3 cierres al alza -> buy", () => {
    expect(closePrice.signal(serie([10, 11, 12]), {})).toBe("buy");
  });

  test("3 cierres a la baja -> sell", () => {
    expect(closePrice.signal(serie([12, 11, 10]), {})).toBe("sell");
  });

  test("velas mixtas -> null (no hay senal)", () => {
    expect(closePrice.signal(serie([10, 12, 11]), {})).toBeNull();
  });

  test("serie plana -> null, nunca NaN", () => {
    expect(closePrice.signal(serie(plana(10)), {})).toBeNull();
  });

  test("menos velas que el periodo -> null", () => {
    expect(closePrice.signal(serie([1, 2]), { periodo: 3 })).toBeNull();
  });

  test("periodo customizing: usa solo los ultimos N", () => {
    // Con periodo 2 solo mira los 2 ultimos: 10 -> 12 es subida.
    expect(closePrice.signal(serie([5, 9, 10, 12]), { periodo: 2 })).toBe("buy");
  });

  test("periodo incoherente (< 2) -> null, no lanza", () => {
    expect(closePrice.signal(serie(ascendente(10)), { periodo: 1 })).toBeNull();
    expect(closePrice.signal(serie(ascendente(10)), { periodo: Number.NaN })).toBeNull();
  });
});

describe("rsi · calculo con suavizado de Wilder", () => {
  test("serie ascendente pura -> 100 (no hay perdidas)", () => {
    const valor = rsiWilder(ascendente(20), 14);
    expect(valor).toBe(100);
  });

  test("serie descendente pura -> 0 (no hay ganancias)", () => {
    const valor = rsiWilder(descendente(20), 14);
    expect(valor).toBe(0);
  });

  test("serie totalmente plana -> null, no NaN ni 50 inventado", () => {
    const valor = rsiWilder(plana(30), 14);
    expect(valor).toBeNull();
    // Cuando no hay valor, no puede haber NaN: la condicion cubre ambos casos.
    expect(valor === null || Number.isFinite(valor)).toBe(true);
    expect(valor).not.toBe(50);
  });

  test("menos cierres que periodo+1 -> null", () => {
    expect(rsiWilder([1, 2, 3], 14)).toBeNull();
  });

  test("periodo invalido -> null, no lanza", () => {
    expect(rsiWilder(ascendente(30), 0)).toBeNull();
    expect(rsiWilder(ascendente(30), -5)).toBeNull();
    expect(rsiWilder(ascendente(30), Number.NaN)).toBeNull();
  });

  test("nunca devuelve NaN en ninguna combinacion", () => {
    for (const p of [2, 5, 14, 20]) {
      for (const s of [ascendente(30), descendente(30), plana(30), [5, 5, 6, 5, 5, 7]]) {
        const v = rsiWilder(s, p);
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
    }
  });

  test("serie mixta queda en un valor intermedio", () => {
    const valor = rsiWilder([44, 45, 44, 46, 45, 47, 46, 48, 47, 49, 48, 50, 49, 51, 50], 14);
    expect(valor).not.toBeNull();
    if (valor !== null) {
      expect(valor).toBeGreaterThan(0);
      expect(valor).toBeLessThan(100);
    }
  });
});

describe("rsi · senal por referencia (no por serie inventada)", () => {
  test("sobreventa: usa una vela donde la referencia dice RSI<30", () => {
    const rsiRef = ref["rsi14"] ?? [];
    // Localizamos el primer punto REAL de sobreventa en la serie de referencia.
    const k = rsiRef.findIndex((v) => v !== null && v < 30);
    expect(k).toBeGreaterThanOrEqual(0);
    const cierre = cierres[CORTE + k];
    const hastaAqui = cierres.slice(0, CORTE + k + 1);
    // El RSI sobre esa serie completa debe dar senal de compra.
    expect(cierre).toBeGreaterThan(0);
    expect(rsi.signal(serie(hastaAqui), {})).toBe("buy");
  });

  test("sobrecompra: usa una vela donde la referencia dice RSI>70", () => {
    const rsiRef = ref["rsi14"] ?? [];
    const k = rsiRef.findIndex((v) => v !== null && v > 70);
    expect(k).toBeGreaterThanOrEqual(0);
    const hastaAqui = cierres.slice(0, CORTE + k + 1);
    expect(rsi.signal(serie(hastaAqui), {})).toBe("sell");
  });

  test("zona neutra: la referencia tiene puntos entre 30 y 70 -> null", () => {
    const rsiRef = ref["rsi14"] ?? [];
    const k = rsiRef.findIndex((v) => v !== null && v > 40 && v < 60);
    expect(k).toBeGreaterThanOrEqual(0);
    const hastaAqui = cierres.slice(0, CORTE + k + 1);
    expect(rsi.signal(serie(hastaAqui), {})).toBeNull();
  });

  test("la serie tiene los tres regimes: sobreventa, neutro y sobrecompra", () => {
    const rsiRef = (ref["rsi14"] ?? []).filter((v) => v !== null) as number[];
    expect(rsiRef.some((v) => v < 30)).toBe(true);
    expect(rsiRef.some((v) => v > 40 && v < 60)).toBe(true);
    expect(rsiRef.some((v) => v > 70)).toBe(true);
  });
});

describe("rsi · senal (series sinteticas)", () => {
  test("subida pura sostenida -> sobrecompra -> sell", () => {
    const subida = ascendente(30);
    expect(rsi.signal(serie(subida), {})).toBe("sell");
  });

  test("serie plana -> null (RSI indefinido)", () => {
    expect(rsi.signal(serie(plana(30)), {})).toBeNull();
  });

  test("niveles invertidos -> null, no lanza", () => {
    expect(rsi.signal(serie(ascendente(30)), { sobreventa: 80, sobrecompra: 20 })).toBeNull();
  });

  test("minSamples = periodo + 1", () => {
    expect(rsi.minSamples).toBe(15);
  });
});
