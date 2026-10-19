import { describe, test, expect } from "bun:test";
import { leerMinVolumen } from "./asset-reevaluate.server";

type Fila = { auto_symbol_min_volume?: unknown };

/** Cadena encadenable como la del cliente real: thenable + eq(). */
type CadenaFalsa = PromiseLike<unknown> & {
  eq: (columna: string, valor: unknown) => CadenaFalsa;
};

/**
 * Cliente falso que imita la capa PostgREST: select() devuelve un objeto
 * encadenable (thenable) con eq(), como en el cliente real.
 */
function dbFalso(filas: Fila[] | null) {
  const llamadas: Array<[string, unknown]> = [];
  const resultado = { data: filas, error: null };
  const cadena: CadenaFalsa = {
    then: <T1, T2>(
      onfulfilled?: ((value: unknown) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) => Promise.resolve(resultado).then(onfulfilled, onrejected) as Promise<T1 | T2>,
    eq: (columna: string, valor: unknown) => {
      llamadas.push([columna, valor]);
      return cadena;
    },
  };
  const db = {
    from: (tabla: string) => {
      llamadas.push(["from", tabla]);
      return { select: () => cadena };
    },
  } as unknown as Parameters<typeof leerMinVolumen>[0];
  return { db, llamadas };
}

describe("leerMinVolumen", () => {
  test("lee el primer elemento del array de engine_config", async () => {
    const { db } = dbFalso([{ auto_symbol_min_volume: 123456 }]);
    expect(await leerMinVolumen(db, "testnet")).toBe(123456);
  });

  test("usa la constante por entorno si data es null", async () => {
    const { db } = dbFalso(null);
    expect(await leerMinVolumen(db, "testnet")).toBeGreaterThan(0);
  });

  test("con userId filtra la fila de ese usuario (engine_config es una fila por usuario)", async () => {
    const { db, llamadas } = dbFalso([{ auto_symbol_min_volume: 123456 }]);
    expect(await leerMinVolumen(db, "testnet", "u-antonio")).toBe(123456);
    expect(llamadas.some(([columna]) => columna === "from")).toBe(true);
    expect(
      llamadas.some(([columna, valor]) => columna === "user_id" && valor === "u-antonio"),
    ).toBe(true);
  });

  test("sin userId no filtra (compatibilidad con instalaciones de un solo usuario)", async () => {
    const { db, llamadas } = dbFalso([{ auto_symbol_min_volume: 123456 }]);
    await leerMinVolumen(db, "testnet");
    expect(llamadas.filter(([columna]) => columna === "user_id")).toHaveLength(0);
  });
});
