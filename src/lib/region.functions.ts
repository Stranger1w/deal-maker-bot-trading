import { createServerFn } from "@tanstack/react-start";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

/** Comprueba y registra la ubicación efectiva del backend. No expone secretos. */
export const checkBackendRegion = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { probeRegion } = await import("./region.server");
    return probeRegion();
  });
