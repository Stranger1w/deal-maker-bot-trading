import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Pestañas con indicador deslizante.
 *
 * Es el control que mas se repite en la app (la de la grafica y la de
 * actividad), asi que se hace bien una vez y se usa en todas partes:
 *  - el indicador se DESLIZA al cambiar de pestana (no salta),
 *  - navegacion con teclado (flechas izquierda/derecha, como debe ser),
 *  - roles y atributos ARIA correctos (role=tablist / tab, aria-selected),
 *  - y respeta el movimiento reducido: sin animacion, pero todo funciona.
 */

export type ItemPestana = {
  id: string;
  etiqueta: string;
  icono?: React.ComponentType<{ className?: string }>;
  /** Contador opcional (p.ej. numero de pendientes). */
  contador?: number;
};

export function TabsPestanas({
  items,
  valor,
  onChange,
  className,
  compacta = false,
}: {
  items: readonly ItemPestana[];
  valor: string;
  onChange: (id: string) => void;
  className?: string;
  /** Version pequena, para usar dentro de una tarjeta. */
  compacta?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicador, setIndicador] = useState<{ left: number; ancho: number } | null>(null);
  const indice = Math.max(
    0,
    items.findIndex((i) => i.id === valor),
  );

  // Mide el boton activo para colocar el indicador debajo.
  useEffect(() => {
    const medir = () => {
      const el = refs.current[indice];
      if (!el) return;
      setIndicador({ left: el.offsetLeft, ancho: el.offsetWidth });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [indice, items.length]);

  const mover = (delta: number) => {
    const siguiente = (indice + delta + items.length) % items.length;
    const item = items[siguiente];
    if (item) {
      onChange(item.id);
      refs.current[siguiente]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-xl border border-border/70 bg-secondary/30 p-1",
        className,
      )}
    >
      {indicador ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 top-1 rounded-lg bg-background shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: indicador.left, width: indicador.ancho }}
        />
      ) : null}

      {items.map((item, i) => {
        const activo = i === indice;
        const Icono = item.icono;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={activo}
            tabIndex={activo ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                mover(1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                mover(-1);
              }
            }}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors",
              compacta ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
              activo ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icono ? <Icono className="size-3.5 opacity-80" /> : null}
            {item.etiqueta}
            {item.contador !== undefined && item.contador > 0 ? (
              <span className="metric rounded-full bg-primary/15 px-1.5 py-px text-[10px] text-primary">
                {item.contador}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
