/**
 * LOS METODOS DE PAGO REALES DE BINANCE (PayPal, Google Pay, tarjeta...).
 *
 * QUE ES
 * Binance tiene, para cada moneda fiat, una lista REAL de metodos de pago
 * (PayPal, Google Pay, tarjeta de credito, transferencia bancaria, P2P...).
 * La lista cambia segun el pais, la moneda y el momento: por eso se lee de la
 * API de Binance y no se inventa.
 *
 * LA API
 *   GET /sapi/v1/capital/config/getall  (con la API key)
 *   Solo existe en PRODUCCION: con una clave de testnet devuelve un error
 *   (por eso la app lo avisa en vez de mostrar una lista inventada).
 *
 * PARA QUE SIRVE
 * El "deposito" de la app es un apunte (tu dinero entra por la via que tu
 * elijas en Binance). Con esta lista, la app te dice EXACTAMENTE con que
 * metodos puedes pagar y por cuanto minimo, para que el apunte coincida con
 * la realidad.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

export type MetodoPago = {
  /** El nombre que da Binance ("PayPal", "Google Pay", "Credit Card"...). */
  nombre: string;
  /** La moneda fiat en la que se puede pagar (EUR, USD, GBP...). */
  moneda: string;
  /** El importe minimo (en la moneda fiat). */
  minimo: number | null;
  /** El importe maximo (en la moneda fiat). */
  maximo: number | null;
  /** Si Binance da instrucciones o enlace para ese metodo. */
  instrucciones: string | null;
};

export const listarMetodosPago = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret, signBinanceQuery } = await import("./crypto.server");

    const { data: admins } = await supabaseAdmin.from("app_admins").select("user_id").limit(1);
    const userId = admins?.[0]?.user_id;
    if (!userId) throw new Error("No hay administrador de plataforma.");
    const { data: filas } = await supabaseAdmin
      .from("binance_credentials")
      .select("api_key_cipher,api_secret_cipher")
      .eq("user_id", userId)
      .limit(1);
    const fila = (filas ?? [])[0];
    if (!fila) throw new Error("No hay credenciales de Binance guardadas.");

    const apiKey = await decryptSecret(fila.api_key_cipher);
    const apiSecret = await decryptSecret(fila.api_secret_cipher);

    const query = `recvWindow=5000&timestamp=${Date.now()}`;
    const signature = await signBinanceQuery(query, apiSecret);
    const res = await fetch(
      `https://api.binance.com/sapi/v1/capital/config/getall?${query}&signature=${signature}`,
      { headers: { "X-MBX-APIKEY": apiKey }, signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let detalle = raw.replace(/\s+/g, " ").slice(0, 200);
      try {
        const parsed = JSON.parse(raw) as { msg?: string };
        if (parsed.msg) detalle = parsed.msg;
      } catch {
        // Cuerpo no JSON.
      }
      return {
        ok: false as const,
        metodos: [] as MetodoPago[],
        aviso:
          `Binance no devuelve los metodos de pago con esta clave (${detalle}). ` +
          "Es normal si la clave es de testnet: la lista real (PayPal, Google Pay, tarjeta...) solo se puede leer con una clave de PRODUCCION.",
      };
    }

    const datos = (await res.json()) as Array<{
      coin?: string;
      depositAll?: boolean;
      free?: number;
      networks?: unknown[];
      depositMethods?: Array<{
        method?: string;
        min?: number | string;
        max?: number | string;
        comment?: string;
        paypalUrl?: string;
      }>;
    }>;

    const metodos: MetodoPago[] = [];
    for (const moneda of datos ?? []) {
      for (const m of moneda.depositMethods ?? []) {
        const nombre = (m.method ?? "").trim();
        if (!nombre) continue;
        const minimo = Number(m.min ?? 0);
        const maximo = Number(m.max ?? 0);
        metodos.push({
          nombre,
          moneda: moneda.coin ?? "",
          minimo: Number.isFinite(minimo) && minimo > 0 ? minimo : null,
          maximo: Number.isFinite(maximo) && maximo > 0 ? maximo : null,
          instrucciones: m.comment ?? m.paypalUrl ?? null,
        });
      }
    }
    // Los mas usados primero (los de pago electronico), luego los demas.
    const prioridad = (m: MetodoPago) =>
      /paypal|google|card|credit|apple/i.test(m.nombre) ? 0 : 1;
    metodos.sort((a, b) => prioridad(a) - prioridad(b) || a.nombre.localeCompare(b.nombre));

    return { ok: true as const, metodos, aviso: null };
  });
