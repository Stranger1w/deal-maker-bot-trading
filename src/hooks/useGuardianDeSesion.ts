/**
 * GUARDIAN DE SESION.
 *
 * QUE PROBLEMA RESUELVE
 * La sesion de Supabase dura una hora (y el refresh token, mientras se use).
 * Cuando caduca, las server functions empiezan a fallar con
 * "Unauthorized: No authorization header provided" y la app enseñaba una
 * pagina de error sin explicar nada.
 *
 * QUE HACE
 *  - Al abrir la app: si no hay sesion, manda al login (y vuelve a donde
 *    estabas al entrar).
 *  - Escucha los cambios de sesion: si caduca mientras la app esta
 *    abierta, salta al login en vez de dejar la pantalla a medias.
 *  - Si una server function devuelve 401, avisa una vez y lleva al login.
 */

import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { supabase } from "@/integrations/supabase/client";

/** Rutas donde no hace falta sesion (el login). */
const RUTAS_PUBLICAS = ["/acceso"];

/** Texto que indica que el fallo es de sesion y no de otra cosa. */
export function esErrorDeSesion(error: unknown): boolean {
  const texto = error instanceof Error ? error.message : String(error ?? "");
  return /unauthorized|no authorization header|invalid jwt|401|token/i.test(texto);
}

export function useGuardianDeSesion() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const avisado = useRef(false);

  // Al abrir y en cada cambio de sesion.
  useEffect(() => {
    let vivo = true;
    const alLogin = () => {
      if (!vivo) return;
      if (RUTAS_PUBLICAS.includes(pathname)) return;
      // El router ya codifica el valor del search param: si lo codificamos
      // aqui, sale doble (%252F) y la vuelta al destino falla.
      void router.navigate({ to: "/acceso", search: { next: pathname } });
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) alLogin();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, sesion) => {
      // TOKEN_REFRESHED es el refresco automatico: no es un cierre.
      if (evento === "SIGNED_OUT" || (!sesion && evento !== "TOKEN_REFRESHED")) alLogin();
    });

    return () => {
      vivo = false;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  // Si una peticion devuelve 401, al login (una sola vez).
  useEffect(() => {
    const alError = (evento: Event) => {
      const detalle = (evento as CustomEvent<{ error?: unknown }>).detail;
      if (!esErrorDeSesion(detalle?.error)) return;
      if (avisado.current) return;
      avisado.current = true;
      if (RUTAS_PUBLICAS.includes(pathname)) return;
      void router.navigate({ to: "/acceso", search: { next: pathname } });
    };
    window.addEventListener("deal-maker:error-sesion", alError as EventListener);
    return () => window.removeEventListener("deal-maker:error-sesion", alError as EventListener);
  }, [pathname, router]);
}
