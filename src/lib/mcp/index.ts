import { auth, defineMcp } from "@lovable.dev/mcp-js";

import botLogsTool from "./tools/bot-logs";
import fundsSummaryTool from "./tools/funds-summary";
import listAlertsTool from "./tools/list-alerts";
import listBotsTool from "./tools/list-bots";
import pauseBotTool from "./tools/pause-bot";

// El emisor OAuth debe ser el host directo de Supabase (no el proxy de publicación).
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "github-love-project",
  title: "GitHub Love Project",
  version: "0.1.0",
  instructions:
    "Herramientas de Deal Maker: consultar bots de trading, sus registros, alertas operativas y el estado de fondos, " +
    "además de pausar o detener un bot. Cada llamada actúa como el usuario autenticado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listBotsTool, botLogsTool, listAlertsTool, fundsSummaryTool, pauseBotTool],
});
