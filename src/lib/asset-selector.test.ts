import { describe, expect, test } from "bun:test";
import {
  MARGEN_HISTÉRESIS,
  decidirConHisteresis,
  esParElegible,
  filtrarCandidatos,
  puntuarPar,
  type Candidato,
} from "./asset-selector.server";
import type { ParMercado } from "./markets.server";

function fila(
  symbol: string,
  base: string,
  quoteVolume: number,
  extra?: Partial<ParMercado>,
): ParMercado {
  return {
    symbol,
    base,
    quote: "USDT",
    price: 100,
    changePct: 2,
    quoteVolume,
    high: 105,
    low: 95,
    volatility: 0.1,
    ...extra,
  };
}

describe("puntuarPar", () => {
  test("volumen normalizado + volatilidad con tope + momentum", () => {
    const { score, componentes } = puntuarPar(
      { quoteVolume: 500, volatility: 0.1, changePct: 10 },
      1000,
    );
    expect(componentes.volumen).toBeCloseTo(0.5, 10);
    expect(componentes.volatilidad).toBeCloseTo(0.1 / 0.15, 10);
    expect(componentes.momentum).toBeCloseTo(0.75, 10);
    expect(score).toBeCloseTo(0.5 * 0.5 + 0.3 * (0.1 / 0.15) + 0.2 * 0.75, 10);
  });

  test("un pump extremo no domina (tope de volatilidad)", () => {
    const a = puntuarPar({ quoteVolume: 100, volatility: 0.15, changePct: 0 }, 100);
    const b = puntuarPar({ quoteVolume: 100, volatility: 5, changePct: 0 }, 100);
    expect(a.componentes.volatilidad).toBe(1);
    expect(b.componentes.volatilidad).toBe(1);
    expect(a.score).toBe(b.score);
  });
});

describe("esParElegible", () => {
  test("acepta spot USDT normal", () => {
    expect(esParElegible("BTCUSDT", "BTC", "USDT")).toBe(true);
  });
  test("excluye stablecoins y fiat", () => {
    expect(esParElegible("USDCUSDT", "USDC", "USDT")).toBe(false);
    expect(esParElegible("EURUSDT", "EUR", "USDT")).toBe(false);
  });
  test("excluye apalancados UP/DOWN/BULL/BEAR", () => {
    expect(esParElegible("BTCUPUSDT", "BTCUP", "USDT")).toBe(false);
    expect(esParElegible("ETHBEARUSDT", "ETHBEAR", "USDT")).toBe(false);
    expect(esParElegible("BTCDOWNUSDT", "BTC", "USDT")).toBe(false);
  });
  test("solo quote USDT en v1", () => {
    expect(esParElegible("BTCUSDC", "BTC", "USDC")).toBe(false);
    expect(esParElegible("ETHBTC", "ETH", "BTC")).toBe(false);
  });
});

describe("filtrarCandidatos", () => {
  test("volumen mínimo, elegibilidad y orden por score", () => {
    const rows = [
      fila("BTCUSDT", "BTC", 1_000_000),
      fila("CHICOUSDT", "CHICO", 10),
      fila("USDCUSDT", "USDC", 5_000_000),
      fila("BTCUPUSDT", "BTCUP", 9_000_000),
    ];
    const out = filtrarCandidatos(rows, { minVolumen: 100_000, paresOcupados: new Set() });
    expect(out.map((c) => c.symbol)).toEqual(["BTCUSDT"]);
  });

  test("excluye pares ya asignados a otro bot", () => {
    const rows = [fila("BTCUSDT", "BTC", 1_000_000), fila("ETHUSDT", "ETH", 900_000)];
    const out = filtrarCandidatos(rows, { minVolumen: 0, paresOcupados: new Set(["BTCUSDT"]) });
    expect(out.map((c) => c.symbol)).toEqual(["ETHUSDT"]);
  });
});

describe("decidirConHisteresis", () => {
  const cand = (symbol: string, score: number): Candidato => ({
    symbol,
    price: 100,
    score,
    componentes: { volumen: 0.5, volatilidad: 0.5, momentum: 0.5 },
  });

  test("sin candidatos: conserva el par", () => {
    const d = decidirConHisteresis(cand("BTCUSDT", 0.5), null, {
      ahora: 1_000,
      ultimoCambioEn: null,
      forzarIntervalo: false,
    });
    expect(d.cambiar).toBe(false);
    expect(d.motivo).toBe("sin_candidatos");
  });

  test("mismo par: se mantiene aunque suba mucho", () => {
    const d = decidirConHisteresis(cand("BTCUSDT", 0.5), cand("BTCUSDT", 0.9), {
      ahora: 1_000,
      ultimoCambioEn: null,
      forzarIntervalo: false,
    });
    expect(d.cambiar).toBe(false);
    expect(d.motivo).toBe("mantiene_actual");
  });

  test("sin mejora suficiente (margen 5 %): se mantiene", () => {
    const d = decidirConHisteresis(
      cand("BTCUSDT", 0.5),
      cand("ETHUSDT", 0.5 * (1 + MARGEN_HISTÉRESIS) - 0.001),
      {
        ahora: 1_000,
        ultimoCambioEn: null,
        forzarIntervalo: false,
      },
    );
    expect(d.motivo).toBe("sin_mejora_suficiente");
  });

  test("intervalo mínimo: bloquea aunque supere el margen", () => {
    const d = decidirConHisteresis(cand("BTCUSDT", 0.5), cand("ETHUSDT", 0.9), {
      ahora: 3_600_000,
      ultimoCambioEn: 3_500_000,
      forzarIntervalo: false,
    });
    expect(d.motivo).toBe("intervalo_minimo");
  });

  test("forzar intervalo (Aplicar manual): cambia", () => {
    const d = decidirConHisteresis(cand("BTCUSDT", 0.5), cand("ETHUSDT", 0.9), {
      ahora: 3_600_000,
      ultimoCambioEn: 3_500_000,
      forzarIntervalo: true,
    });
    expect(d.cambiar).toBe(true);
    expect(d.motivo).toBe("mejor_candidato");
  });
});
