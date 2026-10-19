import { cn } from "@/lib/utils";

/**
 * Cabecera de pagina.
 *
 * Un "eyebrow" pequeno (la seccion), un titulo con tracking cerrado y un
 * subtitulo apagado. El borde inferior es una linea que se desvanece: separa
 * sin cortar la pagina en trozos.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  action,
}: {
  title: string;
  subtitle: string;
  /** Seccion de la que forma parte la pagina (opcional). */
  eyebrow?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? <p className="kicker mb-2">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold text-foreground md:text-[1.75rem]">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>
      {action}
      <div
        aria-hidden
        className="pointer-events-none -mb-6 h-px w-full bg-gradient-to-r from-transparent via-border to-transparent"
      />
    </header>
  );
}

/** Enlace secundario dentro de una cabecera ("Ajustar", "Ver todos"). */
export function PageHeaderLink({
  children,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn(
        "text-xs font-medium text-primary/90 transition-colors hover:text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
