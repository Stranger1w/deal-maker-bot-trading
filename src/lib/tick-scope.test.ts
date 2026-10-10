import { describe, expect, test } from "bun:test";

import {
  SIN_DUENO,
  capitalPorDueno,
  claveDueno,
  concentracionPct,
  duenoDe,
  duenosQueSuperan,
  esDelAdmin,
  perdidaDelAdmin,
  sumarPerdida,
} from "./tick-scope";

const ADMIN = "admin-1";
const OTRO = "usuario-2";

describe("duenoDe", () => {
  test("lee user_id de una fila y devuelve null si falta o no es texto", () => {
    expect(duenoDe({ id: "1", user_id: "u1" })).toBe("u1");
    expect(duenoDe({ id: "1" })).toBe(null);
    expect(duenoDe({ user_id: null })).toBe(null);
    expect(duenoDe({ user_id: 5 })).toBe(null);
    expect(duenoDe(null)).toBe(null);
    expect(duenoDe(undefined)).toBe(null);
  });
});

describe("ambito del administrador", () => {
  test("sin dueno en la fila de ajustes todo cuenta como administrador", () => {
    expect(esDelAdmin(OTRO, null)).toBe(true);
    expect(esDelAdmin(OTRO, undefined)).toBe(true);
  });

  test("con dueno, solo el administrador y las filas heredadas sin dueno", () => {
    expect(esDelAdmin(ADMIN, ADMIN)).toBe(true);
    expect(esDelAdmin(SIN_DUENO, ADMIN)).toBe(true);
    expect(esDelAdmin(OTRO, ADMIN)).toBe(false);
  });

  test("claveDueno usa la clave reservada cuando no hay user_id", () => {
    expect(claveDueno(null)).toBe(SIN_DUENO);
    expect(claveDueno(undefined)).toBe(SIN_DUENO);
    expect(claveDueno(OTRO)).toBe(OTRO);
  });
});

describe("capital y concentracion por dueno", () => {
  const bots = [
    { pair: "BTCUSDT", capital: 500, user_id: ADMIN },
    { pair: "ETHUSDT", capital: "300", user_id: ADMIN },
    { pair: "BTCUSDT", capital: 5000, user_id: OTRO },
    { pair: "BTCUSDT", capital: 100, user_id: null },
  ];

  test("el capital de otro usuario no suma al del administrador", () => {
    const mapa = capitalPorDueno(bots);
    expect(mapa.get(ADMIN)?.squad).toBe(800);
    expect(mapa.get(OTRO)?.squad).toBe(5000);
    expect(mapa.get(SIN_DUENO)?.squad).toBe(100);
  });

  test("la concentracion se calcula solo con los bots del propio dueno", () => {
    const mapa = capitalPorDueno(bots);
    expect(concentracionPct(mapa.get(ADMIN), "BTCUSDT")).toBe(62.5);
    expect(concentracionPct(mapa.get(OTRO), "BTCUSDT")).toBe(100);
    expect(concentracionPct(mapa.get(ADMIN), "SOLUSDT")).toBe(0);
  });

  test("sin capital o sin dueno conocido la concentracion es 0", () => {
    expect(concentracionPct(undefined, "BTCUSDT")).toBe(0);
    expect(concentracionPct({ squad: 0, pares: {} }, "BTCUSDT")).toBe(0);
  });
});

describe("perdidas por dueno", () => {
  test("acumula por dueno e ignora valores no positivos", () => {
    const mapa = new Map<string, number>();
    sumarPerdida(mapa, ADMIN, 10);
    sumarPerdida(mapa, ADMIN, 5);
    sumarPerdida(mapa, OTRO, 40);
    sumarPerdida(mapa, OTRO, 0);
    sumarPerdida(mapa, OTRO, -3);
    expect(mapa.get(ADMIN)).toBe(15);
    expect(mapa.get(OTRO)).toBe(40);
  });

  test("la perdida de otro usuario no cuenta contra el limite global del administrador", () => {
    const mapa = new Map<string, number>();
    sumarPerdida(mapa, ADMIN, 15);
    sumarPerdida(mapa, OTRO, 400);
    sumarPerdida(mapa, null, 5);
    expect(perdidaDelAdmin(mapa, ADMIN)).toBe(20);
  });

  test("sin dueno en los ajustes, se suma todo (comportamiento anterior)", () => {
    const mapa = new Map<string, number>();
    sumarPerdida(mapa, ADMIN, 15);
    sumarPerdida(mapa, OTRO, 400);
    expect(perdidaDelAdmin(mapa, null)).toBe(415);
  });

  test("duenosQueSuperan nunca incluye al administrador ni a las filas sin dueno", () => {
    const mapa = new Map<string, number>();
    sumarPerdida(mapa, ADMIN, 1000);
    sumarPerdida(mapa, null, 1000);
    sumarPerdida(mapa, OTRO, 100);
    sumarPerdida(mapa, "usuario-3", 99);
    expect(duenosQueSuperan(mapa, 100, ADMIN)).toEqual([OTRO]);
    expect(duenosQueSuperan(mapa, 50, ADMIN)).toEqual([OTRO, "usuario-3"]);
  });

  test("si los ajustes no tienen dueno, no hay duenos 'otros' que frenar por separado", () => {
    const mapa = new Map<string, number>();
    sumarPerdida(mapa, OTRO, 1000);
    expect(duenosQueSuperan(mapa, 100, null)).toEqual([]);
  });
});
