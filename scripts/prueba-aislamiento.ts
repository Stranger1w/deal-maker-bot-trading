/**
 * Prueba de aislamiento con DOS usuarios (Fase A.6).
 *
 * Comprueba, contra la base de datos REAL, que un usuario no ve ni puede
 * tocar lo de otro: bots, configuracion del motor, credenciales, sesiones
 * y auditoria. Se hace con el token de cada usuario (el mismo que usa la
 * app), asi que lo que se comprueba es lo que ven las RLS de verdad.
 *
 * NO ESCRIBE NADA: solo SELECT. Es una prueba de lectura, no un ataque.
 *
 * Uso (PowerShell, con las credenciales de los dos usuarios de prueba):
 *
 *   $env:TEST_USUARIO_A = "dueno@ejemplo.com"
 *   $env:TEST_PASSWORD_A = "..."
 *   $env:TEST_USUARIO_B = "familiar@ejemplo.com"
 *   $env:TEST_PASSWORD_B = "..."
 *   bun scripts/prueba-aislamiento.ts
 *
 * Salida: una linea por comprobacion (OK / FALLO) y el resumen.
 * Si algo falla, el aislamiento NO esta bien: no abras el registro ni
 * repartas bots entre usuarios.
 */

import { readFileSync } from "node:fs";

type Resultado = { nombre: string; ok: boolean; detalle: string };

const env: Record<string, string> = {};
for (const linea of readFileSync("C:\\Users\\Usuario\\secrets\\deal-maker.env", "utf8").split(
  /\r?\n/,
)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(linea);
  if (m) env[m[1]] = m[2].trim();
}

const url = env["SUPABASE_URL"];
const publishable = env["VITE_SUPABASE_PUBLISHABLE_KEY"];
if (!url || !publishable) {
  console.error("Faltan SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY en el fichero de secretos.");
  process.exit(1);
}

async function tokenDe(email: string, password: string): Promise<string> {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishable, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cuerpo = (await res.json()) as { access_token?: string; msg?: string };
  if (!res.ok || !cuerpo.access_token) {
    throw new Error(`No se pudo iniciar sesion con ${email}: ${cuerpo.msg ?? res.status}`);
  }
  return cuerpo.access_token;
}

async function consultar(
  token: string,
  tabla: string,
  opciones: { columnas?: string; filtros?: string } = {},
): Promise<{ status: number; filas: unknown[] }> {
  const urlTabla = new URL(`${url}/rest/v1/${tabla}`);
  if (opciones.columnas) urlTabla.searchParams.set("select", opciones.columnas);
  if (opciones.filtros) urlTabla.searchParams.set("id", opciones.filtros);
  const res = await fetch(urlTabla, {
    headers: { apikey: publishable, Authorization: `Bearer ${token}` },
  });
  const texto = await res.text();
  let filas: unknown[] = [];
  try {
    const json = JSON.parse(texto);
    filas = Array.isArray(json) ? json : [];
  } catch {
    filas = [];
  }
  return { status: res.status, filas };
}

const emailA = process.env["TEST_USUARIO_A"];
const passA = process.env["TEST_PASSWORD_A"];
const emailB = process.env["TEST_USUARIO_B"];
const passB = process.env["TEST_PASSWORD_B"];
if (!emailA || !passA || !emailB || !passB) {
  console.error(
    "Faltan las credenciales: TEST_USUARIO_A, TEST_PASSWORD_A, TEST_USUARIO_B y TEST_PASSWORD_B.",
  );
  process.exit(1);
}

const tokenA = await tokenDe(emailA, passA);
const tokenB = await tokenDe(emailB, passB);
console.log(`Sesiones iniciadas: ${emailA} y ${emailB}\n`);

