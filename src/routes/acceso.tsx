import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, LogOut } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSecuritySession } from "@/hooks/useSecuritySession";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/acceso")({
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

function AccessPage() {
  const session = useSecuritySession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ id: string; svg: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Sesión iniciada");
  };

  const signUp = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Cuenta creada. Revisa tu correo si se requiere confirmación.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
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
          {session.email ? `Cuenta: ${session.email}` : "Inicia sesión para habilitar operaciones sensibles."}
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
              <Button onClick={signUp} disabled={busy} variant="secondary" className="flex-1">
                Crear cuenta
              </Button>
            </div>
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
