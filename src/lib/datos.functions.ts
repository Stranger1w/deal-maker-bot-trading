// Funciones de servidor de los datos de mercado: cache local, plataformas y
// comparacion entre exchanges.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Estado de los datos: que hay en la cache local y como ven las distintas
 * plataformas el MISMO par (util para detectar manipulacion: si los precios
 * no cuadran, algo raro pasa).
 */
export const estadoDatosMercado = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z.object({ simbolo: z.string().min(3).max(20).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const db = await admin();
    const { estadoCache } = await import("./cache-mercado.server");
    const cache = await estadoCache(db);

    const simbolo = (data.simbolo ?? "BTCUSDT").toUpperCase();
    const { compararPlataformas, PLATAFORMAS } = await import("./plataformas.server");
    const comparativa = await compararPlataformas(simbolo, "1h", 100);

    return {
      cache,
      comparativa,
      plataformas: PLATAFORMAS.map((p) => ({
        id: p.id,
        nombre: p.nombre,
        mercado: p.mercado,
        tieneTraders: p.tieneTraders,
      })),
      simbolo,
    };
  });

/**
 * Rellena (o refresca) la cache local con los datos de las plataformas, para
 * no tener que volver a medir cada vez.
 */
export const actualizarDatosMercado = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { velasConCache, guardarTradersCache, estadoCache } =
      await import("./cache-mercado.server");
    const { obtenerSeriesTraders } = await import("./traders.server");

    // Los pares de los bots del dueno.
    const { data: bots } = await db.from("bots").select("pair").eq("user_id", context.userId);
    const pares = [...new Set((bots ?? []).map((b) => String(b.pair).toUpperCase()))];
    if (!pares.includes("BTCUSDT")) pares.push("BTCUSDT");

    let velas = 0;
    const origenes: string[] = [];
    for (const par of pares.slice(0, 6)) {
      const cache = await velasConCache(db, par, "1h", 1000, {
        mercado: "futuros",
        refrescar: true,
      });
      velas += cache.velas.length;
      if (cache.plataformas.length) origenes.push(`${par}: ${cache.plataformas.join(", ")}`);

      // Los datos de traders (solo Binance Futures los publica).
      const series = await obtenerSeriesTraders(par, "1h", 1000);
      await guardarTradersCache(db, par, "top_long_short", "1h", series.top, "Binance Futures");
      await guardarTradersCache(db, par, "taker_buy_sell", "1h", series.taker, "Binance Futures");
    }

    const estado = await estadoCache(db);
    return {
      velas,
      origenes,
      cache: estado,
      mensaje:
        `Cache local: ${estado.velas} velas y ${estado.traders} lecturas de traders ` +
        `(${pares.slice(0, 6).join(", ")}). A partir de ahora el sandbox mide sin volver a descargar.`,
    };
  });
