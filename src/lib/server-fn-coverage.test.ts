// Cobertura de seguridad de las server functions.
//
// Regla: TODA createServerFn declara su nivel de acceso de forma explicita con
// .middleware([requireAdmin]) o .middleware([requireSupabaseAuth]). Solo las
// funciones de la lista USUARIO pueden usar requireSupabaseAuth (cualquier
// usuario con sesion); todo lo demas es solo para administrador.
//
// Si anades una server function y este test falla, no lo "arregles" ampliando la
// lista: decide a conciencia si de verdad debe poder ejecutarla un usuario normal
// (y entonces compruebe la propiedad de la fila con ownership.server.ts).

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Funciones abiertas a usuarios normales (con sesion). Lista cerrada. */
const USUARIO = [
  "createBot",
  "setBotStatus",
  "updateBotStrategy",
  "setBotMode",
  "updateBotRisk",
  "createSandbox",
  "runSandbox",
  "promoteRun",
  "listarMercados",
  "validarParMercado",
].sort();

type Hallazgo = { archivo: string; nombre: string; nivel: "admin" | "usuario" | "ninguno" };

function archivosTs(dir: string, acumulado: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre.startsWith(".")) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      archivosTs(ruta, acumulado);
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      acumulado.push(ruta);
    }
  }
  return acumulado;
}

function escanear(): { hallazgos: Hallazgo[]; sinNombre: string[] } {
  const hallazgos: Hallazgo[] = [];
  const sinNombre: string[] = [];
  for (const archivo of archivosTs(join(process.cwd(), "src"))) {
    const codigo = readFileSync(archivo, "utf8");
    const llamadas = (codigo.match(/createServerFn\(/g) ?? []).length;
    if (llamadas === 0) continue;

    const patron = /(?:export\s+)?const\s+(\w+)\s*=\s*createServerFn\(/g;
    let encontradas = 0;
    let m: RegExpExecArray | null;
    while ((m = patron.exec(codigo)) !== null) {
      encontradas++;
      const nombre = m[1] ?? "?";
      const desde = m.index;
      const hasta = codigo.indexOf(".handler(", desde);
      const cadena = hasta === -1 ? codigo.slice(desde) : codigo.slice(desde, hasta);
      let nivel: Hallazgo["nivel"] = "ninguno";
      if (cadena.includes(".middleware([requireAdmin])")) nivel = "admin";
      else if (cadena.includes(".middleware([requireSupabaseAuth])")) nivel = "usuario";
      hallazgos.push({ archivo: archivo.replace(process.cwd(), ""), nombre, nivel });
    }
    if (encontradas !== llamadas) sinNombre.push(archivo.replace(process.cwd(), ""));
  }
  return { hallazgos, sinNombre };
}

describe("cobertura de seguridad de server functions", () => {
  const { hallazgos, sinNombre } = escanear();

  test("se encuentran las server functions del proyecto", () => {
    expect(hallazgos.length >= 30).toBe(true);
  });

  test("todas las createServerFn tienen forma 'const nombre = createServerFn(' (si no, no se pueden auditar)", () => {
    expect(sinNombre).toEqual([]);
  });

  test("ninguna server function queda sin nivel explicito", () => {
    const sinNivel = hallazgos
      .filter((h) => h.nivel === "ninguno")
      .map((h) => `${h.archivo}:${h.nombre}`);
    expect(sinNivel).toEqual([]);
  });

  test("solo la lista cerrada USUARIO usa requireSupabaseAuth", () => {
    const usuario = hallazgos
      .filter((h) => h.nivel === "usuario")
      .map((h) => h.nombre)
      .sort();
    expect(usuario).toEqual(USUARIO);
  });

  test("los nombres de server functions no se repiten (el test razona por nombre)", () => {
    const nombres = hallazgos.map((h) => h.nombre);
    expect(nombres.length).toBe(new Set(nombres).size);
  });

  test("src/start.ts exige sesion valida de forma global (requireSupabaseAuth)", () => {
    const start = readFileSync(join(process.cwd(), "src", "start.ts"), "utf8");
    expect(/functionMiddleware:\s*\[[^\]]*requireSupabaseAuth/.test(start)).toBe(true);
  });
});
