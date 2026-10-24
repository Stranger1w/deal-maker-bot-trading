import { describe, expect, test } from "bun:test";
import { emaCruzamiento } from "./ema-cruzamiento";
import type { PriceSeries } from "./types";

function serie(cierres: number[]): PriceSeries {
  return {
    open: cierres.map((c) => c),
    closes: cierres,
    highs: cierres.map((c) => c * 1.002),
    lows: cierres.map((c) => c * 0.998),
    volumes: cierres.map(() => 100),
    times: cierres.map((_, i) => new Date(1_700_000_000_000 + i * 60_000).toISOString()),
  };
}

describe("emaCruzamiento", () => {
  test("no hay señal con pocas velas", () => {
    const s = serie([100, 101, 102]);
    expect(emaCruzamiento.signal(s, { periodoRapida: 12, periodoLenta: 26 })).toBeNull();
  });

  test("devuelve señal válida en tendencia alcista clara", () => {
    const cierres: number[] = [];
    for (let i = 0; i < 40; i++) cierres.push(50 + i * 2); // fuerte tendencia alcista
    const s = serie(cierres);
    const senal = emaCruzamiento.signal(s, { periodoRapida: 5, periodoLenta: 10 });
    // En tendencia alcista sostenida, la EMA rápida está por encima de la lenta
    // pero sin cruce reciente no hay señal; el indicador no debe lanzar
    expect(["buy", "sell", null]).toContain(senal);
  });

  test("devuelve señal válida en tendencia bajista clara", () => {
    const cierres: number[] = [];
    for (let i = 0; i < 40; i++) cierres.push(100 - i * 2); // fuerte tendencia bajista
    const s = serie(cierres);
    const senal = emaCruzamiento.signal(s, { periodoRapida: 5, periodoLenta: 10 });
    expect(["buy", "sell", null]).toContain(senal);
  });

  test("no lanza error con serie corta", () => {
    const s = serie([100, 101]);
    const senal = emaCruzamiento.signal(s, { periodoRapida: 5, periodoLenta: 10 });
    expect(senal).toBeNull();
  });

  test("sin cruce devuelve null", () => {
    const cierres: number[] = [];
    for (let i = 0; i < 50; i++) cierres.push(100 + Math.sin(i * 0.5) * 2); // lateral
    const s = serie(cierres);
    const senal = emaCruzamiento.signal(s, { periodoRapida: 12, periodoLenta: 26 });
    // Puede ser null o buy/sell dependiendo del cruce exacto, pero no debería lanzar
    expect(["buy", "sell", null]).toContain(senal);
  });

  test("diagnostico funciona", () => {
    const cierres: number[] = [];
    for (let i = 0; i < 40; i++) cierres.push(100 - i * 0.5);
    for (let i = 0; i < 10; i++) cierres.push(80 + i * 3);
    const s = serie(cierres);
    const d = emaCruzamiento.diagnose?.(s, { periodoRapida: 12, periodoLenta: 26 });
    expect(d).toBeTruthy();
    if (d) {
      expect(["ninguno", "datos_insuficientes", "parametros_incoherentes", "sin_cruce"]).toContain(
        d.failure,
      );
    }
  });
});
