import { describe, expect, test } from "bun:test";

import { comprobarMigraciones, type ClienteEsquema } from "./estado.server";

type Respuesta = { error: { message: string } | null; data: unknown };

/** Constructor falso (el real es awaitable en cualquier punto). */
type ConstructorFalso = {
  select: (columnas: string) => ConstructorFalso;
  eq: (columna: string, valor: string) => ConstructorFalso;
  limit: (n: number) => Promise<Respuesta>;
  then: (onCumplido?: (v: Respuesta) => unknown) => Promise<unknown>;
};

/**
 * Cliente falso que imita a PostgREST: si la columna (o la tabla) no existe,
 * la consulta falla con un error; si existe, devuelve una fila.
 *
 * Las claves del set son "tabla.columna" (o "tabla.*" para la tabla entera).
 */
function clienteFalso(existen: Set<string>) {
  const consultas: string[] = [];

  const construir = (tabla: string, columnas: string[]): ConstructorFalso => {
    const falta = columnas.some((c) => !existen.has(`${tabla}.${c}`));
    if (falta) {
      const error = { message: `column ${tabla}.${columnas[0]} does not exist` };
      const fallo: ConstructorFalso = {
        select: () => fallo,
        eq: () => fallo,
        limit: async (): Promise<Respuesta> => ({ error, data: null }),
        then: (onCumplido?: (v: Respuesta) => unknown) =>
          Promise.resolve(onCumplido?.({ error, data: null })),
      };
      return fallo;
    }
    const ok: ConstructorFalso = {
      select: (c: string) => construir(tabla, [...columnas, c]),
      eq: () => ok,
      limit: async (): Promise<Respuesta> => ({ error: null, data: [{ value: "false" }] }),
      then: (onCumplido?: (v: Respuesta) => unknown) =>
        Promise.resolve(onCumplido?.({ error: null, data: [{ value: "false" }] })),
    };
    return ok;
  };

  const cliente = {
    from: (tabla: string) => {
      consultas.push(`from ${tabla}`);
      return construir(tabla, []);
    },
  } as unknown as ClienteEsquema;

  return { cliente, consultas };
}

describe("comprobarMigraciones", () => {
  test("detecta las diez migraciones y dice cuales faltan", async () => {
    // Estado real de la base del dueno: solo existe app_settings.
    const { cliente } = clienteFalso(new Set(["app_settings.value"]));
    const migraciones = await comprobarMigraciones(cliente);
    expect(migraciones).toHaveLength(10);
    for (const m of migraciones) {
      expect(m.fichero.endsWith(".sql")).toBe(true);
      expect(m.titulo.length).toBeGreaterThan(0);
      expect(m.paraQueSirve.length).toBeGreaterThan(0);
    }
    // Solo la del interruptor de registro esta aplicada.
    expect(migraciones.filter((m) => m.aplicada).map((m) => m.fichero)).toEqual([
      "20261020000000_app_settings_registro_publico.sql",
    ]);
  });

  test("si todo existe, no queda ninguna pendiente", async () => {
    const { cliente } = clienteFalso(
      new Set([
        "app_settings.value",
        "bot_executions.signal_indicators",
        "engine_strategies.indicator_ids",
        "automation_settings.riesgo_por_operacion",
        "engine_config.auto_symbol_max_spread_pct",
        "engine_cycles.*",
        "mining_workers.hash_rate_max",
        "market_candles.*",
        "mining_workers.pool_fee_pct",
        "bots.sort_order",
      ]),
    );
    const migraciones = await comprobarMigraciones(cliente);
    expect(migraciones.every((m) => m.aplicada)).toBe(true);
  });

  test("cada migracion se comprueba con algo distinto", async () => {
    const { cliente, consultas } = clienteFalso(new Set(["app_settings.value"]));
    await comprobarMigraciones(cliente);
    expect(consultas).toContain("from bot_executions");
    expect(consultas).toContain("from engine_strategies");
    expect(consultas).toContain("from automation_settings");
    expect(consultas).toContain("from engine_config");
    expect(consultas).toContain("from engine_cycles");
    expect(consultas).toContain("from mining_workers");
    expect(consultas).toContain("from market_candles");
  });
});
