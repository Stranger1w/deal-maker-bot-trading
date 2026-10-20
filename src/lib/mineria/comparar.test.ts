import { describe, expect, test } from "bun:test";

import { compararMonedas } from "./comparar";
import { aUnidadLegible, type HashRatePropio, type RedMoneda } from "./modelo";

const hash = (hashPorSegundo: number): HashRatePropio => ({
  hashPorSegundo,
  hashPorSegundoRed: aUnidadLegible(hashPorSegundo).valor,
  hashPorSegundoHashes: hashPorSegundo,
  unidad: aUnidadLegible(hashPorSegundo).unidad,
});

const RED_BTC: RedMoneda = {
  coin: "BTC",
  hashRateRed: 1e21,
  recompensaBloque: 3.125,
  tiempoBloqueSegundos: 600,
  precioUsd: 100000,
  fuente: "test",
};

describe("comparativa de monedas con tu equipo", () => {
  test("con una moneda sin datos de red no inventa cifras", () => {
    const redes = new Map([["KAS", null]]);
    const r = compararMonedas(["KAS"], redes, hash(3e6), 65, 0.15);
    expect(r.filas[0]?.brutoUsd).toBe(0);
    expect(r.filas[0]?.motivo).toContain("Sin datos de la red");
    expect(r.mejor).toBeNull();
    expect(r.veredicto).toContain("No hay datos de red");
  });

  test("con datos reales la ganancia no descuenta la luz", () => {
    const redes = new Map([["BTC", RED_BTC]]);
    const r = compararMonedas(["BTC"], redes, hash(3e6), 65, 0.15);
    // La ganancia es el bruto (la luz no se resta).
    expect(r.filas[0]?.gananciaUsd).toBeGreaterThan(0);
    expect(r.filas[0]?.gananciaUsd).toBe(r.filas[0]?.brutoUsd);
    // Pero la luz se sigue calculando y se sigue informando.
    expect(r.filas[0]?.luzUsd).toBeGreaterThan(0);
    expect(r.filas[0]?.netoUsd).toBeLessThan(0);
    expect(r.ningunaSaleACuenta).toBe(true);
    expect(r.veredicto).toContain("ganancia");
  });

  test("el mejor es el de mayor ganancia", () => {
    const redes = new Map([
      ["BTC", RED_BTC],
      ["KAS", { ...RED_BTC, coin: "KAS", hashRateRed: 1e18, precioUsd: 0.2 }],
    ]);
    const r = compararMonedas(["BTC", "KAS"], redes, hash(100e15), 3500, 0.15);
    expect(r.mejor).not.toBeNull();
    expect(r.mejor!.gananciaUsd).toBeGreaterThanOrEqual(
      r.filas.reduce((min, f) => Math.min(min, f.gananciaUsd), Infinity),
    );
  });
});
