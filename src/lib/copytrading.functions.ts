// Funciones de servidor del sandbox de copy trading (traders reales).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Mide el copy trading de traders REALES sobre datos reales: velas de futuros
 * de Binance, posicionamiento de las cuentas con las posiciones mas grandes y
 * flujo agresivo de ordenes. Se compara con la referencia aleatoria y con
 * comprar y mantener.
 */
export const medirCopyTrading = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ simbolo: z.string().min(3).max(20) }).parse(input))
  .handler(async ({ data }) => {
    const { medirCopyTrading: medir } = await import("./copytrading.server");
    return await medir(data.simbolo, 700);
  });
