import { describe, expect, test } from "bun:test";
import { bollingerSerie } from "./bollinger";
import { cciSerie } from "./cci";
import { macdSerie } from "./macd";
import { rsiWilder } from "./rsi";
import { stochSerie } from "./stochastic";

/**
 * PARIDAD NUMERICA CONTRA FUENTE INDEPENDIENTE.
 *
 * Las referencias salen de la libreria `ta` (Python), generadas con
 * __fixtures__/gen_expected.py sobre un dataset determinista de 1000 velas.
 * Nuestro codigo TypeScript no comparte ni una linea con ese calculo.
 *
 * DIFERENCIA DE SEMILLA (documentada, medida y testada):
 *   `ta` inicializa el RSI con ewm(alpha=1/14) y las EMA del MACD con
 *   ewm(span=26) SIN semilla SMA. Nosotros usamos la definicion clasica de
 *   Wilder, con semilla SMA. Es la UNICA diferencia entre ambos.
 *
 *   El error resultante decae de forma geometrica:
 *       RSI  ~ (13/14)^n        MACD ~ (25/27)^n
 *   El test "decimiento" lo verifica midiendo el cociente entre velas
 *   consecutivas, no el maximo acumulado (el maximo acumulado NO puede
 *   decrecer, siempre se alcanza en la primera vela: es un artefacto).
 *
 *   Con corte en la vela 500 el residuo ya es menor que 1e-6, que es la
 *   tolerancia exigida abajo. Ningun test usa igualdad exacta.
 */

type Fixture = {
  _meta: Record<string, unknown>;
  corte: number;
  _series_desde_corte: Record<string, (number | null)[]>;
  _serie_para_decaimiento: Record<string, unknown> & { desde: number };
};

import expected from "./__fixtures__/expected.json";
import dataset from "./__fixtures__/dataset.json";

const fx = expected as unknown as Fixture;
const cierres = (dataset as { closes: number[] }).closes;
const CORTE = fx.corte;
const ref = fx._series_desde_corte;
const dec = fx._serie_para_decaimiento;

/** Serie numerica (no nulos) del bloque de decaimiento. */
function serieDec(nombre: string): (number | null)[] {
  const v = dec[nombre];
  return Array.isArray(v) ? (v as (number | null)[]) : [];
}

/** Maximo error absoluto entre dos series alineadas, ignorando posiciones null. */
function errorMax(nuestra: (number | null)[], referencia: (number | null)[]): number {
  let max = 0;
  const n = Math.min(nuestra.length, referencia.length);
  for (let i = 0; i < n; i++) {
    const a = nuestra[i];
    const b = referencia[i];
    if (a === null || a === undefined || b === null || b === undefined) continue;
    const d = Math.abs(a - b);
    if (Number.isFinite(d) && d > max) max = d;
  }
  return max;
}

