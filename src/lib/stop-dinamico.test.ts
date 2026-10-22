import { describe, expect, test } from "bun:test";

import { stopYTakeDinamicos } from "./stop-dinamico";

describe("stopYTakeDinamicos", () => {
  test("sin ATR devuelve los valores fijos (el comportamiento de siempre)", () => {
    const r = stopYTakeDinamicos({
      stopFijoPct: 1.5,
      takeFijoPct: 3,
      atrPct: null,
      stopPorAtr: 1.5,
    });
    expect(r.stopPct).toBe(1.5);
    expect(r.takePct).toBe(3);
    expect(r.modo).toBe("fijo");
  });

  test("con el ATR apagado tambien son los fijos", () => {
    const r = stopYTakeDinamicos({
      stopFijoPct: 1.5,
      takeFijoPct: 3,
      atrPct: 2,
      stopPorAtr: 0,
    });
    expect(r.stopPct).toBe(1.5);
    expect(r.takePct).toBe(3);
    expect(r.modo).toBe("fijo");
  });

  test("el ATR solo puede ALEJAR el stop, nunca acercarlo", () => {
    // ATR pequeno (0,5 %) con multiplicador 1,5 -> 0,75 %: menos que el fijo.
    const pequeno = stopYTakeDinamicos({
      stopFijoPct: 1.5,
      takeFijoPct: 3,
      atrPct: 0.5,
      stopPorAtr: 1.5,
    });
    expect(pequeno.stopPct).toBe(1.5);
    expect(pequeno.modo).toBe("atr");

    // ATR grande (3 %) con multiplicador 1,5 -> 4,5 %: manda el ATR.
    const grande = stopYTakeDinamicos({
      stopFijoPct: 1.5,
      takeFijoPct: 3,
      atrPct: 3,
      stopPorAtr: 1.5,
    });
    expect(grande.stopPct).toBe(4.5);
  });

  test("el take tambien escala con el ATR si se le da multiplicador", () => {
    const r = stopYTakeDinamicos({
      stopFijoPct: 1.5,
      takeFijoPct: 3,
      atrPct: 2,
      stopPorAtr: 1.5,
      takePorAtr: 3,
    });
    expect(r.stopPct).toBe(3);
    expect(r.takePct).toBe(6);
  });

  test("sin multiplicador de take, el take deduce el ratio del bot", () => {
    // Stop 1,5 % y take 3 % (ratio 1:2). Con ATR 3 % y multiplicador 1,5 el
    // stop se va a 4,5 % y el take a 9 %: la relacion se mantiene.
    const r = stopYTakeDinamicos({
      stopFijoPct: 1.5,
      takeFijoPct: 3,
      atrPct: 3,
      stopPorAtr: 1.5,
    });
    expect(r.stopPct).toBe(4.5);
    expect(r.takePct).toBe(9);
  });

  test("un ATR invalido no rompe nada", () => {
    for (const atr of [null, 0, -1, Number.NaN]) {
      const r = stopYTakeDinamicos({
        stopFijoPct: 2,
        takeFijoPct: 4,
        atrPct: atr as number | null,
        stopPorAtr: 1.5,
      });
      expect(r.stopPct).toBe(2);
      expect(r.takePct).toBe(4);
    }
  });
});
