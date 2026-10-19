// Identidad de la plataforma y filas "una por usuario" (Fase 3 · parte 1).
//
// Server-only: se opera con supabaseAdmin (service_role).
//
// POR QUE EXISTE ESTE MODULO
// La plataforma es multiusuario y casi todas las tablas de configuracion
// (automation_settings, engine_config, binance_credentials, fund_accounts)
// tienen UNA fila por usuario (unicidad por user_id desde la Fase 2).
//
// El codigo las leia con .limit(1) + service_role: eso devuelve una fila
// ARBITRARIA, que con mas de un usuario es la de otro. Peor: tras la
// migracion del 14-oct (user_id NOT NULL) leer y escribir asi empezo a
// romper flujos enteros (iniciar motor, alertas, reportes).
//
// Aqui se centraliza la lectura correcta: SIEMPRE por dueño.
//   - La configuracion global de la plataforma es la del ADMINISTRADOR
//     (la fila de app_admins, que es el dueno que lleva los limites
//     globales y el kill switch).
//   - Cada usuario normal tiene su propia fila y sus propios limites.
//
// Cuando solo hay UN admin (el caso normal), la fila del administrador es
// la unica fila de automation_settings, asi que el comportamiento no cambia.

import { duenoDe } from "./tick-scope";

import type { Database } from "@/integrations/supabase/types";

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Tablas = Database["public"]["Tables"];

/**
 * Fila de configuracion del motor (automation_settings) con su dueno.
 * Los tipos generados todavia no incluyen user_id en esa tabla: se anade a
 * mano hasta regenerarlos.
 */
export type FilaAjustes = Tablas["automation_settings"]["Row"] & { user_id?: string | null };

/**
 * user_id del administrador de la app (el primero de app_admins).
 * Devuelve null si la tabla no existe o esta vacia: no se inventa un dueño.
 */
export async function leerAdminId(db: Db): Promise<string | null> {
  try {
    // app_admins todavia no esta en los tipos generados: consulta sin tipar.
    const res = (await (
      db as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => {
              limit: (n: number) => {
                maybeSingle: () => PromiseLike<{
                  data: unknown;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        };
      }
    )
      .from("app_admins")
      .select("user_id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()) as { data: unknown; error: { message: string } | null };
    if (res.error) return null;
    const id = (res.data as { user_id?: unknown } | null)?.user_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/**
 * El mismo id de administrador, cacheado 60 s: lo consultan muchos caminos
 * del tick (una vez por bot detenido) y no tiene sentido repetir la consulta.
 */
let cacheAdmin: { valor: string | null; at: number } | null = null;

export async function adminIdDeLaPlataforma(db: Db): Promise<string | null> {
  const ahora = Date.now();
  if (cacheAdmin && ahora - cacheAdmin.at < 60_000) return cacheAdmin.valor;
  const valor = await leerAdminId(db);
  cacheAdmin = { valor, at: ahora };
  return valor;
}

/**
 * Fila de automation_settings de un usuario concreto.
 * Devuelve null si ese usuario todavia no tiene fila.
 */
export async function leerAjustesDeUsuario(db: Db, userId: string): Promise<FilaAjustes | null> {
  const { data, error } = await db
    .from("automation_settings")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la configuracion del motor: ${error.message}`);
  return (data as FilaAjustes | null) ?? null;
}

/**
 * Cuenta de fondos de un usuario (fund_accounts: una fila por usuario).
 * Antes se leia con .limit(1), que devolvia la cuenta de cualquiera: un
 * retiro de un usuario descontaba el saldo de la cuenta de otro.
 */
export async function leerCuentaDeUsuario(
  db: Db,
  userId: string,
): Promise<{ id: string; available_balance: number; in_use_balance: number } | null> {
  const { data, error } = await db
    .from("fund_accounts")
    .select("id, available_balance, in_use_balance")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la cuenta de fondos: ${error.message}`);
  const fila = data as { id?: string; available_balance?: number; in_use_balance?: number } | null;
  if (!fila?.id) return null;
  return {
    id: fila.id,
    available_balance: Number(fila.available_balance ?? 0),
    in_use_balance: Number(fila.in_use_balance ?? 0),
  };
}

/**
 * Configuracion global de la plataforma = fila del ADMINISTRADOR.
 *
 * Devuelve tambien el adminId (el dueño de esa fila), que es el ambito en
 * el que se miden los limites globales y el kill switch.
 *
 * Fallback: si no se puede resolver el administrador y hay EXACTAMENTE una
 * fila en automation_settings, se usa esa fila (no es ambigua) y su dueno
 * hace de admin. Con dos o mas filas y sin administrador resoluble, se
 * devuelve null: antes que operar con la configuracion de otro, el motor
 * se detiene.
 */
export async function leerAjustesPlataforma(
  db: Db,
): Promise<{ fila: FilaAjustes; adminId: string | null } | null> {
  const adminId = await adminIdDeLaPlataforma(db);
  if (adminId) {
    const fila = await leerAjustesDeUsuario(db, adminId);
    if (fila) return { fila, adminId };
  }

  // Sin fila del administrador (o sin app_admins): si hay una sola fila, es
  // la de la plataforma.
  const { data, error } = await db.from("automation_settings").select("*").limit(2);
  if (error) throw new Error(`No se pudo leer la configuracion del motor: ${error.message}`);
  const filas = (data as FilaAjustes[] | null) ?? [];
  if (filas.length !== 1) return null;
  return { fila: filas[0] as FilaAjustes, adminId: duenoDe(filas[0]) };
}
