import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "pause_bot",
  title: "Pausar o detener un bot",
  description:
    "Cambia el estado de un bot a pausado o detenido. No permite arrancar bots ni operar con fondos reales.",
  inputSchema: {
    botId: z.string().uuid().describe("ID del bot."),
    status: z.enum(["paused", "stopped"]).default("paused").describe("Nuevo estado."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ botId, status }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "No autenticado" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const next = status ?? "paused";
    const { data, error } = await supabase
      .from("bots")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", botId)
      .select("id,name,status");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data || data.length === 0)
      return { content: [{ type: "text", text: "Bot no encontrado" }], isError: true };
    await supabase
      .from("bot_logs")
      .insert({ bot_id: botId, level: "info", message: `Estado cambiado a ${next} vía MCP` });
    return {
      content: [{ type: "text", text: JSON.stringify(data[0]) }],
      structuredContent: { bot: data[0] },
    };
  },
});
