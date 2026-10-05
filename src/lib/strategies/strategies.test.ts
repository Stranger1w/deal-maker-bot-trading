import { describe, expect, test } from "bun:test";
import {
  ESTRATEGIAS,
  FRASE_ACEPTACION,
  MAX_NIVEL,
  MAX_PERDIDAS_CONSECUTIVAS,
  agresiva,
  buscarEstrategia,
  conservadora,
  decidir,
  estadoInicial,
  factorAgresiva,
  factorConservadora,
  factorOptima,
  fija,
  optima,
  tablaDeRacha,
  type StrategyState,
} from "./index";

/**
 * Todos los valores esperados de este archivo son NUMEROS LITERALES
 * calculados a mano y verificados con el script independiente
 * gen_expected_strategies.py. Ninguno se ha estimado ni deducido ejecutando
 * el codigo que se esta probando.
 */

const CTX = { base: 20, capital: 1000, minNotional: 5 };

/** Estado con las rachas ya producidas, para probar el factor. */
function st(ganadas: number, perdidas: number, nivel = 0): StrategyState {
  return { consecutivasGanadas: ganadas, consecutivasPerdidas: perdidas, nivel, pausada: false };
}

describe("conservadora · factor = max(0.25, 0.75^floor(perdidas/2))", () => {
  test("tabla completa de la especificación", () => {
    // 0.75^0=1, ^1=0.75, ^2=0.5625, ^3=0.421875, ^4=0.31640625,
    // ^5=0.2373... -> recortado al suelo de 0.25
    const esperado = [
      [0, 1],
      [1, 1],
      [2, 0.75],
      [3, 0.75],
      [4, 0.5625],
      [5, 0.5625],
      [6, 0.421875],
      [7, 0.421875],
      [8, 0.31640625],
      [9, 0.31640625],
      [10, 0.25],
      [11, 0.25],
      [20, 0.25],
    ] as const;
    for (const [perdidas, factor] of esperado) {
      expect(factorConservadora(perdidas)).toBeCloseTo(factor, 12);
      expect(conservadora.factor(st(0, perdidas))).toBeCloseTo(factor, 12);
    }
  });

  test("a partir de 10 pérdidas se queda en el suelo de 0.25", () => {
    for (const p of [10, 50, 500, 100000]) {
      expect(factorConservadora(p)).toBe(0.25);
    }
  });

  test("una ganancia devuelve el factor a 1", () => {
    expect(conservadora.factor(st(1, 0))).toBe(1);
    expect(conservadora.factor(st(0, 0))).toBe(1);
  });

  test("montos de una racha de 5 pérdidas (base=20, saldo=1000)", () => {
    // Verificado con Python: 20, 20, 15, 15, 11.25
    expect(tablaDeRacha("conservative", 5, CTX).map((f) => f.monto)).toEqual([
      20, 20, 15, 15, 11.25,
    ]);
  });
});

describe("optima · factor = clamp(1 + 0.10*ganadas - 0.15*perdidas, 0.5, 1.5)", () => {
  test("valores calculados independientemente", () => {
    expect(factorOptima(0, 0)).toBeCloseTo(1, 12); // 1
    expect(factorOptima(1, 0)).toBeCloseTo(1.1, 12); // 1 + 0.10
    expect(factorOptima(3, 0)).toBeCloseTo(1.3, 12); // 1 + 0.30
    expect(factorOptima(0, 1)).toBeCloseTo(0.85, 12); // 1 - 0.15
    expect(factorOptima(0, 3)).toBeCloseTo(0.55, 12); // 1 - 0.45
    expect(factorOptima(2, 2)).toBeCloseTo(0.9, 12); // 1 + 0.20 - 0.30
  });

  test("tope superior en 1.5", () => {
    expect(factorOptima(5, 0)).toBe(1.5);
    expect(factorOptima(10, 0)).toBe(1.5);
    expect(factorOptima(100, 0)).toBe(1.5);
  });

  test("tope inferior en 0.5", () => {
    expect(factorOptima(0, 4)).toBeCloseTo(0.5, 12);
    expect(factorOptima(0, 10)).toBe(0.5);
    expect(factorOptima(0, 999)).toBe(0.5);
  });

  test("usa el tope de capital del 5%, no el 10%", () => {
    expect(optima.topeFraccionCapital).toBe(0.05);
    // base 200, factor 1.5 -> bruto 300; tope = 1000 * 0.05 = 50
    const d = decidir(optima, { base: 200, capital: 1000, minNotional: 5 }, st(5, 0), {});
    expect(d?.monto).toBe(50);
    expect(d?.recortadoPorCapital).toBe(true);
  });
});

