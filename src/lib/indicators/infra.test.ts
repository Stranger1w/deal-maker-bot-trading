import { describe, expect, test } from "bun:test";

import { TEXTOS } from "../textos";

// FASE 0: la infraestructura de tests debe funcionar antes de escribir
// los indicadores de la Fase 1. Este archivo no prueba logica de negocio,
// prueba que `bun test src` esta cableado y lee TypeScript.
describe("infraestructura de tests", () => {
  test("bun test ejecuta TypeScript en src", () => {
    expect(typeof TEXTOS.motor.titulo).toBe("string");
  });

  test("la ortografia de la frase de aceptacion es ACEPTO", () => {
    expect(TEXTOS.estrategiaUI.candadoDesbloquear).toContain("ACEPTO");
  });

  test("no hay textos vacios en la central", () => {
    const vacios: string[] = [];
    const recorrer = (obj: unknown, ruta: string) => {
      if (typeof obj === "string") {
        if (obj.trim() === "") vacios.push(ruta);
        return;
      }
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) recorrer(v, `${ruta}.${k}`);
      }
    };
    recorrer(TEXTOS, "TEXTOS");
    expect(vacios).toEqual([]);
  });
});
