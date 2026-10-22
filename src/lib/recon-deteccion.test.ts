import { describe, expect, test } from "bun:test";

import {
  detectarEnVelas,
  evaluarDeteccion,
  media,
  resumenAcierto,
  tasaBase,
  type Vela,
} from "./recon-deteccion";

/** Serie de velas sintetica a partir de una lista de cierres y volumenes. */
function serie(cierres: number[], volumenes?: number[]): Vela[] {
  return cierres.map((c, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: c,
    high: c * 1.002,
    low: c * 0.998,
    close: c,
    volume: volumenes?.[i] ?? 100,
  }));
}

/** Serie con la ultima vela al alza (cuerpo claro) para el pico de volumen. */
function serieConSubidaFinal(
  cierres: number[],
  volumenes: number[],
  cierreFinal: number,
  aperturaFinal: number,
): Vela[] {
  const velas = serie(cierres, volumenes);
  const ultima = velas[velas.length - 1]!;
  ultima.open = aperturaFinal;
  ultima.close = cierreFinal;
  ultima.high = Math.max(aperturaFinal, cierreFinal) * 1.002;
  ultima.low = Math.min(aperturaFinal, cierreFinal) * 0.998;
  return velas;
}

describe("detectarEnVelas", () => {
  test("no detecta nada con pocas velas", () => {
    expect(detectarEnVelas(serie([100, 101]), { lookback: 24 })).toEqual([]);
  });

  test("detecta un pico de volumen y dice hacia donde fue la vela", () => {
    const velas = serieConSubidaFinal(
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 900],
      101,
      100,
    );
    const d = detectarEnVelas(velas, { umbralVolumen: 1.6 }, "volume");
    const pico = d.find((x) => x.kind === "volume_spike");
    expect(pico).toBeTruthy();
    expect(pico!.direction).toBe("alcista");
    expect(pico!.referencePrice).toBe(101);
  });

  test("una vela plana con mucho volumen NO inventa direccion", () => {
    const velas = serie(
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      [100, 100, 100, 100, 100, 100, 100, 100, 100, 900],
    );
    const d = detectarEnVelas(velas, { umbralVolumen: 1.6 }, "volume");
    expect(d.find((x) => x.kind === "volume_spike")).toBeUndefined();
  });

  test("el enfoque decide que detectores se aplican", () => {
    const velas = serie([100, 101, 102, 103, 104, 105, 106, 107]);
    const soloVolumen = detectarEnVelas(velas, {}, "volume");
    expect(soloVolumen.every((d) => d.kind === "volume_spike")).toBe(true);
    const conPrecio = detectarEnVelas(velas, {}, "price");
    expect(conPrecio.some((d) => d.kind === "tendencia")).toBe(true);
  });

  test("detecta rotura por encima del maximo anterior", () => {
    const velas = serie([100, 100, 100, 100, 100, 120]);
    const d = detectarEnVelas(velas, { lookback: 5 }, "price");
    const rotura = d.find((x) => x.kind === "breakout_alcista");
    expect(rotura).toBeTruthy();
    expect(rotura!.direction).toBe("alcista");
    expect(rotura!.referencePrice).toBe(120);
  });

  test("detecta reversion a la media cuando el precio se sale de rango", () => {
    const velas = serie([100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 80]);
    const d = detectarEnVelas(velas, { lookback: 10 }, "indicators");
    const rev = d.find((x) => x.kind === "reversion_alcista");
    expect(rev).toBeTruthy();
    expect(rev!.direction).toBe("alcista");
  });
});

describe("evaluarDeteccion", () => {
  test("acierta si el precio sube mas del minimo en la direccion anunciada", () => {
    const velas = serie([100, 100, 101]);
    const ev = evaluarDeteccion({ direction: "alcista", referencePrice: 100 }, velas, 2, 0.2);
    expect(ev).not.toBeNull();
    expect(ev!.outcome).toBe("sube");
    expect(ev!.hit).toBe(true);
  });

  test("falla si el precio va al reves", () => {
    const velas = serie([100, 100, 99]);
    const ev = evaluarDeteccion({ direction: "alcista", referencePrice: 100 }, velas, 2, 0.2);
    expect(ev!.hit).toBe(false);
    expect(ev!.outcome).toBe("baja");
  });

  test("un movimiento pequeno es plano y NO cuenta como acierto", () => {
    const velas = serie([100, 100, 100.1]);
    const ev = evaluarDeteccion({ direction: "alcista", referencePrice: 100 }, velas, 2, 0.2);
    expect(ev!.outcome).toBe("plano");
    expect(ev!.hit).toBe(false);
  });

  test("sin velas suficientes no inventa un resultado", () => {
    expect(
      evaluarDeteccion({ direction: "alcista", referencePrice: 100 }, serie([100]), 3),
    ).toBeNull();
  });
});

describe("tasaBase", () => {
  test("una serie que solo sube da 100% y una plana da 0%", () => {
    const subiendo = serie([100, 101, 102, 103, 104, 105]);
    expect(tasaBase(subiendo, 1, 0.2)).toBe(100);
    const plana = serie([100, 100, 100, 100, 100, 100]);
    expect(tasaBase(plana, 1, 0.2)).toBe(0);
  });
});

describe("resumenAcierto", () => {
  test("compara con la tasa base y clasifica el veredicto", () => {
    const hallazgos = [
      { kind: "volume_spike", direction: "alcista" as const, hit: true, outcome: "sube" },
      { kind: "volume_spike", direction: "alcista" as const, hit: true, outcome: "sube" },
      { kind: "volume_spike", direction: "alcista" as const, hit: false, outcome: "baja" },
      { kind: "tendencia", direction: "alcista" as const, hit: false, outcome: "baja" },
      { kind: "tendencia", direction: "alcista" as const, hit: null, outcome: null },
    ];
    const resumen = resumenAcierto(hallazgos, 50);
    const vol = resumen.find((r) => r.kind === "volume_spike")!;
    expect(vol.evaluadas).toBe(3);
    expect(vol.aciertos).toBe(2);
    expect(vol.porcentajeAcierto).toBe(66.7);
    expect(vol.ventaja).toBe(16.7);
    expect(vol.veredicto).toBe("sin-datos");
    const tend = resumen.find((r) => r.kind === "tendencia")!;
    expect(tend.evaluadas).toBe(1);
    expect(tend.veredicto).toBe("sin-datos");
  });

  test("con cinco señales ya se puede decir si gana al azar", () => {
    const hallazgos = Array.from({ length: 6 }, (_, i) => ({
      kind: "tendencia",
      direction: "alcista" as const,
      hit: i < 5,
      outcome: i < 5 ? "sube" : "baja",
    }));
    const resumen = resumenAcierto(hallazgos, 50);
    expect(resumen[0]!.veredicto).toBe("gana-al-azar");
    expect(resumen[0]!.ventaja).toBe(33.3);
  });
});

describe("media", () => {
  test("de una lista vacia es 0", () => {
    expect(media([])).toBe(0);
    expect(media([1, 2, 3])).toBe(2);
  });
});
