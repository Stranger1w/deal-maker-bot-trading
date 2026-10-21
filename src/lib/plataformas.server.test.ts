import { describe, expect, test } from "bun:test";

import { MS_POR_INTERVALO, PLATAFORMAS } from "./plataformas.server";
import { aHashesPorSegundo, aUnidadLegible, balanceDiario } from "./mineria/modelo";

describe("plataformas de datos", () => {
  test("hay varias plataformas y solo Binance publica datos de traders", () => {
    expect(PLATAFORMAS.length).toBeGreaterThanOrEqual(5);
    const conTraders = PLATAFORMAS.filter((p) => p.tieneTraders);
    expect(conTraders.length).toBe(1);
    expect(conTraders[0]?.id).toBe("binance-futuros");
  });

  test("cada plataforma dice de que mercado saca los datos", () => {
    for (const p of PLATAFORMAS) {
      expect(p.mercado === "spot" || p.mercado === "futuros").toBe(true);
      expect(p.nombre.length).toBeGreaterThan(2);
    }
  });

  test("los intervalos tienen su duracion en milisegundos", () => {
    expect(MS_POR_INTERVALO["1h"]).toBe(3_600_000);
    expect(MS_POR_INTERVALO["1d"]).toBe(86_400_000);
    expect(MS_POR_INTERVALO["15m"]).toBe(900_000);
  });
});

describe("mineria: unidades y balance (regresion)", () => {
  test("las conversiones de hash rate son coherentes", () => {
    expect(aHashesPorSegundo(1, "MH/s")).toBe(1e6);
    expect(aUnidadLegible(2.5e6).unidad).toBe("MH/s");
  });

  test("el balance dice que en un PC de casa no sale a cuenta", () => {
    const b = balanceDiario(
      {
        hashPorSegundo: 3e6,
        hashPorSegundoRed: 3,
        hashPorSegundoHashes: 3e6,
        unidad: "MH/s",
      },
      {
        coin: "BTC",
        hashRateRed: 1e21,
        recompensaBloque: 3.125,
        tiempoBloqueSegundos: 600,
        precioUsd: 80000,
        fuente: "test",
      },
      65,
      0.15,
    );
    // La luz se informa pero no se resta (decision del dueno).
    expect(b.netoUsd).toBe(b.gananciaUsd);
    expect(b.laLuzSeLoCome).toBe(true);
  });
});
