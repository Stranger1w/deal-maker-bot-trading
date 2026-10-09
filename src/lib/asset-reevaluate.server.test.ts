import { describe, test, expect } from "bun:test";
import { leerMinVolumen } from "./asset-reevaluate.server";

type DbFake = { from: (t: string) => { select: (c: string) => PromiseLike<unknown> } };

describe("leerMinVolumen", () => {
  test("lee el primer elemento del array de engine_config", async () => {
    const db = {
      from: () => ({
        select: async () => ({ data: [{ auto_symbol_min_volume: 123456 }], error: null }),
      }),
    } as unknown as DbFake;
    expect(await leerMinVolumen(db, "testnet")).toBe(123456);
  });

  test("usa la constante por entorno si data es null", async () => {
    const db = {
      from: () => ({ select: async () => ({ data: null, error: null }) }),
    } as unknown as DbFake;
    expect(await leerMinVolumen(db, "testnet")).toBeGreaterThan(0);
  });
});
