import { describe, expect, test } from "bun:test";

import { esErrorDeSesion } from "./useGuardianDeSesion";

describe("deteccion de error de sesion", () => {
  test("reconoce los mensajes de sesion caducada", () => {
    expect(esErrorDeSesion(new Error("Unauthorized: No authorization header provided"))).toBe(true);
    expect(esErrorDeSesion(new Error("Invalid JWT"))).toBe(true);
    expect(esErrorDeSesion("401 Unauthorized")).toBe(true);
  });

  test("no se confunde con otros fallos", () => {
    expect(esErrorDeSesion(new Error("No se pudo descargar las velas"))).toBe(false);
    expect(esErrorDeSesion(new Error("Network error"))).toBe(false);
    expect(esErrorDeSesion(null)).toBe(false);
    expect(esErrorDeSesion(undefined)).toBe(false);
  });
});
