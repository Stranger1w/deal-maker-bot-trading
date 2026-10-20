import { describe, expect, test } from "bun:test";

import { repartirPorHilos } from "./entrenamiento";
import { CAPACIDAD_ENJAMBRE, repartirHashRate, workersActivos } from "./modelo";

describe("reparto del hash rate real por hilos", () => {
  test("un equipo con 2 hilos se lleva el doble que uno con 1", () => {
    const partes = repartirPorHilos(1000, [1, 2]);
    expect(partes[0]).toBeCloseTo(333.33, 2);
    expect(partes[1]).toBeCloseTo(666.67, 2);
    // La suma es la capacidad REAL de la maquina: no se inventa hash rate.
    expect(partes[0]! + partes[1]!).toBeCloseTo(1000, 6);
  });

  test("todos con los mismos hilos: a partes iguales", () => {
    const partes = repartirPorHilos(900, [1, 1, 1]);
    expect(partes[0]).toBeCloseTo(300, 6);
    expect(partes[2]).toBeCloseTo(300, 6);
  });

  test("sin hilos o sin equipos, nada (no se divide por cero)", () => {
    expect(repartirPorHilos(1000, [])).toEqual([]);
    expect(repartirPorHilos(1000, [0, 0])).toEqual([0, 0]);
    expect(repartirHashRate(1000, 0)).toBe(0);
  });

  test("la capacidad total nunca supera la de la maquina", () => {
    const partes = repartirPorHilos(1_600_000, [4, 4, 4]);
    const total = partes.reduce((s, p) => s + p, 0);
    expect(total).toBeLessThanOrEqual(1_600_000);
  });
});

describe("capacidad y reparto por enjambre", () => {
  test("la capacidad del enjambre es 6", () => {
    expect(CAPACIDAD_ENJAMBRE).toBe(6);
  });

  test("solo cuentan los que estan minando", () => {
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
