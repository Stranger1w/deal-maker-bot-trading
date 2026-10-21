// Configuracion por equipo de mineria: comision del pool, potencia y los
// datos de la red (para las monedas sin API publica).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import type { Json } from "@/integrations/supabase/types";

/**
 * Guarda la configuracion real de un equipo:
 *  - la comision que se lleva su pool (0,5 % es lo habitual),
 *  - la potencia que consume (watts),
 *  - y los datos de la red, si los has copiado de la web del pool.
 */
export const guardarConfigMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        workerId: z.string().uuid(),
        poolFeePct: z.number().min(0).max(50).optional(),
        powerWatts: z.number().min(0).max(5000).optional(),
        networkHashRate: z.number().nonnegative().optional(),
        networkReward: z.number().nonnegative().optional(),
        networkBlockSeconds: z.number().positive().optional(),
        networkSource: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Comprobar que el equipo es del dueno.
    const { data: worker } = await supabaseAdmin
      .from("mining_workers")
      .select("id")
      .eq("id", data.workerId)
      .eq("user_id", context.userId)
      .limit(1);
    if (!worker || worker.length === 0) throw new Error("Ese equipo no es tuyo.");

    const patch: {
      updated_at: string;
      pool_fee_pct?: number;
      power_watts?: number;
      network_config?: Json;
    } = { updated_at: new Date().toISOString() };
    if (data.poolFeePct !== undefined) patch.pool_fee_pct = data.poolFeePct;
    if (data.powerWatts !== undefined) patch.power_watts = data.powerWatts;

    // Los datos de red del pool, si los hay.
    if (
      data.networkHashRate !== undefined ||
      data.networkReward !== undefined ||
      data.networkBlockSeconds !== undefined
    ) {
      const { data: actual } = await supabaseAdmin
        .from("mining_workers")
        .select("network_config")
        .eq("id", data.workerId)
        .limit(1);
      const previo = ((actual ?? [])[0]?.network_config ?? {}) as Record<string, unknown>;
      const num = (v: unknown, porDefecto: number) =>
        typeof v === "number" && Number.isFinite(v) ? v : porDefecto;
      patch.network_config = {
        ...previo,
        hashRateRed: num(data.networkHashRate ?? previo["hashRateRed"], 0),
        recompensaBloque: num(data.networkReward ?? previo["recompensaBloque"], 0),
        tiempoBloqueSegundos: num(data.networkBlockSeconds ?? previo["tiempoBloqueSegundos"], 0),
        fuente: String(data.networkSource ?? previo["fuente"] ?? "introducido a mano"),
        fecha: new Date().toISOString().slice(0, 10),
      } as Json;
    }

    const { error } = await supabaseAdmin
      .from("mining_workers")
      .update(patch)
      .eq("id", data.workerId)
      .eq("user_id", context.userId);
    if (error) {
      if (/42703|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) {
        throw new Error(
          "Falta la migracion 20261026000000_mineria_real.sql (columnas pool_fee_pct y power_watts): aplicala en el SQL Editor de Supabase.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });
