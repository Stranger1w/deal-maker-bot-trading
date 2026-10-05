import { describe, expect, test } from "bun:test";
import { MINIMO_MUESTRAS, mejorIndicador, puntuar, type OperacionHistorica } from "./ai-indicator";
import {
  INDICADORES,
  INDICADOR_POR_DEFECTO,
  buscarIndicador,
  combineSignals,
  senalDe,
  tiposDe,
} from "./index";
import { TEXTOS } from "../textos";

/** Genera n operaciones del mismo contexto con el resultado pedido. */
function ops(
  n: number,
  ctx: Partial<OperacionHistorica> = {},
  pnl: (i: number) => number = (i) => (i % 2 === 0 ? 1 : -0.5),
): OperacionHistorica[] {
  const base: OperacionHistorica = {
    symbol: "BTCUSDT",
    hora: "14:00",
    horizonteMin: 15,
    indicadorId: "rsi",
    side: "buy",
    pnl: 0,
  };
  return Array.from({ length: n }, (_, i) => ({ ...base, ...ctx, pnl: pnl(i) }));
}

const CTX = { symbol: "BTCUSDT", hora: "14:00", horizonteMin: 15 };

describe("ai-indicator · minimo de muestras", () => {
  test("con menos de 30 muestras devuelve null", () => {
    for (const n of [0, 1, 15, 29]) {
      expect(puntuar(ops(n), { ...CTX, indicadorId: "rsi" })).toBeNull();
    }
  });

  test("con exactamente 30 muestras ya puntua", () => {
    expect(MINIMO_MUESTRAS).toBe(30);
    expect(puntuar(ops(30), { ...CTX, indicadorId: "rsi" })).not.toBeNull();
  });

  test("PnL medio negativo -> puntuacion 0 (el AI descarta ese contexto)", () => {
    expect(
      puntuar(
        ops(40, {}, () => -0.2),
        { ...CTX, indicadorId: "rsi" },
      ),
    ).toBe(0);
  });

  test("PnL medio positivo -> puntuacion en (0, 1]", () => {
    const p = puntuar(
      ops(40, {}, (i) => (i % 3 === 0 ? -0.2 : 0.9)),
      {
        ...CTX,
        indicadorId: "rsi",
      },
    );
    expect(p).not.toBeNull();
    expect(p ?? 0).toBeGreaterThan(0);
    expect(p ?? 2).toBeLessThanOrEqual(1);
  });

  test("el contexto se filtra por par, hora, horizonte E indicador", () => {
    const todas = [
      ...ops(40, { symbol: "BTCUSDT" }),
      ...ops(40, { symbol: "ETHUSDT" }),
      ...ops(40, { hora: "03:00" }),
      ...ops(40, { horizonteMin: 1 }),
      ...ops(40, { indicadorId: "macd" }),
    ];
    expect(puntuar(todas, { ...CTX, indicadorId: "rsi" })).not.toBeNull();
    expect(puntuar(todas, { ...CTX, indicadorId: "bollinger" })).toBeNull();
  });

  test("mejorIndicador elige el de mayor puntuacion y descarta los negativos", () => {
    const todas = [
      ...ops(40, { indicadorId: "rsi" }, (i) => (i % 2 === 0 ? 1 : -0.5)),
      ...ops(40, { indicadorId: "macd" }, () => -1),
      ...ops(10, { indicadorId: "cci" }, (i) => (i % 2 === 0 ? 1 : -0.5)),
    ];
    expect(mejorIndicador(todas, CTX)?.id).toBe("rsi");
  });

  test("mejorIndicador devuelve null si ninguno tiene 30 muestras", () => {
    expect(mejorIndicador(ops(20, { indicadorId: "rsi" }), CTX)).toBeNull();
  });
});

describe("combinacion de senales", () => {
  test("todos buy -> buy", () => {
    expect(combineSignals(["buy", "buy", "buy"])).toBe("buy");
  });

  test("todos sell -> sell", () => {
    expect(combineSignals(["sell", "sell"])).toBe("sell");
  });

  test("uno discrepa -> sin senal", () => {
    expect(combineSignals(["buy", "sell"])).toBeNull();
  });

  test("alguno sin senal -> sin senal", () => {
    expect(combineSignals(["buy", null])).toBeNull();
    expect(combineSignals([null, "sell"])).toBeNull();
  });

  test("lista vacia -> sin senal", () => {
    expect(combineSignals([])).toBeNull();
  });

  test("senalDe con seleccion vacia no inventa nada", () => {
    const serie = { open: [1], closes: [1, 2, 3], highs: [2, 3, 4], lows: [0, 1, 2] };
    expect(senalDe([], serie)).toBeNull();
  });
});

