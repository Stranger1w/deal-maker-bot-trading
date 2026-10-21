/**
 * SALDO REAL DE BINANCE.
 *
 * QUE PROBLEMA RESUELVE
 * La pagina de Fondos es una TESORERIA INTERNA: una libreta donde se
 * anotan los depositos y los retiros que tu registras. Esa libreta NO es tu
 * dinero real: el dinero real esta en tu cuenta de Binance, y se ve en la
 * web de Binance (o aqui, con esta funcion).
 *
 * Antes, la appotenia un "Retiro" que solo anotaba en la libreta y se
 * descontaba un saldo que no era el de Binance: daba la sensacion de que la
 * app movia el dinero. No lo mueve: las retiradas se hacen desde Binance
 * (y por eso la API key no necesita el permiso de retiros).
 *
 * QUE HACE
 * Consulta la cuenta REAL de Binance (solo lectura) en el entorno activo:
 *   - Spot:    /api/v3/account   -> saldos libres y bloqueados por activo.
 *   - Futuros: /fapi/v2/balance  -> saldo de la cartera y PnL abierto.
 * Convierte a USDT con los precios de Binance en ese momento.
 *
 * Si la clave no vale en el entorno activo (p.ej. es de testnet y el
 * entorno es produccion), lo dice con el error de Binance: no inventa
 * saldos ni los redondea a cero sin avisar.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin } from "@/integrations/supabase/admin-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type SaldoBinance = {
  entorno: string;
  ok: boolean;
  error: string | null;
  /** Spot: saldos por activo. */
  spot: {
    activo: string;
    libre: number;
    bloqueado: number;
    precio: number | null;
    valor: number | null;
  }[];
  /** Futuros: cartera y PnL abierto por activo. */
  futuros: { activo: string; cartera: number; pnlAbierto: number }[];
  /** Valor total estimado en USDT (spot + futuros + PnL abierto). */
  totalUsdt: number;
  /** true si la clave responde pero sin permiso de futuros. */
  futurosSinPermiso: boolean;
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Precio en USDT de un activo con los tickers de Binance. */
function precioEnUsdt(activo: string, tickers: Map<string, number>): number | null {
  const a = activo.toUpperCase();
  if (
    a === "USDT" ||
    a === "USDC" ||
    a === "BUSD" ||
    a === "FDUSD" ||
    a === "TUSD" ||
    a === "DAI"
  ) {
    return 1;
  }
  for (const quote of ["USDT", "USDC", "BUSD"] as const) {
    const p = tickers.get(`${a}${quote}`);
    if (p && Number.isFinite(p) && p > 0) return p;
  }
  return null;
}

export const saldoRealBinance = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<SaldoBinance> => {
    const db = await admin();
    const { resolveBinanceTradingEnv, BINANCE_HOSTS } = await import("./binance-trading.server");
    const { BINANCE_FUTUROS_HOSTS } = await import("./binance-futuros.server");
    const { decryptSecret } = await import("./crypto.server");

    const env = await resolveBinanceTradingEnv();
    const vacio: SaldoBinance = {
      entorno: env,
      ok: false,
      error: null,
      spot: [],
      futuros: [],
      totalUsdt: 0,
      futurosSinPermiso: false,
    };

    const { data: filas } = await db
      .from("binance_credentials")
      .select("api_key_cipher,api_secret_cipher")
      .eq("user_id", context.userId)
      .limit(1);
    const fila = (filas ?? [])[0];
    if (!fila) return { ...vacio, error: "No hay credenciales de Binance guardadas." };

    const apiKey = await decryptSecret(fila.api_key_cipher as string);
    const apiSecret = await decryptSecret(fila.api_secret_cipher as string);
    const { signBinanceQuery } = await import("./crypto.server");

    const firmado = async (host: string, path: string) => {
      const query = `recvWindow=5000&timestamp=${Date.now()}`;
      const signature = await signBinanceQuery(query, apiSecret);
      const res = await fetch(`${host}${path}?${query}&signature=${signature}`, {
        headers: { "X-MBX-APIKEY": apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await res.text().catch(() => "");
      let msg = raw.replace(/\s+/g, " ").slice(0, 200);
      try {
        const j = JSON.parse(raw) as { msg?: string };
        if (j.msg) msg = j.msg;
      } catch {
        /* no json */
      }
      return { ok: res.ok, status: res.status, msg, body: raw };
    };

    // ── Spot ────────────────────────────────────────────────────────────────
    const cuenta = await firmado(BINANCE_HOSTS[env], "/api/v3/account");
    if (!cuenta.ok) {
      return {
        ...vacio,
        error:
          `La clave guardada no responde en ${env} (HTTP ${cuenta.status}): ${cuenta.msg}. ` +
          "Si es una clave de testnet, en la pagina 'Cuentas de trading' hay un diagnostico que te dice de que entorno es.",
      };
    }

    type BodySpot = { balances?: { asset?: string; free?: string; locked?: string }[] };
    const bodySpot = JSON.parse(cuenta.body) as BodySpot;

    // Precios en USDT (publico, sin credenciales).
    const tickers = new Map<string, number>();
    try {
      const res = await fetch(`${BINANCE_HOSTS[env]}/api/v3/ticker/price`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const lista = (await res.json()) as { symbol?: string; price?: string }[];
        for (const t of lista) {
          if (t.symbol && t.price) tickers.set(t.symbol, Number(t.price));
        }
      }
    } catch {
      /* sin precios: se muestran cantidades, sin valor */
    }

    const spot: SaldoBinance["spot"] = [];
    for (const b of bodySpot.balances ?? []) {
      const activo = (b.asset ?? "").toUpperCase();
      if (!activo) continue;
      const libre = num(b.free);
      const bloqueado = num(b.locked);
      if (libre <= 0 && bloqueado <= 0) continue;
      const precio = precioEnUsdt(activo, tickers);
      const valor = precio === null ? null : (libre + bloqueado) * precio;
      spot.push({ activo, libre, bloqueado, precio, valor });
    }
    spot.sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));

    // ── Futuros ─────────────────────────────────────────────────────────────
    const futuros: SaldoBinance["futuros"] = [];
    let futurosSinPermiso = false;
    try {
      const cuentaFut = await firmado(BINANCE_FUTUROS_HOSTS[env], "/fapi/v2/balance");
      if (cuentaFut.ok) {
        type BodyFut = {
          assets?: { asset?: string; walletBalance?: string; unrealizedProfit?: string }[];
        };
        const bodyFut = JSON.parse(cuentaFut.body) as BodyFut;
        for (const a of bodyFut.assets ?? []) {
          const activo = (a.asset ?? "").toUpperCase();
          if (!activo) continue;
          const cartera = num(a.walletBalance);
          const pnl = num(a.unrealizedProfit);
          if (cartera === 0 && pnl === 0) continue;
          futuros.push({ activo, cartera, pnlAbierto: pnl });
        }
      } else {
        futurosSinPermiso = true;
      }
    } catch {
      futurosSinPermiso = true;
    }

    const totalSpot = spot.reduce((acc, s) => acc + (s.valor ?? 0), 0);
    const totalFuturos = futuros.reduce((acc, f) => acc + f.cartera + f.pnlAbierto, 0);

    return {
      entorno: env,
      ok: true,
      error: null,
      spot,
      futuros,
      totalUsdt: Number((totalSpot + totalFuturos).toFixed(2)),
      futurosSinPermiso,
    };
  });
