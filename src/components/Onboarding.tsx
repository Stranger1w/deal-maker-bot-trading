import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpenCheck, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STORAGE_KEY = "dealmaker.onboarding.v1";

const PASOS = [
  {
    titulo: "Bienvenido a Deal Maker 🎉",
    texto: "Esta app te ayuda a ganar dinero con bots automáticos y minería, sin saber de trading. Todo empieza con dinero de mentira (demo): no puedes perder nada mientras aprendes.",
    ruta: "/",
    cta: "Ver mi panel",
  },
  {
    titulo: "1. Mis bots (Escuadrón)",
    texto: "Son robots que compran y venden por ti. Tú les dices cuánto dinero usar y cuándo parar si pierden. Empiezan apagados: primero practican en el simulador.",
    ruta: "/escuadron",
    cta: "Ver mis bots",
  },
  {
    titulo: "2. Buscar oportunidades (Reconocimiento)",
    texto: "Bots espías que solo MIRAN el mercado y te avisan ('el Bitcoin está subiendo rápido'). No compran nada, solo te dan ideas.",
    ruta: "/reconocimiento",
    cta: "Ver espías",
  },
  {
    titulo: "3. Piloto automático",
    texto: "El interruptor maestro: deja a tus bots trabajar solos día y noche. Tiene botón rojo de pánico que lo detiene todo si algo sale mal.",
    ruta: "/automatizacion",
    cta: "Ver piloto",
  },
  {
    titulo: "4. Minería",
    texto: "Tus computadoras 'excavan' monedas digitales y te pagan por ello. Aquí ves cuánto gana cada una al día y puedes practicar en el simulador antes.",
    ruta: "/mineria",
    cta: "Ver minería",
  },
  {
    titulo: "5. Cuentas conectadas",
    texto: "Cuando estés listo para dinero real, aquí conectas tu cuenta del exchange (Binance, Coinbase...). NUNCA le des permiso de retirar: así tu dinero no puede salir sin ti.",
    ruta: "/binance",
    cta: "Ver cuentas",
  },
  {
    titulo: "Listo para empezar ✅",
    texto: "Regla de oro: 1) practica en demo, 2) revisa el campo de entrenamiento, 3) empieza con POCO dinero real. Puedes volver a ver esta guía cuando quieras con el botón '?' de arriba.",
    ruta: "/escuadron",
    cta: "Crear mi primer bot",
  },
];

export function guiaTerminada(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "done";
  } catch {
    return true;
  }
}

export function Onboarding() {
  const [paso, setPaso] = useState(0);
  const [visible, setVisible] = useState(() => !guiaTerminada());
  useEffect(() => {
    const show = () => {
      setPaso(0);
      setVisible(true);
    };
    window.addEventListener("dealmaker:guia", show);
    return () => window.removeEventListener("dealmaker:guia", show);
  }, []);
  if (!visible) return null;
  const actual = PASOS[paso]!;
  const cerrar = (done = true) => {
    try {
      if (done) localStorage.setItem(STORAGE_KEY, "done");
    } catch {}
    setVisible(false);
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(92vw,380px)]">
      <Card className="border-primary/40 shadow-xl">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              {actual.titulo}
            </span>
            <button aria-label="Cerrar guía" onClick={() => cerrar()} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{actual.texto}</p>
          <p className="text-xs text-muted-foreground">Paso {paso + 1} de {PASOS.length}</p>
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="secondary" disabled={paso === 0} onClick={() => setPaso((p) => Math.max(0, p - 1))}>
              <ChevronLeft className="size-3.5" /> Atrás
            </Button>
            {paso < PASOS.length - 1 ? (
              <Button size="sm" onClick={() => setPaso((p) => p + 1)}>
                Siguiente <ChevronRight className="size-3.5" />
              </Button>
            ) : (
              <Link to={actual.ruta} onClick={() => cerrar()}>
                <Button size="sm">{actual.cta}</Button>
              </Link>
            )}
          </div>
          <Link to={actual.ruta} onClick={() => setPaso((p) => Math.min(PASOS.length - 1, p + 1))} className="inline-block text-xs text-primary hover:underline">
            Ir a esta sección →
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function OnboardingButton() {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Ver guía inicial"
      title="Guía para principiantes"
      onClick={() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        window.dispatchEvent(new Event("dealmaker:guia"));
      }}
    >
      <BookOpenCheck className="size-4" />
      <span className="hidden md:inline">Guía</span>
    </Button>
  );
}
