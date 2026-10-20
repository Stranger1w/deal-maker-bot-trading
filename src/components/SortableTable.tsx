import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

export type Column<T> = {
  key: string;
  label: string;
  /** Valor usado para ordenar. Si falta, la columna no es ordenable. */
  value?: (row: T) => string | number;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
};

/** Tabla de alto contraste con ordenación ascendente/descendente al pulsar el encabezado. */
/**
 * Indicador de orden: dos flechitas apiladas, la activa marcada.
 *
 * Antes se cambiaba el icono entero (flecha doble -> arriba -> abajo) y
 * ademas salia un "sin orden" con un icono de doble flecha que confuncia.
 * Ahora se ve siempre hacia donde se puede ordenar, y hacia donde esta
 * ordenado ahora mismo.
 */
function FlechasOrden({ dir }: { dir: "asc" | "desc" }) {
  return (
    <span className="inline-flex flex-col items-center gap-[1px] leading-none">
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        className={cn(
          "transition-colors",
          dir === "asc" ? "text-primary" : "text-muted-foreground/35",
        )}
        aria-hidden
      >
        <path d="M4 0.5 L7.5 4.5 H0.5 Z" fill="currentColor" />
      </svg>
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        className={cn(
          "transition-colors",
          dir === "desc" ? "text-primary" : "text-muted-foreground/35",
        )}
        aria-hidden
      >
        <path d="M4 4.5 L0.5 0.5 H7.5 Z" fill="currentColor" />
      </svg>
    </span>
  );
}

export function SortableTable<T>({
  rows,
  columns,
  rowKey,
  initialSort,
  empty = "Sin datos todavía.",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: SortDir };
  empty?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return rows;
    const getter = col.value;
    return [...rows].sort((a, b) => {
      const av = getter(a);
      const bv = getter(b);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "es", { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((prev) =>
      prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );

  return (
    <div className="overflow-hidden rounded-xl border border-border/80">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-secondary/80 backdrop-blur-sm">
              {columns.map((col) => {
                const sortable = !!col.value;
                const active = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn(
                      "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                      col.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggle(col.key)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-sm transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                          active && "text-foreground",
                        )}
                        title={`Ordenar por ${col.label}`}
                      >
                        {col.label}
                        <FlechasOrden dir={active ? sort.dir : "asc"} />
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-border/40 transition-colors last:border-0 hover:bg-secondary/25"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-3 py-2.5 align-middle",
                      col.align === "right" ? "text-right tabular" : "",
                      col.className,
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
