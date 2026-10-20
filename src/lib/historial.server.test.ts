import { describe, expect, test } from "bun:test";

import { FUENTE_PRECIOS } from "./historial.server";

describe("historico real (sin datos de ejemplo)", () => {
  test("la fuente de los precios dice de donde salen", () => {
    expect(FUENTE_PRECIOS).toContain("Binance");
    // La fuente tiene que nombrar el origen: un "demo" colado seria una
    // mentira en la base.
    expect(FUENTE_PRECIOS.toLowerCase()).not.toContain("demo");
    expect(FUENTE_PRECIOS.toLowerCase()).not.toContain("seed");
  });
});
