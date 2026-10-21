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