describe("agresiva · factor = 2^nivel con tope duro en nivel 3", () => {
  test("secuencia 1x, 2x, 4x, 8x", () => {
    expect(factorAgresiva(0)).toBe(1);
    expect(factorAgresiva(1)).toBe(2);
    expect(factorAgresiva(2)).toBe(4);
    expect(factorAgresiva(3)).toBe(8);
  });

  test("NO supera el nivel 3 aunque se le insista", () => {
    for (const nivel of [4, 5, 10, 100, 9999]) {
      expect(factorAgresiva(nivel)).toBe(8);
    }
    expect(factorAgresiva(MAX_NIVEL)).toBe(8);
  });

  test("niveles negativos se tratan como 0", () => {
    expect(factorAgresiva(-1)).toBe(1);
    expect(factorAgresiva(-99)).toBe(1);
  });

  test("tabla de 5 pérdidas (base=20, saldo=1000, tope 10% = 100)", () => {
    // Verificado con Python: 20, 40, 80 y 100 (recortado de 160)
    const tabla = tablaDeRacha("aggressive", 5, CTX);
    expect(tabla.map((f) => f.monto)).toEqual([20, 40, 80, 100]);
    expect(tabla.map((f) => f.nivel)).toEqual([0, 1, 2, 3]);
    expect(tabla[3]?.recortado).toBe(true);
    expect(tabla[0]?.recortado).toBe(false);
  });

  test("se pausa al llegar a 4 pérdidas seguidas", () => {
    const tabla = tablaDeRacha("aggressive", 5, CTX);
    expect(MAX_PERDIDAS_CONSECUTIVAS).toBe(4);
    expect(tabla.length).toBe(4);
    expect(tabla[3]?.pausa).toBe(true);
    expect(tabla[0]?.pausa).toBe(false);
  });

  test("el máximo de pérdidas es configurable", () => {
    const tabla = tablaDeRacha("aggressive", 6, CTX, { maxPerdidasConsecutivas: 2 });
    expect(tabla.length).toBe(2);
    expect(tabla[1]?.pausa).toBe(true);
  });

  test("una ganancia reinicia el nivel a 0", () => {
    let estado = estadoInicial();
    estado = agresiva.registrarResultado(estado, -1, {}).estado; // nivel 1
    estado = agresiva.registrarResultado(estado, -1, {}).estado; // nivel 2
    expect(estado.nivel).toBe(2);
    const tras = agresiva.registrarResultado(estado, 5, {});
    expect(tras.estado.nivel).toBe(0);
    expect(tras.estado.consecutivasPerdidas).toBe(0);
  });

  test("al pausarse, el nivel NO se reinicia solo", () => {
    let estado = estadoInicial();
    for (let i = 0; i < 4; i++) estado = agresiva.registrarResultado(estado, -1, {}).estado;
    expect(estado.pausada).toBe(true);
    const mas = agresiva.registrarResultado(estado, -1, {});
    expect(mas.pausar).toBe(false);
    expect(mas.estado.pausada).toBe(true);
    expect(mas.estado.nivel).toBe(3);
  });
});

describe("PnL exactamente 0 no cambia las rachas", () => {
  test("conservadora, optima y agresiva", () => {
    for (const def of [conservadora, optima, agresiva]) {
      const r = def.registrarResultado(st(2, 2, 1), 0, {});
      expect(r.estado.consecutivasGanadas).toBe(2);
      expect(r.estado.consecutivasPerdidas).toBe(2);
      expect(r.estado.nivel).toBe(1);
      expect(r.pausar).toBe(false);
    }
  });
});

describe("tope de capital", () => {
  test("ninguna pasa del 10% salvo Óptima, que va al 5%", () => {
    for (const def of [fija, conservadora, optima, agresiva]) {
      const d = decidir(def, { base: 10000, capital: 1000, minNotional: 5 }, st(0, 0), {});
      const esperado = Math.round(1000 * def.topeFraccionCapital * 100) / 100;
      expect(d?.monto).toBe(esperado);
      expect(d?.recortadoPorCapital).toBe(true);
    }
  });
});

