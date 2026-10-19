import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Estado vacio: lo que se ve cuando aun no hay nada.
 *
 * Un "0" o un "Sin datos" a secas deja al usuario sin saber si la app
 * esta rota, si le falta algo por hacer o si es normal. Aqui se explica en
 * una frase que pasa y, si hay forma, se ofrece el siguiente paso.
 */
export function EmptyState({
  titulo,
  detalle,
  accion,
  icono: Icono = Inbox,
  className,
}: {
  /** Que falta (en una frase corta). */
  titulo: string;
  /** Por que pasa y que hacer al respecto. */
  detalle: string;
  /** El siguiente paso, si lo hay. */
  accion?: React.ReactNode;
  icono?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-secondary/60 text-muted-foreground">
        <Icono className="size-5" />
      </span>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{detalle}</p>
      </div>
      {accion}
    </div>
  );
}
