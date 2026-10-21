/**
 * CAMBIAR EL ENTORNO DE TRADING (testnet <-> produccion).
 *
 * QUE ES
 * El entorno decide DONDE se mandan las ordenes:
 *   - testnet: dinero de prueba (Binance testnet). Es el de ahora.
 *   - produccion: dinero real. Cada orden es una orden de verdad.
 *
 * POR QUE ESTA PROTEGIDO
 * Cambiar el entorno no es un interruptor cualquiera: cambia donde acaba tu
 * dinero. Por eso pide: ser administrador, 2FA verificada, el aviso de
 * riesgo accepted, escribir la palabra de confirmacion y que la clave
 * guardada funcione en el entorno de destino.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  details: Record<string, unknown>,
  actor = "operator",
  userId: string | null = null,
) {
  const db = await admin();
  await db.from("audit_events").insert({
    action,
    entity,
    entity_id: entityId,
    details: details as never,
    actor,
    user_id: userId,
  } as never);
}

/** 2FA verificada en ESTA sesion (como en promover un bot a Real). */
function assertTwoFactor(claims: Record<string, unknown>) {
  if (claims["aal"] !== "aal2") {
    throw new Error(
      "Se requiere verificacion 2FA (TOTP) en la sesion actual. Configura y verifica tu segundo factor en Acceso y seguridad.",
    );
  }
}

/** Comprueba (solo lectura) que la clave funciona en el entorno indicado. */
async function probarClave(
  apiKey: string,
  apiSecret: string,
  entorno: "testnet" | "production",
): Promise<{ ok: boolean; motivo: string }> {
  const { signBinanceQuery } = await import("./crypto.server");
  const { BINANCE_HOSTS } = await import("./binance-trading.server");
  const query = `recvWindow=5000&timestamp=${Date.now()}`;
  try {
    const signature = await signBinanceQuery(query, apiSecret);
    const res = await fetch(
      `${BINANCE_HOSTS[entorno]}/api/v3/account?${query}&signature=${signature}`,
      {
        headers: { "X-MBX-APIKEY": apiKey },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (res.ok) return { ok: true, motivo: "" };
    const raw = await res.text().catch(() => "");
    let detalle = raw.replace(/\s+/g, " ").slice(0, 160);
    try {
      const parsed = JSON.parse(raw) as { msg?: string };
      if (parsed.msg) detalle = parsed.msg;
    } catch {
      // Cuerpo no JSON.
    }
    return { ok: false, motivo: detalle };
  } catch (error) {
    return {
      ok: false,
      motivo: error instanceof Error ? error.message : "error desconocido",
    };
  }
}

export const leerEntornoTrading = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async () => {
    const { resolveBinanceTradingEnv } = await import("./binance-trading.server");
    const { leerAjustesPlataforma } = await import("./propietario.server");
    const db = await admin();
    const env = await resolveBinanceTradingEnv();
    const fila = (await leerAjustesPlataforma(db))?.fila ?? null;
    return {
      env,
      tradingRealPermitido: fila?.allow_real_trading === true,
      ordenesRealesPermitidos: fila?.allow_live_orders === true,
    };
  });

export const cambiarEntornoTrading = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) =>
    z
      .object({
        entorno: z.enum(["testnet", "production"]),
        /** Hay que escribir PRODUCCION para cambiar a produccion. */
        confirmacion: z.string().max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    assertTwoFactor(context.claims as unknown as Record<string, unknown>);
    const db = await admin();

    // El aviso de riesgo (el mismo que para promover un bot a Real).
    const { avisoAceptado } = await import("./aviso-riesgo.server");
    if (!(await avisoAceptado(db, context.userId))) {
      throw new Error(
        "Antes de tocar el entorno de trading tienes que leer y aceptar el aviso de riesgo (puedes perder todo el capital).",
      );
    }

    if (data.entorno === "production" && data.confirmacion.trim().toUpperCase() !== "PRODUCCION") {
      throw new Error(
        "Para pasar a PRODUCCION hay que escribir PRODUCCION (en mayusculas) en la confirmacion.",
      );
    }

    // La clave guardada tiene que funcionar en el entorno de destino: con una
    // clave de testnet, en produccion Binance la rechaza.
    const { decryptSecret } = await import("./crypto.server");
    const { data: admins } = await db.from("app_admins").select("user_id").limit(1);
    const { data: filas } = await db
      .from("binance_credentials")
      .select("api_key_cipher,api_secret_cipher")
      .eq("user_id", admins?.[0]?.user_id ?? context.userId)
      .limit(1);
    const fila = (filas ?? [])[0];
    if (!fila) throw new Error("No hay credenciales de Binance guardadas.");
    const apiKey = await decryptSecret(fila.api_key_cipher);
    const apiSecret = await decryptSecret(fila.api_secret_cipher);
    const prueba = await probarClave(apiKey, apiSecret, data.entorno);
    if (!prueba.ok) {
      throw new Error(
        `La clave guardada no funciona en ${data.entorno}: ${prueba.motivo}. ` +
          "Guarda primero una API key de PRODUCCION (con el permiso de futuros si quieres usar la cobertura) en la pagina de Binance. " +
          "En 'Cuentas de trading > Credenciales' tienes el boton 'Diagnostico: testnet o produccion?': te dice de que entorno es la clave que has pegado.",
      );
    }

    const { error } = await db
      .from("app_settings")
      .update({ value: data.entorno, updated_at: new Date().toISOString() })
      .eq("key", "binance_trading_env");
    if (error) throw new Error(error.message);

    await audit(
      "security.entorno_trading",
      "app_settings",
      "binance_trading_env",
      { entorno: data.entorno, two_factor: "aal2_verified" },
      "operator",
      context.userId,
    );

    const { raiseAlert } = await import("./alerts.server");
    await raiseAlert(db, {
      category: "security",
      severity: "warning",
      title: `Entorno de trading cambiado a ${data.entorno}`,
      message:
        data.entorno === "production"
          ? "Las ordenes van a PRODUCION: dinero real. Revisa que los bots promotionados siguen siendo los que quieres."
          : "Las ordenes van a testnet: dinero de prueba.",
      entity: "app_settings",
      entityId: "binance_trading_env",
      userId: context.userId,
    });

    return { ok: true, entorno: data.entorno };
  });