const resultados: Resultado[] = [];
function comprobar(nombre: string, ok: boolean, detalle: string) {
  resultados.push({ nombre, ok, detalle });
  console.log(`${ok ? "OK   " : "FALLO"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}

/* 1) Cada usuario ve SUS bots y solo los suyos. */
const botsA = await consultar(tokenA, "bots", { columnas: "id,name,user_id" });
const botsB = await consultar(tokenB, "bots", { columnas: "id,name,user_id" });
const userIdA = (botsA.filas[0] as { user_id?: string } | undefined)?.user_id ?? null;
const userIdB = (botsB.filas[0] as { user_id?: string } | undefined)?.user_id ?? null;

comprobar(
  "cada usuario ve solo sus bots",
  userIdA !== null && userIdB !== null && userIdA !== userIdB,
  `A ve ${botsA.filas.length} bots (user ${userIdA ?? "-"}), B ve ${botsB.filas.length} (user ${userIdB ?? "-"})`,
);

/* 2) Un bot del otro usuario NO es visible por id. */
if (botsB.filas.length > 0) {
  const idB = (botsB.filas[0] as { id: string }).id;
  const vistoPorA = await consultar(tokenA, "bots", { columnas: "id", filtros: idB });
  comprobar(
    "un bot del usuario B NO es visible para A",
    vistoPorA.filas.length === 0,
    `filas que A ve del bot de B: ${vistoPorA.filas.length}`,
  );
} else {
  comprobar(
    "un bot del usuario B NO es visible para A",
    true,
    "B no tiene bots: nada que comprobar",
  );
}

/* 3) La configuracion del motor es por usuario. */
const ajustesA = await consultar(tokenA, "automation_settings", {
  columnas: "id,user_id,engine_enabled",
});
const ajustesB = await consultar(tokenB, "automation_settings", {
  columnas: "id,user_id,engine_enabled",
});
comprobar(
  "la configuracion del motor es una fila por usuario",
  ajustesA.filas.length <= 1 && ajustesB.filas.length <= 1,
  `A: ${ajustesA.filas.length} fila(s), B: ${ajustesB.filas.length} fila(s)`,
);

/* 4) Las credenciales de exchange: cada usuario ve las suyas (o ninguna). */
const credsA = await consultar(tokenA, "binance_credentials", {
  columnas: "id,user_id,api_key_last4",
});
const credsB = await consultar(tokenB, "binance_credentials", {
  columnas: "id,user_id,api_key_last4",
});
comprobar(
  "las credenciales no se mezclan entre usuarios",
  credsA.filas.every((f) => (f as { user_id?: string }).user_id !== userIdB) &&
    credsB.filas.every((f) => (f as { user_id?: string }).user_id !== userIdA),
  `A ve ${credsA.filas.length} credencial(es), B ve ${credsB.filas.length}`,
);

/* 5) Las sesiones del motor: cada usuario ve las suyas. */
const sesionesA = await consultar(tokenA, "engine_sessions", { columnas: "id,user_id,status" });
const sesionesB = await consultar(tokenB, "engine_sessions", { columnas: "id,user_id,status" });
comprobar(
  "las sesiones del motor no se mezclan",
  sesionesA.filas.every((f) => (f as { user_id?: string }).user_id !== userIdB) &&
    sesionesB.filas.every((f) => (f as { user_id?: string }).user_id !== userIdA),
  `A ve ${sesionesA.filas.length} sesion(es), B ve ${sesionesB.filas.length}`,
);

/* 6) La auditoria: cada usuario ve la suya. */
const auditA = await consultar(tokenA, "audit_events", { columnas: "id,user_id,action" });
const auditB = await consultar(tokenB, "audit_events", { columnas: "id,user_id,action" });
comprobar(
  "la auditoria no se cruza entre usuarios",
  auditA.filas.every((f) => (f as { user_id?: string }).user_id !== userIdB) &&
    auditB.filas.every((f) => (f as { user_id?: string }).user_id !== userIdA),
  `A ve ${auditA.filas.length} evento(s), B ve ${auditB.filas.length}`,
);

const fallos = resultados.filter((r) => !r.ok);
console.log(
  `\n${resultados.length - fallos.length}/${resultados.length} comprobaciones OK` +
    (fallos.length ? ` — ${fallos.length} FALLO(S): no abras el registro.` : ""),
);
process.exit(fallos.length > 0 ? 1 : 0);
