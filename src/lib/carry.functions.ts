// El informe del carry (cuotas de financiacion reales de Binance).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * El carry de un par: cuanto se ha ganado (o perdido) Cubriendo el spot con
 * el perpetuo, con los datos REALES de Binance (cuotas de financiacion y
 * precios de spot y futuros).
 */
export const informeCarry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ simbolo: z.string().max(20).default("BTCUSDT") }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { informeCarry: medir } = await import("./carry-datos.server");
    const informe = await medir(data.simbolo.toUpperCase());
    return informe;
  });

/**
 * Marca un bot como de COBERTURA (carry) o lo vuelve a direccional.
 *
 * Un bot de cobertura no sigue la senal de los indicadores: compra el spot y
 * vende el perpetuo para cobrar la financiacion. No depende de la direccion
 * del precio, que es lo unico que ha dado positivo todos los anos.
 */
export const configurarModoCobertura = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        cobertura: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // El bot TIENE que ser del dueno (comprobar la fila, no solo el id).
    const { exigirBotPropio } = await import("./ownership.server");
    await exigirBotPropio(context.supabase, data.botId);
    const { data: bot } = await supabaseAdmin
      .from("bots")
      .select("id,name")
      .eq("id", data.botId)
      .limit(1);
    if (!bot || bot.length === 0) throw new Error("Ese bot no existe.");

    const { error } = await supabaseAdmin
      .from("bots")
      .update({
        modo_operacion: data.cobertura ? "cobertura" : "direccional",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.botId);
    if (error) {
      if (/42703|does not exist|could not find/i.test(`${error.code ?? ""} ${error.message}`)) {
        throw new Error(
          "Falta la migracion 20261030000000_bots_cobertura.sql (columna modo_operacion): aplicala en el SQL Editor de Supabase.",
        );
      }
      throw new Error(error.message);
    }
    await supabaseAdmin.from("bot_logs").insert({
      bot_id: data.botId,
      level: "info",
      message: data.cobertura
        ? "Bot marcado como COBERTURA (carry): comprara el spot y vendra el perpetuo."
        : "Bot vuelto a direccional: sigue la senal de los indicadores.",
      created_at: new Date().toISOString(),
    } as never);
    return { ok: true, cobertura: data.cobertura };
  });
