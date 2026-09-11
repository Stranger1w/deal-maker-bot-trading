import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "bot_logs",
  title: "Registros de bots",
  description:
    "Devuelve los registros más recientes de los bots, opcionalmente filtrados por bot y por nivel (info, warn, error).",
  inputSchema: {
    botId: z.string().uuid().optional().describe("ID del bot a filtrar."),
    level: z.enum(["info", "warn", "error"]).optional().describe("Nivel mínimo a filtrar."),
    limit: z.number().int().min(1).max(200).default(50).describe("Número de registros."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ botId, level, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "No autenticado" }], isError: true };
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("bot_logs")
      .select("id,bot_id,level,message,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (botId) query = query.eq("bot_id", botId);
    if (level) query = query.eq("level", level);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { logs: data ?? [] },
    };
  },
});
