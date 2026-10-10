import { describe, expect, test } from "bun:test";

import type { ClienteSupabase } from "./ownership.server";
import { exigirBotPropio, exigirRunPropio, exigirSandboxPropio } from "./ownership.server";

type Resultado = { data: unknown; error: { message: string } | null };
type Cadena = {
  select: (cols: string) => Cadena;
  eq: (col: string, valor: unknown) => Cadena;
  maybeSingle: () => Promise<Resultado>;
};

/** Cliente falso: registra tabla y filtros y devuelve el resultado indicado. */
function clienteFalso(resultado: Resultado) {
  const llamadas: Array<[string, unknown]> = [];
  const cadena: Cadena = {
    select: () => cadena,
    eq: (col, valor) => {
      llamadas.push([col, valor]);
      return cadena;
    },
    maybeSingle: async () => resultado,
  };
  const cliente = {
    from: (tabla: string) => {
      llamadas.push(["from", tabla]);
      return cadena;
    },
  } as unknown as ClienteSupabase;
  return { cliente, llamadas };
}

describe("exigirBotPropio", () => {
  test("devuelve la fila cuando es visible para el usuario", async () => {
    const fila = { id: "b1", name: "Alfa", pair: "BTCUSDT", user_id: "u1" };
    const { cliente, llamadas } = clienteFalso({ data: fila, error: null });
    const bot = await exigirBotPropio(cliente, "b1");
    expect(bot.id).toBe("b1");
    expect(bot.user_id).toBe("u1");
    expect(llamadas).toEqual([
      ["from", "bots"],
      ["id", "b1"],
    ]);
  });

  test("bot ajeno o inexistente (RLS no devuelve fila) -> Bot no encontrado", async () => {
    const { cliente } = clienteFalso({ data: null, error: null });
    let mensaje = "";
    try {
      await exigirBotPropio(cliente, "ajeno");
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    expect(mensaje).toBe("Bot no encontrado");
  });

  test("error de la base se propaga con su mensaje", async () => {
    const { cliente } = clienteFalso({ data: null, error: { message: "boom" } });
    let mensaje = "";
    try {
      await exigirBotPropio(cliente, "b1");
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    expect(mensaje).toBe("boom");
  });
});

describe("exigirSandboxPropio / exigirRunPropio", () => {
  test("sandbox propio -> devuelve la fila de training_sandboxes", async () => {
    const { cliente, llamadas } = clienteFalso({ data: { id: "s1", user_id: "u1" }, error: null });
    const sandbox = await exigirSandboxPropio(cliente, "s1");
    expect(sandbox.id).toBe("s1");
    expect(llamadas[0]).toEqual(["from", "training_sandboxes"]);
  });

  test("sandbox ajeno -> Sandbox no encontrado", async () => {
    const { cliente } = clienteFalso({ data: null, error: null });
    let mensaje = "";
    try {
      await exigirSandboxPropio(cliente, "s2");
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    expect(mensaje).toBe("Sandbox no encontrado");
  });

  test("resultado propio -> devuelve la fila; ajeno -> Resultado no encontrado", async () => {
    const propio = clienteFalso({ data: { id: "r1", bot_id: "b1" }, error: null });
    const run = await exigirRunPropio(propio.cliente, "r1");
    expect(run.id).toBe("r1");
    expect(propio.llamadas[0]).toEqual(["from", "training_runs"]);

    const ajeno = clienteFalso({ data: null, error: null });
    let mensaje = "";
    try {
      await exigirRunPropio(ajeno.cliente, "r2");
    } catch (e) {
      mensaje = e instanceof Error ? e.message : String(e);
    }
    expect(mensaje).toBe("Resultado no encontrado");
  });
});
