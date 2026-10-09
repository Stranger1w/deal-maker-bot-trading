import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "./auth-middleware";

// Exige sesion valida Y que el usuario este en app_admins (is_app_admin()).
// Se registra como functionMiddleware global en src/start.ts: ninguna funcion
// del servidor es invocable sin ser admin. Al abrir funciones a usuarios
// normales (multiusuario) se hace de forma explicita y por funcion.
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("is_app_admin" as never);
    if (error || data !== true) {
      throw new Error("Forbidden: se requiere administrador");
    }
    return next();
  });
