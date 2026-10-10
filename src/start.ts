import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Nivel minimo global: ninguna server function se ejecuta sin sesion valida.
// Cada funcion declara ademas su nivel real con .middleware([requireAdmin]) o
// .middleware([requireSupabaseAuth]); src/lib/server-fn-coverage.test.ts impide
// que quede alguna sin declarar.
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, requireSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
