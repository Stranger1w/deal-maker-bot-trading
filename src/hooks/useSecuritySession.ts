import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

export type SecuritySession = {
  loading: boolean;
  email: string | null;
  signedIn: boolean;
  /** true solo si la sesión actual está verificada con segundo factor (TOTP). */
  twoFactorVerified: boolean;
  /** true si el usuario tiene al menos un factor TOTP verificado en su cuenta. */
  twoFactorEnrolled: boolean;
};

const initial: SecuritySession = {
  loading: true,
  email: null,
  signedIn: false,
  twoFactorVerified: false,
  twoFactorEnrolled: false,
};

/** Estado real de autenticación y 2FA. Nunca simula seguridad. */
export function useSecuritySession(): SecuritySession {
  const [state, setState] = useState<SecuritySession>(initial);

  useEffect(() => {
    let active = true;

    const read = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session) {
        if (active) setState({ ...initial, loading: false });
        return;
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: factors } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      setState({
        loading: false,
        email: session.user.email ?? null,
        signedIn: true,
        twoFactorVerified: aal?.currentLevel === "aal2",
        twoFactorEnrolled: (factors?.totp ?? []).length > 0,
      });
    };

    void read();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "MFA_CHALLENGE_VERIFIED"].includes(event)) {
        void read();
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/**
 * ¿Hay sesion iniciada?
 *
 * `null` = todavia no se sabe (se comprueba al abrir: si se empezara en
 * `false` la app parpadearia del login al menu en cada carga).
 * `false` = no hay sesion: la app se queda en el login y sin menus muertos.
 */
export function useSesionActiva(): boolean | null {
  const [estado, setEstado] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;

    const leer = async () => {
      const { data } = await supabase.auth.getSession();
      if (vivo) setEstado(Boolean(data.session));
    };

    void leer();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((evento) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", "USER_UPDATED"].includes(evento)) return;
      // Fuera del callback: Supabase no admite llamadas al servidor dentro de
      // onAuthStateChange (se bloquean esperando al propio evento).
      setTimeout(() => void leer(), 0);
    });

    return () => {
      vivo = false;
      subscription.unsubscribe();
    };
  }, []);

  return estado;
}
