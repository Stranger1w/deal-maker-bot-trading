// Funciones de servidor del historico real (precios de mercado y curvas de
// los bots). Solo lectura de Binance + escritura en las tablas de historico.
import { createServerFn } from "@tanstack/react-start";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Reconstruye los historicos con datos REALES:
 *  - precios de mercado: cierres diarios de Binance,
 *  - curvas de los bots: sus ejecuciones de verdad.
 *
 * Es lo que hay que ejecutar cuando se limpian datos de ejemplo antiguos.
 */ export const actualizarHistoricoReal = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async ({ context }) => {
    const db = await admin();
    const { actualizarPreciosMercado, reconstruirHistorialBots } =
      await import("./historial.server");

    // Los pares que usan los bots del dueno (y los que ya estan guardados).
    const { data: bots } = await db.from("bots").select("pair").eq("user_id", context.userId);
    const pares = [...new Set((bots ?? []).map((b) => String(b.pair).toUpperCase()))];
    const { data: guardados } = await db.from("market_prices").select("symbol").limit(50);
    for (const g of guardados ?? []) {
      const s = String(g.symbol).toUpperCase();
      if (!pares.includes(s)) pares.push(s);
    }
    if (!pares.includes("BTCUSDT")) pares.push("BTCUSDT");

    const precios = await actualizarPreciosMercado(db, pares, 400);
    const bots_ = await reconstruirHistorialBots(db, context.userId);
    return {
      precios,
      bots: bots_,
      mensaje:
        `Historico real: ${precios.filas} precios de Binance y ${bots_.puntos} puntos de curva ` +
        `de los ${bots_.bots} bots que han operado de verdad.`,
    };
  });
