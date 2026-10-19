// Guardián de aislamiento por usuario.
//
// REGLA
// Las tablas "de configuracion" tienen UNA fila por usuario. El motor y las
// server functions las leen con service_role (que ignora RLS), asi que una
// lectura de una sola fila (.limit(1) / .maybeSingle() / .single()) SIN
// filtro por user_id devuelve una fila ARBITRARIA: la de otro usuario.
//
// Esto ya rompio la app (el 14-oct): el motor leia la configuracion de otro
// usuario, las alertas se perdian y los reportes se cruzaban.
//
// ESTE TEST ES LA REJA
// Si alguien vuelve a leer una de estas tablas sin filtrar por dueño, el
// test falla. Para una excepcion legitima (por ejemplo "la fila unica que
// hay hoy"), hay que escribir el marcador PERMITIDO en la linea anterior
// y justificarlo en un comentario.
//
// No se aplica al cliente del NAVEGADOR (src/lib/queries.ts): ese usa el
// token del usuario y las politicas RLS de la base ya filtran por dueno.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tablas con una fila por usuario (se leen con service_role en el servidor). */
const TABLAS_POR_USUARIO = [
  "automation_settings",
  "binance_credentials",
  "fund_accounts",
  "engine_config",
  "engine_sessions",
];

/** Lectura de una sola fila: es la que devuelve una fila arbitraria. */
const LECTURAS_DE_UNA_FILA = [".limit(1)", ".maybeSingle()", ".single()"];

type Hallazgo = { archivo: string; tabla: string; fragmento: string };

function archivosServidor(dir: string, acumulado: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === "node_modules" || nombre.startsWith(".")) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      archivosServidor(ruta, acumulado);
    } else if (/\.server\.ts$/.test(nombre) || /\.functions\.ts$/.test(nombre)) {
      acumulado.push(ruta);
    }
  }
  return acumulado;
}

function escanear(): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  for (const archivo of archivosServidor(join(process.cwd(), "src"))) {
    const codigo = readFileSync(archivo, "utf8");
    for (const tabla of TABLAS_POR_USUARIO) {
      let desde = 0;
      for (;;) {
        const i = codigo.indexOf(`.from("${tabla}")`, desde);
        if (i === -1) break;
        desde = i + 1;
        // La cadena de la consulta: hasta el fin de la sentencia.
        const fin = codigo.indexOf(";", i);
        const cadena = codigo.slice(i, fin === -1 ? i + 400 : fin);
        // Una escritura no es una lectura de fila arbitraria: el que escribe
        // decide a que fila va (y el guard exige user_id en el insert).
        if (cadena.includes(".insert(") || cadena.includes(".update(")) continue;
        if (!LECTURAS_DE_UNA_FILA.some((m) => cadena.includes(m))) continue;
        // Filtrada por dueño o por clave primaria: la fila es inequívoca.
        if (cadena.includes('.eq("user_id"') || cadena.includes(".eq('user_id'")) continue;
        if (cadena.includes('.eq("id"') || cadena.includes(".eq('id'")) continue;
        // Excepcion marcada a proposito.
        if (codigo.slice(Math.max(0, i - 400), i).includes("PERMITIDO")) continue;
        hallazgos.push({
          archivo: archivo.replace(process.cwd(), ""),
          tabla,
          fragmento: cadena.replace(/\s+/g, " ").slice(0, 160),
        });
      }
    }
  }
  return hallazgos;
}

describe("guardian de aislamiento por usuario", () => {
  const hallazgos = escanear();

  test("no se lee una fila de una tabla por usuario sin filtrar por dueño", () => {
    const detalle = hallazgos.map((h) => `${h.archivo} -> ${h.tabla}: ${h.fragmento}`).join("\n");
    expect(detalle).toBe("");
  });

  test("el guardian mira de verdad (si no, pasaria siempre)", () => {
    // Si la lista de tablas o de patrones se vaciara, el test pasaria en
    // silencio: se comprueba que hay material que revisar.
    expect(TABLAS_POR_USUARIO.length).toBeGreaterThanOrEqual(5);
    expect(LECTURAS_DE_UNA_FILA.length).toBeGreaterThanOrEqual(3);
  });
});
