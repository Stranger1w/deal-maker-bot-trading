import { describe, expect, test } from "bun:test";
import {
  calcularVolatilidad,
  decidirCambioPar,
  leerSimbolosEntorno,
  leerTickers,
  normalizarMercado,
  normalizarSimbolo,
} from "./markets.server";

describe("normalizarSimbolo", () => {
  test("mayúsculas sin separador, igual que bots y motor (BTCUSDT)", () => {
    expect(normalizarSimbolo("btcusdt")).toBe("BTCUSDT");
    expect(normalizarSimbolo("BTC/USDT")).toBe("BTCUSDT");
    expect(normalizarSimbolo("btc-usdt")).toBe("BTCUSDT");
    expect(normalizarSimbolo(" btc_usdt ")).toBe("BTCUSDT");
  });
});

describe("leerSimbolosEntorno", () => {
  test("solo TRADING y solo spot", () => {
    const body = {
      symbols: [
        { symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" },
        { symbol: "ETHUSDT", status: "BREAK", baseAsset: "ETH", quoteAsset: "USDT" },
        { symbol: "SOLUSDT", status: "TRADING", baseAsset: "SOL", quoteAsset: "USDT" },
        { symbol: "SINBASE", status: "TRADING", baseAsset: "", quoteAsset: "USDT" },
        "basura",
      ],
    };
    const idx = leerSimbolosEntorno(body);
    expect([...idx.keys()].sort()).toEqual(["BTCUSDT", "SOLUSDT"]);
  });

  test("sin array de symbols devuelve vacío", () => {
    expect(leerSimbolosEntorno({})).toEqual(new Map());
    expect(leerSimbolosEntorno(null)).toEqual(new Map());
  });
});

describe("normalizarMercado", () => {
  test("intersección con exchangeInfo: lo que no existe no se muestra", () => {
    const tickers = [
      { symbol: "BTCUSDT", price: 60000, changePct: 1, quoteVolume: 10, high: 61000, low: 59000 },
      { symbol: "FAKEUSDT", price: 1, changePct: 0, quoteVolume: 5, high: 1, low: 1 },
    ];
    const simbolos = new Map([["BTCUSDT", { base: "BTC", quote: "USDT" }]]);
    const rows = normalizarMercado(tickers, simbolos);
    expect(rows.map((r) => r.symbol)).toEqual(["BTCUSDT"]);
    expect(rows[0]?.base).toBe("BTC");
    expect(rows[0]?.quote).toBe("USDT");
    expect(rows[0]?.price).toBe(60000);
  });

  test("ignora precio inválido", () => {
    const tickers = [
      { symbol: "BTCUSDT", price: 0, changePct: 1, quoteVolume: 10, high: 61000, low: 59000 },
      { symbol: "BTCUSDT", price: -1, changePct: 1, quoteVolume: 10, high: 61000, low: 59000 },
    ];
    const simbolos = new Map([["BTCUSDT", { base: "BTC", quote: "USDT" }]]);
    expect(normalizarMercado(tickers, simbolos)).toEqual([]);
  });

  test("leerTickers convierte el lastPrice inválido en precio no usable", () => {
    const crudos = [
      {
        symbol: "BTCUSDT",
        lastPrice: "no-numero",
        priceChangePercent: "1",
        quoteVolume: "10",
        highPrice: "61000",
        lowPrice: "59000",
      },
    ];
    const simbolos = new Map([["BTCUSDT", { base: "BTC", quote: "USDT" }]]);
    expect(normalizarMercado(leerTickers(crudos), simbolos)).toEqual([]);
  });
});

describe("calcularVolatilidad", () => {
  test("(high-low)/price en tanto por uno", () => {
    expect(calcularVolatilidad(61000, 59000, 60000)).toBeCloseTo(2000 / 60000, 10);
  });

  test("precio no usable da 0", () => {
    expect(calcularVolatilidad(61000, 59000, 0)).toBe(0);
    expect(calcularVolatilidad(61000, 59000, NaN)).toBe(0);
  });
});

describe("decidirCambioPar", () => {
  test("bloquea con posición abierta aunque el bot esté parado", () => {
    const d = decidirCambioPar("BTCUSDT", "ETHUSDT", true);
    expect(d.valido).toBe(false);
    expect(d.motivo).toContain("BTCUSDT");
    expect(d.motivo).toContain("ETHUSDT");
  });

  test("mismo par normalizado (BTC/USDT === BTCUSDT) siempre válido", () => {
    expect(decidirCambioPar("BTCUSDT", "BTC/USDT", true)).toEqual({ valido: true, motivo: null });
    expect(decidirCambioPar("btc-usdt", "BTCUSDT", false)).toEqual({ valido: true, motivo: null });
  });

  test("par distinto sin posición abierta es válido", () => {
    expect(decidirCambioPar("BTCUSDT", "ETHUSDT", false)).toEqual({ valido: true, motivo: null });
  });
});
