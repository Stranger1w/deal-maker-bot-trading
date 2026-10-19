import { describe, expect, test } from "bun:test";

import { intervaloDesdeMinutos } from "./senal-motor.server";

describe("intervaloDesdeMinutos", () => {
  test("el horizonte de la configuracion se traduce a intervalo de velas", () => {
    expect(intervaloDesdeMinutos(1)).toBe("1m");
    expect(intervaloDesdeMinutos(5)).toBe("5m");
    expect(intervaloDesdeMinutos(15)).toBe("15m");
  });

  test("un horizonte mayor cae en 15m (el maximo del motor)", () => {
    expect(intervaloDesdeMinutos(60)).toBe("15m");
    expect(intervaloDesdeMinutos(0)).toBe("1m");
  });
});
