// Funciones de servidor: las listas REALES de monedas y pools para el alta
// de equipos de mineria.
import { createServerFn } from "@tanstack/react-start";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

/**
 * Opciones para dar de alta un equipo: las monedas minables (leidas de los
 * pools en vivo), las monedas del mercado y los pools que existen.
 */
export const listarOpcionesMineria = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async () => {
    const { listarMonedasMercado, listarPoolsReales, listarMonedasMinerables, nombresDeMonedas } =
      await import("./pools.server");
    const [mercado, pools, minerables, nombres] = await Promise.all([
      listarMonedasMercado(),
      listarPoolsReales(),
      listarMonedasMinerables(),
      nombresDeMonedas(),
    ]);

    return {
      /**
       * TODAS las que se pueden minar con CPU (las de los pools, leidas en
       * vivo), no solo las que estan tambien en el mercado de Binance.
       */
      minables: minerables.simbolos.map((simbolo) => ({
        simbolo,
        nombre: nombres.get(simbolo) ?? simbolo,
        pools: minerables.porPool
          ? Object.entries(minerables.porPool)
              .filter(([, monedas]) => monedas.includes(simbolo))
              .map(([pool]) => pool)
          : [],
      })),
      /** Todas las del mercado (Binance). */
      mercado: mercado.map((m) => ({
        simbolo: m.simbolo,
        nombre: m.nombre,
        minable: m.minable,
        pools: m.pools,
      })),
      /** Los pools, con las monedas que ofrecen (si se han podido leer). */
      pools: pools.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        url: p.url,
        monedas: p.monedas,
        fuente: p.fuente,
        enVivo: p.enVivo,
      })),
    };
  });
