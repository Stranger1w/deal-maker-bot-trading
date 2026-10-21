import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Mail, ShieldCheck, LogOut } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSecuritySession } from "@/hooks/useSecuritySession";
import { supabase } from "@/integrations/supabase/client";
import { estadoRegistroPublico } from "@/lib/registro.functions";
import {
  configurarNotificacionesCorreo,
  enviarCorreoPrueba,
  leerNotificacionesCorreo,
} from "@/lib/notificaciones.functions";

export const Route = createFileRoute("/acceso")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s["next"] === "string" ? s["next"] : undefined,
    // Por que se te pide entrar: "caducada" (la sesion de 1 h se acabo) o
    // "sin_sesion" (nunca has entrado en esta sesion).
    motivo: s["motivo"] === "caducada" ? ("caducada" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Acceso y 2FA — Deal Maker" },
      {
        name: "description",
        content:
          "Inicio de sesión y verificación en dos pasos obligatoria para retiros de fondos y para pasar bots de demo a real.",
      },
      { property: "og:title", content: "Acceso y 2FA — Deal Maker" },
      {
        property: "og:description",
        content: "Autenticación real con segundo factor TOTP para operaciones sensibles.",
      },
    ],
  }),
  component: AccessPage,
});

// Solo se acepta una ruta relativa del mismo origen como destino de retorno.
function safeNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function AccessPage() {
  const session = useSecuritySession();
  const { next, motivo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ id: string; svg: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  // Si te echaron porque la sesion caduco, dilo: si no parece que la app este
  // rota (la sesion de Supabase dura una hora).
  useEffect(() => {
    if (motivo === "caducada") {
      toast.info(
        "Tu sesion ha caducado (dura una hora). Vuelve a entrar: te dejamos justo donde estabas.",
      );
    }
  }, [motivo]);

  // El registro publico esta cerrado por defecto (el multiusuario todavia no
  // esta probado). El boton solo aparece si el administrador lo abre.
  const estadoRegistro = useServerFn(estadoRegistroPublico);
  const registro = useQuery({
    queryKey: ["registro_publico"],
    queryFn: () => estadoRegistro({}),
  });

  const returnTo = safeNext(next);

  // Si ya hay sesion, esta pantalla sobra: se vuelve a la app.
  useEffect(() => {
    if (session.loading) return;
    if (!session.signedIn) return;
    window.location.href = returnTo ?? "/";
  }, [session.loading, session.signedIn, returnTo]);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Sesión iniciada");
    if (returnTo) window.location.href = returnTo;
  };

  // Notificaciones por correo: el destino por defecto es el correo de la
  // cuenta con la que te has apuntado.
  const notificacionesFn = useServerFn(leerNotificacionesCorreo);
  const configurarNotificacionesFn = useServerFn(configurarNotificacionesCorreo);
  const correoPruebaFn = useServerFn(enviarCorreoPrueba);
  const [notificaciones, setNotificaciones] = useState<{
    correoCuenta: string | null;
    correoDestino: string;
    activo: boolean;
    hayProveedor: boolean;
  } | null>(null);
  const [guardandoCorreo, setGuardandoCorreo] = useState(false);
  const [correoNotificaciones, setCorreoNotificaciones] = useState("");
  const correoCuentaTexto = notificaciones?.correoCuenta
    ? " (" + notificaciones.correoCuenta + ")"
    : "";
  useEffect(() => {
    let vivo = true;
    void notificacionesFn({})
      .then((n) => {
        if (!vivo) return;
        setNotificaciones(n);
        setCorreoNotificaciones(n.correoDestino ?? "");
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [notificacionesFn]);
  const alternarCorreo = async (activo: boolean) => {
    try {
      setGuardandoCorreo(true);
      const r = await configurarNotificacionesFn({
        data: { activo, ...(correoNotificaciones ? { correo: correoNotificaciones } : {}) },
      });
      setNotificaciones((n) =>
        n ? { ...n, activo: r.activo, correoDestino: r.correoDestino } : n,
      );
      toast.success(
        r.activo
          ? "Avisos activados: te llegan al correo de tu cuenta."
          : "Avisos desactivados: no sale ningún correo.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardandoCorreo(false);
    }
  };

  const signUp = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      ...(returnTo ? { options: { emailRedirectTo: `${window.location.origin}${returnTo}` } } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cuenta creada. Revisa tu correo si se requiere confirmación.");
    if (returnTo) window.location.href = returnTo;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
    window.location.href = "/";
  };

  const startEnroll = async () => {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Deal Maker ${Date.now()}`,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setQr({ id: data.id, svg: data.totp.qr_code, secret: data.totp.secret });
  };

  const verifyEnroll = async () => {
    if (!qr) return;
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: qr.id });
    if (cErr) {
      toast.error(cErr.message);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: qr.id,
      challengeId: challenge.id,
      code,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setQr(null);
    setCode("");
    toast.success("2FA verificada en esta sesión");
  };

  const challengeExisting = async () => {
    const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
    if (fErr) {
      toast.error(fErr.message);
      return;
    }
    const factor = factors.totp?.[0];
    if (!factor) {
      toast.error("No hay factor TOTP registrado");
      return;
    }
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
      factorId: factor.id,
    });
    if (cErr) {
      toast.error(cErr.message);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challenge.id,
      code,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setCode("");
    toast.success("Segundo factor verificado");
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Seguridad"
        title="Acceso y seguridad"
        subtitle="Los retiros de fondos y el paso Demo→Real exigen sesión iniciada y segundo factor verificado. Sin ello, esos flujos permanecen bloqueados."
        action={
          session.signedIn ? (
            <Button variant="secondary" onClick={signOut}>
              <LogOut className="size-4" /> Cerrar sesión
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-3 text-base">
            Estado de seguridad
            <StatusPill tone={session.signedIn ? "success" : "danger"}>
              {session.signedIn ? "sesión activa" : "sin sesión"}
            </StatusPill>
            <StatusPill
              tone={
                session.twoFactorVerified
                  ? "success"
                  : session.twoFactorEnrolled
                    ? "warning"
                    : "danger"
              }
            >
              {session.twoFactorVerified
                ? "2FA verificada"
                : session.twoFactorEnrolled
                  ? "2FA pendiente de verificar"
                  : "2FA no configurada"}
            </StatusPill>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {session.email
            ? `Cuenta: ${session.email}`
            : "Inicia sesión para habilitar operaciones sensibles."}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Mail className="size-4 text-primary" /> Notificaciones por correo
            <StatusPill tone={notificaciones?.activo ? "success" : "neutral"}>
              {notificaciones?.activo ? "activadas" : "desactivadas"}
            </StatusPill>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Los avisos importantes del motor (límites de riesgo, órdenes rechazadas, errores) y los
            reportes diario y semanal. Por defecto van al{" "}
            <strong>correo con el que creaste la cuenta</strong>
            {correoCuentaTexto}: no tienes que escribirlo.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-secondary/40 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {notificaciones?.activo
                  ? "Quiero recibir avisos por correo"
                  : "No quiero avisos por correo"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {notificaciones?.activo
                  ? "Se mandan al correo de arriba. Puedes desactivarlo cuando quieras."
                  : "No sale ningún correo. Los avisos se quedan dentro de la app."}
              </p>
            </div>
            <Switch
              checked={notificaciones?.activo ?? false}
              disabled={guardandoCorreo || !notificaciones}
              onCheckedChange={(v) => void alternarCorreo(v)}
              aria-label="Activar o desactivar las notificaciones por correo"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="correo-notificaciones">Correo de destino</Label>
            <Input
              id="correo-notificaciones"
              type="email"
              placeholder={notificaciones?.correoCuenta ?? "el correo de tu cuenta"}
              value={correoNotificaciones}
              onChange={(e) => setCorreoNotificaciones(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Por defecto, el de tu cuenta. Si lo cambias, los avisos van ahí.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={!notificaciones?.hayProveedor}
              onClick={async () => {
                try {
                  const r = await correoPruebaFn({});
                  toast.success("Correo de prueba enviado a " + r.destino);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "No se pudo enviar");
                }
              }}
            >
              Enviar un correo de prueba
            </Button>
            {!notificaciones?.hayProveedor && (
              <p className="text-[11px] text-warning">
                El servidor no tiene proveedor de correo (falta RESEND_API_KEY): el interruptor se
                guarda, pero no sale ningún correo hasta que se configure.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" /> Cuenta
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={signIn} disabled={busy} className="flex-1">
                Iniciar sesión
              </Button>
              {registro.data?.permitido ? (
                <Button onClick={signUp} disabled={busy} variant="secondary" className="flex-1">
                  Crear cuenta
                </Button>
              ) : (
                <Button variant="secondary" className="flex-1" disabled>
                  Crear cuenta (cerrado)
                </Button>
              )}
            </div>
            {!registro.data?.permitido && (
              <p className="text-xs text-muted-foreground">
                {registro.data?.motivo ??
                  "El registro esta cerrado mientras el multiusuario no este probado."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" /> Segundo factor (TOTP)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!session.signedIn && (
              <p className="text-sm text-muted-foreground">
                Inicia sesión para configurar o verificar tu segundo factor.
              </p>
            )}
            {session.signedIn && !session.twoFactorEnrolled && !qr && (
              <Button onClick={startEnroll}>Configurar 2FA</Button>
            )}
            {qr && (
              <div className="space-y-3">
                <div
                  className="w-40 rounded-md bg-white p-2"
                  // El SVG lo genera Supabase Auth para el código QR del factor TOTP.
                  dangerouslySetInnerHTML={{ __html: qr.svg }}
                />
                <p className="tabular break-all text-xs text-muted-foreground">
                  Clave manual: {qr.secret}
                </p>
              </div>
            )}
            {session.signedIn && (
              <div className="space-y-2">
                <Label htmlFor="totp">Código de 6 dígitos</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="000000"
                />
                <div className="flex gap-2">
                  {qr ? (
                    <Button onClick={verifyEnroll} className="flex-1">
                      Verificar y activar
                    </Button>
                  ) : (
                    <Button onClick={challengeExisting} className="flex-1">
                      Verificar sesión
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
