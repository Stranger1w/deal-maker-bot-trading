// Configuracion por equipo de mineria: comision del pool, potencia y los
// datos de la red (para las monedas sin API publica).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

/**
 * Guarda la configuracion real de un equipo:
 *  - la comision que se lleva su pool (0,5 % es lo habitual),
 *  - la potencia que consume (watts),
 *  - y los datos de la red, si los has copiado de la web del pool.
 *
 * Se guarda en DOS pasos a proposito: los datos de red y la potencia existen
 * desde la migracion 20261026000000, pero la comision del pool necesita la
 * 20261028000000. Si esa no esta aplicada, los datos de red (que son los que
 * necesitas para minar KAS) se guardan igual y solo se avisa de la comision.
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
      power_watts?: number;
      network_config?: Json;
    } = { updated_at: new Date().toISOString() };
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

    if (Object.keys(patch).length > 1) {
      const { error } = await supabaseAdmin
        .from("mining_workers")
        .update(patch)
        .eq("id", data.workerId)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
    }

    // La comision del pool: necesita la migracion 20261028000000. Si no esta,
    // lo que hay guardado (potencia y datos de red) ya esta a salvo.
    let aviso: string | null = null;
    if (data.poolFeePct !== undefined) {
      const { error } = await supabaseAdmin
        .from("mining_workers")
        .update({ pool_fee_pct: data.poolFeePct })
        .eq("id", data.workerId)
        .eq("user_id", context.userId);
      if (error) {
        // La columna no existe todavia. El error de PostgREST es PGRST204
        // ("Could not find the ... column ... in the schema cache"); el 42703
        // es el de Postgres. Los dos son "falta la migracion".
        const texto = `${error.code ?? ""} ${error.message ?? ""}`;
        if (/PGRST204|42703|does not exist|could not find the/i.test(texto)) {
          aviso =
            "Se guardo todo menos la comision del pool: falta la migracion 20261028000000_mineria_comision_pool.sql (aplicala en el SQL Editor de Supabase).";
        } else {
          throw new Error(error.message);
        }
      }
    }

    return { ok: true, ...(aviso ? { aviso } : {}) };
  });

/**
 * BORRAR UN EQUIPO DE MINERIA.
 *
 * La tarjeta de alta decia "borra alguno para anadir otro" pero no habia
 * ninguna forma de borrarlo: habia que vaciar la base a mano. Ahora existe.
 * Solo se borra un equipo del propio usuario (se comprueba el dueno).
 */
export const deleteMiningWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ workerId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: worker } = await supabaseAdmin
      .from("mining_workers")
      .select("id,name")
      .eq("id", data.workerId)
      .eq("user_id", context.userId)
      .limit(1);
    if (!worker || worker.length === 0) throw new Error("Ese equipo no es tuyo.");

    const { error } = await supabaseAdmin
      .from("mining_workers")
      .delete()
      .eq("id", data.workerId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_events").insert({
      action: "mining.worker_deleted",
      entity: "mining_worker",
      entity_id: data.workerId,
      details: { name: worker[0]?.name ?? "" },
      actor: "operator",
      user_id: context.userId,
    } as never);

    return { ok: true };
  });
