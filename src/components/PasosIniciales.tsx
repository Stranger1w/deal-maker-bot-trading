import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronLeft, ChevronRight, PartyPopper, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Los pasos iniciales, como una presentacion que avanza sola.
 *
 * Antes eran una tarjeta mas al final del panel, y se quedaba ahi para
 * siempre (o no se veia si no bajabas). Ahora es una ventana arriba que:
 *  - muestra UN paso cada vez, con su numero y su icono,
 *  - avanza sola cada 9 segundos (con barra de progreso),
 *  - se puede pausar, ir atras o saltar a un paso,
 *  - y se cierra para siempre (se recuerda en este navegador).
 *
 * Cuando ya no queda nada por hacer, no se muestra: la app deja de dar la
 * charla.
 */

export type Paso = {
  titulo: string;
  detalle: string;
  /** Lo que hay que hacer para darlo por hecho. */
  hecho: boolean;
  /** Destino del boton de accion. */
  to?: string;
  etiquetaAccion?: string;
  icono?: React.ComponentType<{ className?: string }>;
};

/** Segundos que cada paso se queda en pantalla. */
export const SEGUNDOS_POR_PASO = 9;

const CLAVE_DESCARTADO = "deal-maker:pasos:descartados";

export function PasosIniciales({ pasos }: { pasos: Paso[] }) {
  const pendientes = useMemo(() => pasos.filter((p) => !p.hecho), [pasos]);
  const [indice, setIndice] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [descartado, setDescartado] = useState(false);

  // ¿Lo ha cerrado antes en este navegador?
  useEffect(() => {
    try {
      setDescartado(window.localStorage.getItem(CLAVE_DESCARTADO) === "1");
    } catch {
      setDescartado(false);
    }
  }, []);

  // Avanza solo, salvo que el sistema pida menos movimiento.
  const reduceMovimiento = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (pausado || reduceMovimiento) return;
    if (pendientes.length <= 1) return;
    const id = window.setTimeout(() => {
      setIndice((i) => (i + 1) % pendientes.length);
    }, SEGUNDOS_POR_PASO * 1000);
    return () => window.clearTimeout(id);
  }, [indice, pausado, reduceMovimiento, pendientes.length]);

  if (descartado || pendientes.length === 0) return null;

  const paso = pendientes[indice % pendientes.length] ?? pendientes[0]!;
  const Icono = paso.icono;

  return (
    <section className="surface accent-top relative overflow-hidden rounded-xl">
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
        <div className="min-w-0">
          <p className="kicker">
            Paso {indice + 1} de {pendientes.length}
            {pendientes.length === 1 ? " · último" : ""}
          </p>
          <div className="mt-2 flex items-start gap-3">
            {Icono ? (
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                <Icono className="size-4" />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-snug">{paso.titulo}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{paso.detalle}</p>
              {paso.to ? (
                <Link
                  to={paso.to}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                >
                  {paso.etiquetaAccion ?? "Vamos"}
                  <ArrowRight className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        {/* Controles: pausa, anterior, siguiente, puntos y cerrar. */}
        <div className="flex items-center gap-2 md:flex-col md:items-end">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Paso anterior"
              onClick={() => setIndice((i) => (i - 1 + pendientes.length) % pendientes.length)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground"
              onClick={() => setPausado((v) => !v)}
              aria-label={pausado ? "Reanudar" : "Pausar"}
            >
              {pausado ? "▶" : "❙❙"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Paso siguiente"
              onClick={() => setIndice((i) => (i + 1) % pendientes.length)}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Cerrar los pasos"
              onClick={() => {
                try {
                  window.localStorage.setItem(CLAVE_DESCARTADO, "1");
                } catch {
                  /* sin almacenamiento: se mostrara otra vez */
                }
                setDescartado(true);
              }}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Puntos: uno por paso, el activo marcado. */}
          <div className="flex items-center gap-1.5">
            {pendientes.map((p, i) => (
              <button
                key={p.titulo}
                type="button"
                onClick={() => setIndice(i)}
                aria-label={`Ir al paso ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === indice ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-muted-foreground/50",
                )}
              />
            ))}
            {pendientes.length > 1 && !pausado && !reduceMovimiento ? (
              <span
                key={`barra-${indice}`}
                className="anim-progreso ml-1 h-1 w-16 overflow-hidden rounded-full bg-border/60"
                style={{ ["--dur" as string]: `${SEGUNDOS_POR_PASO}s` }}
              >
                <span className="block h-full w-0 bg-primary/70" />
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {pendientes.length === 1 ? (
        <p className="flex items-center gap-1.5 border-t border-border/60 px-5 py-2 text-[11px] text-muted-foreground">
          <Check className="size-3.5 text-success" />
          Cuando lo tengas, esto desaparece solo.
        </p>
      ) : null}
    </section>
  );
}

/** Icono de "todo hecho" para cuando solo queda un paso. */
export const IconoFinal = PartyPopper;
