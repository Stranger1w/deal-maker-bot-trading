import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "funds_summary",
  title: "Resumen de fondos",
  description:
    "Devuelve el saldo de la cuenta de fondos y sus movimientos recientes (depósitos y retiros).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Movimientos a devolver."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "No autenticado" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const [account, transactions] = await Promise.all([
      supabase
        .from("fund_accounts")
        .select("id,label,currency,available_balance,in_use_balance")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("fund_transactions")
        .select("id,kind,method,amount,status,reference,created_at")
        .order("created_at", { ascending: false })
        .limit(limit ?? 20),
    ]);
    const error = account.error ?? transactions.error;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const payload = { account: account.data, transactions: transactions.data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
