import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Autenticacion HTTP Basic para despliegues publicos (Railway, VPS, etc).
// Sin estas variables la app se sirve SIN proteccion: solo para desarrollo local.
// El cron (/api/public/automation-tick) usa su propio Bearer y NO pasa por aqui
// porque el endpoint lo valida por separado; se le deja pasar para no romperlo.
const BASIC_USER = process.env["APP_BASIC_AUTH_USER"];
const BASIC_PASS = process.env["APP_BASIC_AUTH_PASSWORD"];

const CRON_PATHS = ["/api/public/automation-tick", "/api/public/maintenance"];

function unauthorized(): Response {
  return new Response("Autenticacion requerida", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Deal Maker", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request: Request): boolean {
  if (!BASIC_USER || !BASIC_PASS) return true; // Sin config -> abierto (local)
  const header = request.headers.get("authorization") ?? "";
  const match = /^Basic ([^\s]+)$/.exec(header);
  if (!match) return false;
  let decoded: string;
  try {
    decoded = atob(match[1] ?? "");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return timingSafeEqualStr(user, BASIC_USER) && timingSafeEqualStr(pass, BASIC_PASS);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Rutas del cron: se validan dentro del handler con su propio secreto.
      const url = new URL(request.url);
      if (!CRON_PATHS.includes(url.pathname) && !isAuthorized(request)) {
        return unauthorized();
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