describe("tipos y aviso del modal", () => {
  /** Descarta null para poder pasar la seleccion a tiposDe. */
  function selec(...ids: string[]) {
    return ids.map(buscarIndicador).filter((i): i is NonNullable<typeof i> => i !== null);
  }

  test("detecta la mezcla de tipos", () => {
    expect(tiposDe(selec("macd", "rsi"))).toEqual({ tendencia: true, reversion: true });
  });

  test("solo tendencia o solo reversion", () => {
    expect(tiposDe(selec("macd"))).toEqual({ tendencia: true, reversion: false });
    expect(tiposDe(selec("rsi"))).toEqual({ tendencia: false, reversion: true });
  });

  test("el AI Indicator NO dispara el aviso: es tipo filtro", () => {
    // Solo AI -> no hay mezcla.
    expect(tiposDe(selec("ai_indicator"))).toEqual({ tendencia: false, reversion: false });
    // MACD + AI -> sigue siendo solo tendencia.
    expect(tiposDe(selec("macd", "ai_indicator"))).toEqual({ tendencia: true, reversion: false });
    // AI + RSI -> sigue siendo solo reversion.
    expect(tiposDe(selec("ai_indicator", "rsi"))).toEqual({
      tendencia: false,
      reversion: true,
    });
    // MACD + RSI + AI -> aqui si hay mezcla real.
    expect(tiposDe(selec("macd", "rsi", "ai_indicator"))).toEqual({
      tendencia: true,
      reversion: true,
    });
  });

  test("existen los cuatro textos del aviso de mezcla", () => {
    const m = TEXTOS.mezclaTipos;
    expect(m.titulo.length).toBeGreaterThan(10);
    expect(m.detalle.length).toBeGreaterThan(50);
    expect(m.soloTendencia.length).toBeGreaterThan(20);
    expect(m.soloReversion.length).toBeGreaterThan(20);
    expect(m.aiNoCuadra.length).toBeGreaterThan(20);
  });
});

describe("registro de indicadores", () => {
  test("estan los 7 y el primero es el AI Indicator", () => {
    expect(INDICADORES.length).toBe(7);
    expect(INDICADORES[0]?.id).toBe("ai_indicator");
    expect(INDICADORES[INDICADORES.length - 1]?.id).toBe(INDICADOR_POR_DEFECTO);
  });

  test("cada indicador declara su tipo", () => {
    for (const ind of INDICADORES) {
      expect(ind.tipo === "tendencia" || ind.tipo === "reversion" || ind.tipo === "filtro").toBe(
        true,
      );
    }
    const tendencia = INDICADORES.filter((i) => i.tipo === "tendencia").map((i) => i.id);
    const reversion = INDICADORES.filter((i) => i.tipo === "reversion").map((i) => i.id);
    const filtro = INDICADORES.filter((i) => i.tipo === "filtro").map((i) => i.id);
    // TENDENCIA: MACD y Precio de cierre.
    expect(tendencia.sort()).toEqual(["close_price", "macd"]);
    // REVERSION: RSI, Estocastico, Bollinger y CCI.
    expect(reversion.sort()).toEqual(["bollinger", "cci", "rsi", "stochastic"]);
    // FILTRO: el AI Indicator, que no genera senal propia.
    expect(filtro).toEqual(["ai_indicator"]);
  });

  test("todo indicador tiene descripcion corta, detalles y parametros", () => {
    for (const ind of INDICADORES) {
      expect(ind.descripcionCorta.length).toBeGreaterThan(20);
      expect(ind.detalles.queMide.length).toBeGreaterThan(10);
      expect(ind.detalles.cuandoFalla.length).toBeGreaterThan(10);
      expect(Array.isArray(ind.parametros)).toBe(true);
    }
  });

  test("buscarIndicador devuelve null para un id desconocido", () => {
    expect(buscarIndicador("no_existe")).toBeNull();
  });
});
