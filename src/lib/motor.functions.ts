/**
 * Server fn del diario del motor: los ultimos ciclos y que hizo cada bot.
 * Solo el administrador: el motor es global.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import type { DecisionMotor } from "./motor-decisiones";

export type CicloMotor = {
  id: string;
  started_at: string | null;
  finished_at: string | null;
  trigger: string;
  status: string | null;
  bots_processed: number;
  orders_created: number;
  errors: number;
  duration_ms: number | null;
  notes: string | null;
  decisions: DecisionMotor[];
};

/**
 * Ultimos ciclos del motor con las decisiones por bot.
 * Si la tabla engine_cycles aun no existe (migracion sin aplicar), devuelve
 * una lista vacia en vez de fallar.
 */
export const listarCiclosMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: filas, error } = await supabaseAdmin
      .from("engine_cycles" as never)
      .select(
        "id, started_at, finished_at, trigger, status, bots_processed, orders_created, errors, duration_ms, notes, decisions",
      )
      .order("finished_at", { ascending: false })
      .limit(data.limit);
    if (error) return { ciclos: [] as CicloMotor[] };
    return {
      ciclos: ((filas ?? []) as unknown as CicloMotor[]).map((c) => ({
        ...c,
        decisions: Array.isArray(c.decisions) ? c.decisions : [],
      })),
    };
  });
