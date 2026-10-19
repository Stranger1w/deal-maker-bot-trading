/**
 * Server function del panel de metricas honestas.
 *
 * Solo el administrador de la plataforma: el informe agrega el escuadron
 * entero (los bots de todos los usuarios), que es una decision del dueno
 * (no se cobra nada y cada uno opera con sus claves, pero el dueno ve el
 * conjunto).
 */

import { createServerFn } from "@tanstack/react-start";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

export const informeMetricasMotor = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { informeMetricas } = await import("./metricas.server");
    return informeMetricas(supabaseAdmin, {});
  });
