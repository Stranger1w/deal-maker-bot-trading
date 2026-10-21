/**
 * BORRAR Y MOVER BOTS.
 *
 * POR QUE SON FUNCIONES DE SERVIDOR
 * Borrar un bot toca filas de varias tablas (logs, ejecuciones, estrategia,
 * Thunderbolt runs) y comprobar que es del dueno. Eso NO se puede hacer desde
 * el navegador: la tabla bots esta protegida por RLS y el service_role no
 * debe ir al cliente.
 *
 * MOVER (ordenar el escuadron)
 * El orden lo guarda bots.sort_order (migracion 20261029000000). Si esa
 * migracion no esta aplicada, se usa created_at y el boton avisa: es
 * preferible a que el bot desaparezca sin avisar.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Tablas que cuelgan de un bot y se borran con el. */
const TABLAS_DEPENDIENTES = [
  "bot_logs",
  "bot_executions",
  "engine_strategies",
  "training_runs",
] as const;

/**
 * Borra un bot y todo lo suyo.
 *
 * Si el bot tiene una posición abierta NO se borra: esa entrada en Binance
 * se quedaría sin nadie que le ponga el TP/SL. Primero se cierra (bot detenido
 * y posición cerrada) y luego se borra.
 */
export const eliminarBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ botId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { exigirBotPropio } = await import("./ownership.server");
    const bot = await exigirBotPropio(context.supabase, data.botId);
    const db = await admin();

    // 1) Si tiene posición abierta, no se borra.
    const { botTienePosicionAbierta } = await import("./engine-sessions.server");
    const abierta = await botTienePosicionAbierta(db, {
      id: data.botId,
      pair: bot.pair ?? "",
    });
    if (abierta) {
      throw new Error(
        "Este bot tiene una posición abierta en Binance: ciérrala primero (Detener y cerrar la posición) y luego lo borras. Si lo borraras ahora, esa entrada se quedaría sin TP/SL.",
      );
    }

    // 2) Parar el bot (que no siga operando con una fila que ya no existe).
    await db
      .from("bots")
      .update({ status: "stopped", updated_at: new Date().toISOString() })
      .eq("id", data.botId);

    // 3) Borrar lo que cuelga de el.
    for (const tabla of TABLAS_DEPENDIENTES) {
      const { error } = await db.from(tabla).delete().eq("bot_id", data.botId);
      // Si la tabla no existe o no tiene la columna, no se para nada: el
      // borrado del bot es lo importante.
      if (error && !/does not exist|PGRST/i.test(`${error.code ?? ""} ${error.message}`)) {
        throw new Error(`No se pudo limpiar ${tabla}: ${error.message}`);
      }
    }

    // 4) Borrar el bot.
    const { error } = await db.from("bots").delete().eq("id", data.botId);
    if (error) throw new Error(error.message);

    return { ok: true, nombre: bot.name ?? "" };
  });

/**
 * Mueve un bot una posicion arriba o abajo en el escuadron.
 *
 * Intercambia su sort_order con el del vecino. Si la columna sort_order no
 * existe todavia (migracion sin aplicar), se avisa en vez de fallar en
 * silencio.
 */
export const moverBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        botId: z.string().uuid(),
        direccion: z.enum(["arriba", "abajo"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { exigirBotPropio } = await import("./ownership.server");
    const bot = await exigirBotPropio(context.supabase, data.botId);
    const db = await admin();

    const { data: propio, error: errorPropio } = await db
      .from("bots")
      .select("id, name, sort_order")
      .eq("id", data.botId)
      .limit(1);
    if (errorPropio) throw new Error(errorPropio.message);
    const fila = (propio ?? [])[0];
    if (!fila) throw new Error("Ese bot no existe.");

    // Sin la columna: se ordena por created_at y se avisa.
    const tieneOrden = fila.sort_order !== null && fila.sort_order !== undefined;
    const { data: lista, error: errorLista } = await db
      .from("bots")
      .select("id, name, sort_order, created_at")
      .eq("user_id", context.userId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (errorLista) throw new Error(errorLista.message);

    const ordenados = (lista ?? []).slice().sort((a, b) => {
      const sa = a.sort_order ?? Number.MAX_SAFE_INTEGER;
      const sb = b.sort_order ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      return String(a.created_at).localeCompare(String(b.created_at));
    });
    const indice = ordenados.findIndex((b) => b.id === data.botId);
    if (indice < 0) throw new Error("Ese bot no está en tu escuadrón.");
    const destino = data.direccion === "arriba" ? indice - 1 : indice + 1;
    if (destino < 0 || destino >= ordenados.length) {
      return { ok: true, movido: false, aviso: "Ya está en el extremo: no hay a dónde moverlo." };
    }

    const actual = ordenados[indice]!;
    const vecino = ordenados[destino]!;
    if (!tieneOrden) {
      return {
        ok: false,
        movido: false,
        aviso:
          "Falta la migracion 20261029000000_bots_orden.sql (columna sort_order): aplicala en el SQL Editor de Supabase para poder ordenar los bots.",
      };
    }

    // Intercambio de posiciones.
    const { error: errorA } = await db
      .from("bots")
      .update({ sort_order: vecino.sort_order })
      .eq("id", actual.id);
    if (errorA) throw new Error(errorA.message);
    const { error: errorB } = await db
      .from("bots")
      .update({ sort_order: actual.sort_order })
      .eq("id", vecino.id);
    if (errorB) throw new Error(errorB.message);

    return { ok: true, movido: true, aviso: "" };
  });