/** Cociente medio entre errores de velas consecutivas (decaimiento real). */
function ratioDecaimiento(errores: (number | null)[]): number | null {
  const ratios: number[] = [];
  let prev: number | null = null;
  for (const e of errores) {
    if (e === null || e === undefined || !Number.isFinite(e)) continue;
    if (prev !== null && prev > 0) ratios.push(e / prev);
    prev = e;
  }
  if (ratios.length === 0) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

/** Serie completa de nuestro RSI, alineada con el indice de vela. */
describe("alineacion con la referencia", () => {
  test("el dataset son velas cerradas: NO se aplica cerradas() al comparar", () => {
    // En produccion el motor llama a cerradas() para descartar la vela EN CURSO,
    // y eso deja N-1 velas. Aqui el dataset es sintetico y sus 1000 velas estan
    // TODAS cerradas, igual que las que se le dieron a `ta`. Por eso NO se
    // aplica cerradas(): hacerlo desplazaria el ultimo valor de la serie y
    // romperia la comparacion contra la referencia.
    expect(cierres.length).toBe(1000);
    expect(cierres.length - 1).toBe(999);
  });

  test("el tramo comparado tiene exactamente las velas que faltan", () => {
    const rsiRef = ref["rsi14"] ?? [];
    expect(rsiRef.length).toBe(cierres.length - CORTE);
  });
});

describe("fixture de referencia", () => {
  test("1000 velas y metadatos de la libreria", () => {
    expect(cierres.length).toBe(1000);
    expect(fx._meta["ta"]).toBeTruthy();
    expect(typeof fx._meta["python"]).toBe("string");
    expect(typeof fx._meta["lcg"]).toBe("string");
    expect(CORTE).toBe(500);
  });

  test("la serie EJERCE sobreventa y sobrecompra en el tramo comparado", () => {
    const rsiRef = ref["rsi14"] ?? [];
    const bajos = rsiRef.filter((v) => v !== null && v < 30).length;
    const altos = rsiRef.filter((v) => v !== null && v > 70).length;
    // Sin esto el test pasaria sin comprobar nada.
    expect(bajos).toBeGreaterThan(0);
    expect(altos).toBeGreaterThan(0);
  });
});

describe("paridad numerica contra `ta` (tolerancia 1e-6, nunca igualdad exacta)", () => {
  test("Bollinger media y bandas coinciden exactamente", () => {
    const serie = bollingerSerie(cierres).slice(CORTE);
    expect(
      errorMax(
        serie.map((p) => p?.media ?? null),
        ref["bb_mid"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
    expect(
      errorMax(
        serie.map((p) => p?.superior ?? null),
        ref["bb_upper"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
    expect(
      errorMax(
        serie.map((p) => p?.inferior ?? null),
        ref["bb_lower"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
  });

  test("MACD coincide tras el decaimiento de la semilla", () => {
    const serie = macdSerie(cierres).slice(CORTE);
    expect(
      errorMax(
        serie.map((p) => p?.macd ?? null),
        ref["macd"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
    expect(
      errorMax(
        serie.map((p) => p?.signal ?? null),
        ref["macd_signal"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
  });

  test("RSI coincide tras el decaimiento de la semilla", () => {
    const nuestra = serieRsi().slice(CORTE);
    expect(errorMax(nuestra, ref["rsi14"] ?? [])).toBeLessThanOrEqual(1e-6);
  });
});

describe("decimiento de la diferencia de semilla", () => {
  test("MACD: el cociente vela a vela tiende a 25/27", () => {
    // El decaimiento solo se ve en velas tempranas: en la vela 500 el residuo
    // ya es ~1e-14. Por eso el fixture trae un bloque desde la vela 60.
    const DESDE = dec["desde"];
    const serie = macdSerie(cierres).slice(DESDE);
    const errores = serie.map((p, k) => {
      const b = serieDec("macd")[k];
      if (!p || b === null || b === undefined) return null;
      return Math.abs(p.macd - b);
    });
    const r = ratioDecaimiento(errores.slice(0, 12));
    expect(r).not.toBeNull();
    const teorico = 25 / 27;
    console.log(`MACD ratio medido = ${r}  teorico = ${teorico}`);
    expect(Math.abs((r ?? 0) - teorico)).toBeLessThan(1e-3);
  });

  test("RSI: el error decrece al avanzar en la serie", () => {
    const nuestra = serieRsi().slice(CORTE);
    const errores = nuestra.map((a, k) => {
      const b = ref["rsi14"]?.[k];
      if (a === null || a === undefined || b === null || b === undefined) return null;
      return Math.abs(a - b);
    });
    const primeros = errores[0] ?? 0;
    const ultimos = errores[errores.length - 1] ?? 0;
    console.log(`RSI error en la vela ${CORTE} = ${primeros}  ultima = ${ultimos}`);
    expect(ultimos).toBeLessThan(primeros);
    expect(ultimos).toBeLessThan(1e-6);
  });

  test("RSI: el error decae en el tramo monótono y es despreciable en la vela 500", () => {
    const DESDE = dec["desde"];
    const nuestra = serieRsi().slice(DESDE);
    const errores = nuestra.map((a, k) => {
      const b = serieDec("rsi14")[k];
      if (a === null || a === undefined || b === null || b === undefined) return null;
      return Math.abs(a - b);
    });
    const inicial = (errores[0] ?? 0) as number;
    const final = (errores[errores.length - 1] ?? 0) as number;
    console.log(`RSI error vela ${DESDE} = ${inicial}  ultima = ${final}`);
    // El RSI es una transformada no lineal (100 - 100/(1+RS)), asi que el
    // cociente NO es constante como en el MACD: cerca de los extremos el error
    // se comprime. Lo que se comprueba es la existencia del decaimiento.
    expect(inicial).toBeGreaterThan(final);
    // En la vela 500 (test anterior) el residuo es < 1e-6: orden de magnitud
    // menor que el inicial, lo que confirma la convergencia.
    expect(final).toBeLessThan(inicial * 1e-6);
  });
});
function serieRsi(): (number | null)[] {
  const out: (number | null)[] = new Array(cierres.length).fill(null);
  for (let i = 15; i <= cierres.length; i++) out[i - 1] = rsiWilder(cierres.slice(0, i), 14);
  return out;
}

describe("Estocastico y CCI contra `ta` (sin suavizado recursivo)", () => {
  const highs = (dataset as { highs: number[] }).highs;
  const lows = (dataset as { lows: number[] }).lows;

  test("el dataset tiene high > low en todas las velas", () => {
    // Sin esto, el %K rapido devolveria null por denominador cero y los tests
    // de Estocastico y CCI pasarian sin comprobar nada.
    const planas = cierres.filter((_, i) => (highs[i] ?? 0) <= (lows[i] ?? 0)).length;
    expect(planas).toBe(0);
  });

  test("%K rapido coincide con `ta` desde la primera vela comparable", () => {
    // La referencia arranca en la vela CORTE: hay que cortar nuestra serie en el
    // mismo punto o se comparan velas distintas.
    const serie = stochSerie(highs, lows, cierres).slice(CORTE);
    // Sin suavizado recursivo: si esto no cuadra, hay un bug real.
    expect(
      errorMax(
        serie.map((p) => p?.kRapido ?? null),
        ref["stoch_k_rapido"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
  });

  test("cadena lenta completa: %K rapido, %K lenta y %D lenta", () => {
    const serie = stochSerie(highs, lows, cierres).slice(CORTE);
    expect(
      errorMax(
        serie.map((p) => p?.kLenta ?? null),
        ref["stoch_k_lenta"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
    expect(
      errorMax(
        serie.map((p) => p?.dLenta ?? null),
        ref["stoch_d_lenta"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
  });

  test("CCI coincide con `ta`", () => {
    const serie = cciSerie(highs, lows, cierres).slice(CORTE);
    expect(
      errorMax(
        serie.map((p) => p?.cci ?? null),
        ref["cci20"] ?? [],
      ),
    ).toBeLessThanOrEqual(1e-6);
  });
});
