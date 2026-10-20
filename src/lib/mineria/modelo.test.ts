import { describe, expect, test } from "bun:test";

import {
  aHashesPorSegundo,
  aUnidadLegible,
  balanceDiario,
  costeLuzDiario,
  gananciaBrutaDiaria,
  hashRateRedDesdeDificultad,
  recompensaDiariaRed,
  repartirHashRate,
  workersActivos,
  type HashRatePropio,
  type RedMoneda,
} from "./modelo";

const hashDe = (hashPorSegundo: number): HashRatePropio => {
  const legible = aUnidadLegible(hashPorSegundo);
  return {
    hashPorSegundo,
    unidad: legible.unidad,
    hashPorSegundoRed: legible.valor,
    hashPorSegundoHashes: hashPorSegundo,
  };
};

// Red de ejemplo: 600 EH/s (como BTC en 2026), recompensa 3,125 BTC, 10 min
// por bloque y 100.000 USD por BTC.
const RED: RedMoneda = {
  coin: "BTC",
  hashRateRed: 600e9 * 1e6, // 600 EH/s en hashes por segundo
  recompensaBloque: 3.125,
  tiempoBloqueSegundos: 600,
  precioUsd: 100000,
  fuente: "ejemplo",
};

describe("unidades de hash rate", () => {
  test("convierte a hashes por segundo", () => {
    expect(aHashesPorSegundo(1, "MH/s")).toBe(1e6);
    expect(aHashesPorSegundo(1, "TH/s")).toBe(1e12);
    expect(aHashesPorSegundo(1, "H/s")).toBe(1);
  });

  test("elige la unidad legible", () => {
    expect(aUnidadLegible(1.5e12).unidad).toBe("TH/s");
    expect(aUnidadLegible(2.5e6).unidad).toBe("MH/s");
    expect(aUnidadLegible(900).unidad).toBe("H/s");
    expect(aUnidadLegible(1e15).valor).toBe(1);
  });
});

describe("hash rate de la red desde la dificultad", () => {
  test("usa difficulty * 2^32 / tiempo de bloque", () => {
    // Dificultad 1e14 y 600 s de bloque -> unos 715 EH/s (orden de magnitud
    // de la red de BTC en 2026).
    const h = hashRateRedDesdeDificultad(1e14, 600);
    // Comparacion relativa: a estos valores el salto absoluto no sirve.
    expect(h / 7.158278826666666e20).toBeCloseTo(1, 6);
    expect(h).toBeGreaterThan(1e20);
    expect(h).toBeLessThan(1e21);
  });

  test("con datos invalidos devuelve 0", () => {
    expect(hashRateRedDesdeDificultad(0, 600)).toBe(0);
    expect(hashRateRedDesdeDificultad(1e14, 0)).toBe(0);
  });
});

describe("recompensa y ganancia", () => {
  test("la red reparte bloques por dia", () => {
    // 86400 s / 600 s = 144 bloques al dia * 3,125 BTC.
    expect(recompensaDiariaRed(RED)).toBeCloseTo(450, 5);
  });

  test("la ganancia bruta es la cuota de la red por la recompensa", () => {
    // 1 MH/s sobre 600 EH/s = 1,66e-15 de la red.
    const g = gananciaBrutaDiaria(hashDe(1e6), RED);
    expect(g.cuotaRed).toBeCloseTo(1e6 / 600e15, 12);
    expect(g.monedas).toBeCloseTo(450 * (1e6 / 600e15), 12);
    expect(g.usd).toBeCloseTo(450 * (1e6 / 600e15) * 100000, 9);
  });

  test("sin datos de red la ganancia es cero (no se inventa)", () => {
    const sinRed: RedMoneda = { ...RED, hashRateRed: 0 };
    expect(gananciaBrutaDiaria(hashDe(1e6), sinRed).usd).toBe(0);
  });
});

describe("coste de la luz", () => {
  test("watts x 24 h / 1000 x precio kWh", () => {
    expect(costeLuzDiario(100, 0.15)).toBeCloseTo(0.36, 6);
    expect(costeLuzDiario(0, 0.15)).toBe(0);
    expect(costeLuzDiario(100, 0)).toBe(0);
  });
});

describe("balance diario (la verdad del caso)", () => {
  test("un PC de casa da una cifra ridicula y la luz se lo come: no sale a cuenta", () => {
    const balance = balanceDiario(hashDe(3e6), RED, 65, 0.15);
    // 3 MH/s sobre 600 EH/s: una fraccion diminuta de la red.
    expect(balance.brutoUsd).toBeGreaterThan(0);
    expect(balance.brutoUsd).toBeLessThan(0.001);
    expect(balance.luzUsd).toBeCloseTo(0.234, 6);
    expect(balance.netoUsd).toBeLessThan(0);
    expect(balance.noSaleACuenta).toBe(true);
    expect(balance.veredicto).toContain("NO sale a cuenta");
  });

  test("sin datos de red lo dice en vez de inventar", () => {
    const balance = balanceDiario(hashDe(3e6), null, 65, 0.15);
    expect(balance.brutoUsd).toBe(0);
    expect(balance.veredicto).toContain("Sin datos de la red");
  });

  test("un ASIC gigante si sale a cuenta (comprobacion del signo)", () => {
    // 100 PH/s sobre 600 EH/s -> 1/6000 de la red -> 0,075 BTC al dia.
    const balance = balanceDiario(hashDe(100e15), RED, 3500, 0.15);
    expect(balance.brutoUsd).toBeGreaterThan(balance.luzUsd);
    expect(balance.noSaleACuenta).toBe(false);
    expect(balance.veredicto).toContain("sobran");
  });
});

describe("reparto del hash rate entre workers", () => {
  test("tres workers en el mismo CPU se reparten el hash rate", () => {
    expect(repartirHashRate(3e6, 3)).toBeCloseTo(1e6, 6);
    expect(repartirHashRate(3e6, 1)).toBeCloseTo(3e6, 6);
    expect(repartirHashRate(3e6, 0)).toBe(0);
  });

  test("cuenta solo los que estan minando", () => {
    expect(
      workersActivos([
        { status: "mining" },
        { status: "mining" },
        { status: "idle" },
        { status: "offline" },
      ]),
    ).toBe(2);
  });
});
