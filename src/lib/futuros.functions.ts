// Comprobar si la clave guardada puede operar en FUTUROS (lo necesita el bot
// de cobertura: comprar el spot y vender el perpetuo).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

export const comprobarPermisoFuturos = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("./crypto.server");
    const { tienePermisoFuturos } = await import("./binance-futuros.server");
    const { resolveBinanceTradingEnv } = await import("./binance-trading.server");

    // La clave es la del administrador de la plataforma.
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
    const env = await resolveBinanceTradingEnv();

    const resultado = await tienePermisoFuturos({ env, apiKey, apiSecret });
    return {
      ok: resultado.ok,
      motivo: resultado.motivo,
      env,
      // En DEMO la cobertura es en papel (no se envian ordenes reales), asi que
      // este permiso solo hace falta para operar con dinero de verdad.
      notaDemo:
        env === "testnet"
          ? "Ahora mismo estas en DEMO (testnet): la cobertura se simula con los precios reales y no necesita este permiso. Solo hace falta cuando pases a PRODUCCION (dinero real)."
          : null,
      // Los pasos exactos, para que no haya que buscarlos.
      pasos: [
        "En Binance: Mi perfil > Gestionar API keys (https://www.binance.com/en/my/settings/api-management).",
        "Edita tu API key y activa el permiso «Enable Futures» (Permitir futuros).",
        "Guarda los cambios (Binance puede pedirte confirmar con 2FA).",
        "Vuelve aqui y pulsa «Comprobar de nuevo»: tiene que salir «listo».",
        "Aviso: si tu clave tiene la IP restringida, añade tambien la IP de salida del servidor (la muestra la app en «Ubicación del backend»).",
      ],
    };
  });
