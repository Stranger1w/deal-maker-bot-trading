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
 *  - Al abrir la app: si no hay sesion, intenta REFESCARLA antes de
 *    mandar al login (si el refresh token sigue vivo, ni te enteras).
 *  - Escucha los cambios de sesion: si caduca mientras la app esta
 *    abierta, salta al login en vez de dejar la pantalla a medias.
 *  - Si una server function devuelve 401, intenta refrescar una vez; si no
 *    funciona, avisa (una sola vez) y lleva al login DICIENDO POR QUE.
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

/**
 * Intenta renovar la sesion sin molestar al usuario.
 *
 * El refresco automatico de Supabase solo corre con la pestaña activa: si el
 * PC estaba en reposo (o la ventana en segundo plano), el token caduca sin
 * que nadie lo note. Con el refresh token todavia vivo, esto lo arregla solo.
 */
async function refrescarSiSePuede(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.refreshSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

export function useGuardianDeSesion() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const avisado = useRef(false);

  // Al abrir y en cada cambio de sesion.
  useEffect(() => {
    let vivo = true;
    const alLogin = (motivo: "caducada" | undefined) => {
      if (!vivo) return;
      if (RUTAS_PUBLICAS.includes(pathname)) return;
      // El router ya codifica el valor del search param: si lo codificamos
      // aqui, sale doble (%252F) y la vuelta al destino falla.
      void router.navigate({ to: "/acceso", search: { next: pathname, motivo } });
    };

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
      // Sin sesion: antes de echar, a ver si se puede renovar (el token de
      // refresco suele seguir vivo aunque el token de acceso haya caducado).
      if (await refrescarSiSePuede()) return;
      alLogin(undefined);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento, sesion) => {
      // TOKEN_REFRESHED es el refresco automatico: no es un cierre.
      if (evento === "SIGNED_OUT" || (!sesion && evento !== "TOKEN_REFRESHED")) alLogin("caducada");
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
      // Antes de echar, un intento de refresco: si cuela, la app sigue.
      void refrescarSiSePuede().then((ok) => {
        if (ok) {
          avisado.current = false;
          return;
        }
        void router.navigate({ to: "/acceso", search: { next: pathname, motivo: "caducada" } });
      });
    };
    window.addEventListener("deal-maker:error-sesion", alError as EventListener);
    return () => window.removeEventListener("deal-maker:error-sesion", alError as EventListener);
  }, [pathname, router]);
}
