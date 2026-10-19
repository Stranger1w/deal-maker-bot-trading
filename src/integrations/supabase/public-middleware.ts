import { createMiddleware } from "@tanstack/react-start";

/**
 * Middleware que marca una server function como PUBLICA (sin sesion).
 *
 * El nivel minimo global es `requireSupabaseAuth` (src/start.ts): toda server
 * function exige sesion valida. Las funciones publicas son una excepcion
 * consciente y son pocas: la de /acceso que dice si el registro esta
 * abierto, para que la pantalla de login pueda mostrarlo sin sesion.
 *
 * La lista de funciones publicas es cerrada y la vigila
 * src/lib/server-fn-coverage.test.ts: anadir una obliga a decidir
 * conscientemente si de verdad debe ser publica.
 */
export const publico = createMiddleware({ type: "function" }).server(async ({ next }) => {
  return next();
});
