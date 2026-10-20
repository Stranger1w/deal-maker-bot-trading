import { afterEach, describe, expect, test } from "bun:test";

import { CLAVE_SECRETO_CRON, generarSecreto, leerSecretoCron, verificarCron } from "./cron.server";

type Resultado = { data: unknown; error: { message: string } | null };

/** Cliente falso de app_settings: devuelve la fila indicada (o error). */
function clienteFalso(resultado: Resultado) {
  const llamadas: Array<[string, unknown]> = [];
  const cadena = {
    select: () => cadena,
    eq: (col: string, valor: unknown) => {
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
  };
  return { cliente: cliente as never, llamadas };
}

const envOriginal = process.env["LOVABLE_CRON_SECRET"];

afterEach(() => {
  if (envOriginal === undefined) delete process.env["LOVABLE_CRON_SECRET"];
  else process.env["LOVABLE_CRON_SECRET"] = envOriginal;
});

describe("generarSecreto", () => {
  test("devuelve un valor largo y aleatorio", () => {
    const a = generarSecreto();
    const b = generarSecreto();
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
  });

  test("solo usa caracteres seguros para una cabecera HTTP", () => {
    const s = generarSecreto();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("leerSecretoCron", () => {
  test("el entorno tiene prioridad sobre la base", async () => {
    process.env["LOVABLE_CRON_SECRET"] = "del-entorno";
    const { cliente, llamadas } = clienteFalso({ data: { value: "de-la-base" }, error: null });
    expect(await leerSecretoCron(cliente)).toBe("del-entorno");
    expect(llamadas).toEqual([]);
  });

  test("si no esta en el entorno, lee de app_settings", async () => {
    delete process.env["LOVABLE_CRON_SECRET"];
    const { cliente, llamadas } = clienteFalso({ data: { value: "de-la-base" }, error: null });
    expect(await leerSecretoCron(cliente)).toBe("de-la-base");
    expect(llamadas).toEqual([
      ["from", "app_settings"],
      ["key", CLAVE_SECRETO_CRON],
    ]);
  });

  test("devuelve null si no hay secreto en ninguna parte", async () => {
    delete process.env["LOVABLE_CRON_SECRET"];
    const { cliente } = clienteFalso({ data: null, error: null });
    expect(await leerSecretoCron(cliente)).toBeNull();
  });

  test("un error de la base no rompe nada", async () => {
    delete process.env["LOVABLE_CRON_SECRET"];
    const { cliente } = clienteFalso({ data: null, error: { message: "boom" } });
    expect(await leerSecretoCron(cliente)).toBeNull();
  });
});

describe("verificarCron", () => {
  const peticion = (cabecera?: string) =>
    new Request("http://localhost/api/public/automation-tick", {
      method: "POST",
      ...(cabecera ? { headers: { Authorization: cabecera } } : {}),
    });

  test("sin secreto configurado dice que falta", async () => {
    delete process.env["LOVABLE_CRON_SECRET"];
    const { cliente } = clienteFalso({ data: null, error: null });
    const error = await verificarCron(cliente, peticion("Bearer lo-que-sea"));
    expect(error).toContain("Falta el secreto del cron");
  });

  test("sin cabecera Authorization avisa", async () => {
    process.env["LOVABLE_CRON_SECRET"] = "abc";
    const { cliente } = clienteFalso({ data: null, error: null });
    const error = await verificarCron(cliente, peticion());
    expect(error).toContain("Authorization");
  });

  test("una cabecera que no es Bearer avisa", async () => {
    process.env["LOVABLE_CRON_SECRET"] = "abc";
    const { cliente } = clienteFalso({ data: null, error: null });
    const error = await verificarCron(cliente, peticion("Basic abc"));
    expect(error).toContain("Bearer");
  });

  test("un secreto incorrecto se rechaza", async () => {
    process.env["LOVABLE_CRON_SECRET"] = "secreto-correcto";
    const { cliente } = clienteFalso({ data: null, error: null });
    const error = await verificarCron(cliente, peticion("Bearer secreto-incorrecto"));
    expect(error).toBe("Secreto incorrecto.");
  });

  test("el secreto correcto pasa", async () => {
    process.env["LOVABLE_CRON_SECRET"] = "secreto-correcto";
    const { cliente } = clienteFalso({ data: null, error: null });
    expect(await verificarCron(cliente, peticion("Bearer secreto-correcto"))).toBeNull();
  });
});