describe("minNotional", () => {
  test("si el monto queda por debajo, devuelve null y NO lo agranda", () => {
    const d = decidir(fija, { base: 3, capital: 1000, minNotional: 5 }, st(0, 0), {});
    expect(d).toBeNull();
  });
  describe("intento de superar todos los topes (1000 pérdidas seguidas)", () => {
    test("agresiva: ni el factor ni el monto se salen del tope", () => {
      let estado = estadoInicial();
      let factorMax = 0;
      let montoMax = 0;
      for (let i = 0; i < 1000; i++) {
        if (estado.pausada) break; // el motor está parado: no sigue operando
        const d = decidir(agresiva, CTX, estado, {});
        if (d) {
          factorMax = Math.max(factorMax, d.factor);
          montoMax = Math.max(montoMax, d.monto);
          expect(d.monto).toBeLessThanOrEqual(CTX.capital * 0.1 + 0.001);
        }
        estado = agresiva.registrarResultado(estado, -1, {}).estado;
      }
      expect(estado.pausada).toBe(true);
      expect(factorMax).toBe(8);
      expect(montoMax).toBe(100);
    });

    test("ninguna estrategia puede montar el monto indefinidamente", () => {
      for (const def of [fija, conservadora, optima, agresiva]) {
        let estado = estadoInicial();
        let montoMax = 0;
        for (let i = 0; i < 1000 && !estado.pausada; i++) {
          const d = decidir(def, CTX, estado, {});
          if (d) montoMax = Math.max(montoMax, d.monto);
          estado = def.registrarResultado(estado, -1, {}).estado;
        }
        expect(montoMax).toBeLessThanOrEqual(CTX.capital * def.topeFraccionCapital + 0.001);
      }
    });
  });

  describe("requisitos de la agresiva", () => {
    test("exige ACEPTO con ortografía correcta y está marcada como tal", () => {
      expect(FRASE_ACEPTACION).toBe("ACEPTO");
      expect(agresiva.requiereAcepto).toBe(true);
      expect(agresiva.soloTestnet).toBe(true);
    });

    test("las demás no exigen nada", () => {
      expect(fija.requiereAcepto).toBeUndefined();
      expect(conservadora.requiereAcepto).toBeUndefined();
      expect(optima.requiereAcepto).toBeUndefined();
    });
  });

  describe("registro de estrategias", () => {
    test("están las 4, ordenadas de menor a mayor riesgo", () => {
      expect(ESTRATEGIAS.length).toBe(4);
      expect(ESTRATEGIAS.map((e) => e.id)).toEqual([
        "fixed",
        "conservative",
        "optimal",
        "aggressive",
      ]);
      expect(ESTRATEGIAS.map((e) => e.nivelRiesgo)).toEqual(["bajo", "bajo", "medio", "alto"]);
    });

    test("todas tienen resumen, calculo y descripción", () => {
      for (const e of ESTRATEGIAS) {
        expect(e.descripcionCorta.length).toBeGreaterThan(30);
        expect(e.detalles.resumen.length).toBeGreaterThan(20);
        expect(e.detalles.calculo.length).toBeGreaterThan(20);
        expect(e.topeFraccionCapital).toBeGreaterThan(0);
      }
    });

    test("buscarEstrategia devuelve null para una desconocida", () => {
      expect(buscarEstrategia("no_existe")).toBeNull();
    });
  });

  test("la conservadora puede caer por debajo del minimo", () => {
    // base 20, 12+ perdidas -> factor 0.25 -> 5 USDT, justo en el minimo.
    expect(decidir(conservadora, CTX, st(0, 12), {})?.monto).toBe(5);
    // base 10 -> 2.5 USDT, por debajo del minimo de 5.
    expect(
      decidir(conservadora, { base: 10, capital: 1000, minNotional: 5 }, st(0, 12), {}),
    ).toBeNull();
  });
});

describe("test defensivo: 1000 losses IGNORANDO la pausa", () => {
  test("agresiva: factor <= 8 y monto <= tope aunque se ignore la pausa", () => {
    let estado = estadoInicial();
    let factorMax = 0;
    let montoMax = 0;
    for (let i = 0; i < 1000; i++) {
      // A proposito NO se rompe el bucle al pausar: se sigue operando como si el
      // motor ignorase la pausa, para demostrar que los topes siguen UGUAL.
      const d = decidir(agresiva, CTX, estado, {});
      if (d) {
        factorMax = Math.max(factorMax, d.factor);
        montoMax = Math.max(montoMax, d.monto);
        expect(d.factor).toBeLessThanOrEqual(8);
        expect(d.monto).toBeLessThanOrEqual(CTX.capital * 0.1 + 0.001);
      }
      const r = agresiva.registrarResultado(estado, -1, {});
      // Se ignora la pausa a proposito para seguir stressful el motor.
      estado = { ...r.estado, pausada: false };
    }
    expect(factorMax).toBe(8);
    expect(montoMax).toBe(100);
  });

  test("agresiva: el tope de nivel 3 aguanta 1000 losses ignorando la pausa", () => {
    let estado = estadoInicial();
    for (let i = 0; i < 1000; i++) {
      const r = agresiva.registrarResultado(estado, -1, {});
      estado = { ...r.estado, pausada: false };
      expect(estado.nivel).toBeLessThanOrEqual(MAX_NIVEL);
    }
    expect(estado.nivel).toBe(MAX_NIVEL);
  });

  test("las cuatro: ningún monto se sale del tope de capital en 1000 losses", () => {
    for (const def of [fija, conservadora, optima, agresiva]) {
      let estado = estadoInicial();
      let montoMax = 0;
      for (let i = 0; i < 1000; i++) {
        const d = decidir(def, CTX, estado, {});
        if (d) {
          montoMax = Math.max(montoMax, d.monto);
          expect(d.monto).toBeLessThanOrEqual(CTX.capital * def.topeFraccionCapital + 0.001);
        }
        const r = def.registrarResultado(estado, -1, {});
        estado = { ...r.estado, pausada: false };
      }
      expect(montoMax).toBeLessThanOrEqual(CTX.capital * def.topeFraccionCapital + 0.001);
    }
  });
});
describe("redondeo a 2 decimales", () => {
  test("20 * 0.5625 = 11.25", () => {
    expect(decidir(conservadora, CTX, st(0, 4), {})?.monto).toBe(11.25);
  });

  test("20 * 0.421875 = 8.44", () => {
    expect(decidir(conservadora, CTX, st(0, 6), {})?.monto).toBe(8.44);
  });
});
