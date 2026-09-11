import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_bots",
  title: "Listar bots",
  description:
    "Devuelve los bots de trading del escuadrón con su estado, modo, par, capital, PnL y límites de riesgo.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "No autenticado" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("bots")
      .select(
        "id,name,strategy,pair,capital,status,mode,exchange,pnl,win_rate,automation_enabled,max_daily_loss,max_drawdown_pct,trades_today,auto_stop_reason",
      )
      .order("created_at", { ascending: true });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { bots: data ?? [] },
    };
  },
});
