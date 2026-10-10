// Propiedad por fila para las server functions de nivel "usuario".
//
// Se consulta con el cliente del PROPIO usuario (context.supabase, el que crea
// requireSupabaseAuth con su token): las politicas RLS de la base devuelven solo
// sus filas, o todas si es admin (is_app_admin()). Si la fila no es visible, la
// funcion corta con "no encontrado" antes de escribir nada con service_role.
//
// Los tipos generados (types.ts) aun no incluyen la columna user_id, por eso las
// filas se devuelven con user_id opcional.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type ClienteSupabase = SupabaseClient<Database>;

type Tablas = Database["public"]["Tables"];

export type BotPropio = Tablas["bots"]["Row"] & { user_id?: string | null };
export type SandboxPropio = Tablas["training_sandboxes"]["Row"] & { user_id?: string | null };
export type RunPropio = Tablas["training_runs"]["Row"];

/** Bot visible para quien llama (propio, o cualquiera si es admin). */
export async function exigirBotPropio(
  supabase: ClienteSupabase,
  botId: string,
): Promise<BotPropio> {
  const { data, error } = await supabase.from("bots").select("*").eq("id", botId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Bot no encontrado");
  return data as BotPropio;
}

/** Sandbox de entrenamiento visible para quien llama. */
export async function exigirSandboxPropio(
  supabase: ClienteSupabase,
  sandboxId: string,
): Promise<SandboxPropio> {
  const { data, error } = await supabase
    .from("training_sandboxes")
    .select("*")
    .eq("id", sandboxId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Sandbox no encontrado");
  return data as SandboxPropio;
}

/** Resultado de entrenamiento visible para quien llama (hereda el dueno del sandbox). */
export async function exigirRunPropio(
  supabase: ClienteSupabase,
  runId: string,
): Promise<RunPropio> {
  const { data, error } = await supabase
    .from("training_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Resultado no encontrado");
  return data as RunPropio;
}
