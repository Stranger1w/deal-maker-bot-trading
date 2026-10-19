import { cn } from "@/lib/utils";

/**
 * Esqueleto de carga.
 *
 * Un "Cargando..." en texto plano hace un salto de layout y no dice nada.
 * Un esqueleto con la forma real del contenido mantiene la pagina estable y
 * comunica que la informacion va a llegar.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-secondary/60", className)}
      aria-hidden
      {...props}
    />
  );
}

/** Filas de esqueleto para una tabla. */
export function SkeletonTabla({
  filas = 5,
  columnas = 4,
  className,
}: {
  filas?: number;
  columnas?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true">
      {Array.from({ length: filas }).map((_, f) => (
        <div key={f} className="flex items-center gap-4 px-3 py-2.5">
          {Array.from({ length: columnas }).map((__, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Bloques de esqueleto para las tarjetas de cifras. */
export function SkeletonCifras({
  cantidad = 4,
  className,
}: {
  cantidad?: number;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)} aria-busy="true">
      {Array.from({ length: cantidad }).map((_, i) => (
        <div key={i} className="surface rounded-xl px-5 py-4">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-2 h-2.5 w-40" />
        </div>
      ))}
    </div>
  );
}
