import { createServerFn } from "@tanstack/react-start";

/** Comprueba y registra la ubicación efectiva del backend. No expone secretos. */
export const checkBackendRegion = createServerFn({ method: "POST" }).handler(async () => {
  const { probeRegion } = await import("./region.server");
  return probeRegion();
});
