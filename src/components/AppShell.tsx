import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Bot,
  CandlestickChart,
  ChartNoAxesColumn,
  Cpu,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Menu,
  OctagonX,
  Pickaxe,
  Radar,
  Search,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useGuardianDeSesion } from "@/hooks/useGuardianDeSesion";

import { KillSwitchButton } from "@/components/KillSwitchButton";
import { SwitchModoCuenta } from "@/components/SwitchModoCuenta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertsPanel } from "@/components/AlertsPanel";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { alertsQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Estructura de la navegacion: grupos por tarea.
 */
export type GrupoNav = {
  title: string;
  items: { to: string; label: string; icon: LucideIcon; detalle: string }[];
};

export const NAV_GRUPOS: GrupoNav[] = [
  {
    title: "Resumen",
    items: [
      {
        to: "/",
        label: "Inicio",
        icon: LayoutDashboard,
        detalle: "Tu dinero, tus bots y el estado del motor",
      },
      {
        to: "/metricas",
        label: "Métricas",
        icon: ChartNoAxesColumn,
        detalle: "P&L real por bot, indicador, par y hora",
      },
    ],
  },
  {
    title: "Dinero",
    items: [
      { to: "/fondos", label: "Fondos", icon: Wallet, detalle: "Saldo, movimientos y retiradas" },
      {
        to: "/binance",
        label: "Cuentas de trading",
        icon: KeyRound,
        detalle: "Claves de API, entorno y permisos",
      },
    ],
  },
  {
    title: "Trading",
    items: [
      {
        to: "/escuadron",
        label: "Mis bots",
        icon: Bot,
        detalle: "Crear, configurar y promover bots",
      },
      { to: "/motor", label: "Motor", icon: Gauge, detalle: "Indicadores, estrategia y sesión" },
      {
        to: "/mercados",
        label: "Mercados",
        icon: CandlestickChart,
        detalle: "Preces y asignación de pares",
      },
      {
        to: "/reconocimiento",
        label: "Oportunidades",
        icon: Radar,
        detalle: "Bots que solo observan el mercado",
      },
    ],
  },
  {
    title: "Ajustes",
    items: [
      {
        to: "/automatizacion",
        label: "Riesgo global",
        icon: Cpu,
        detalle: "Límites del escuadrón, ciclos y órdenes",
      },
      { to: "/mineria", label: "Minería", icon: Pickaxe, detalle: "Equipos de SHA-256" },
      { to: "/acceso", label: "Seguridad", icon: ShieldCheck, detalle: "Sesión y segundo factor" },
    ],
  },
];

/**
 * Contenedor de la aplicacion: barra lateral fija, barra superior y
 * paleta de comandos (Cmd+K).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [paleta, setPaleta] = useState(false);
  // El panel de avisos: el boton del campanito abria el buscador (error).
  const [avisos, setAvisos] = useState(false);
  const [movil, setMovil] = useState(false);
  const [colapsada, setColapsada] = useState(false);

  // Si la sesion caduca, al login (en vez de una pagina de error).
  useGuardianDeSesion();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const alertas = useQuery(alertsQuery);
  const sinRevisar = (alertas.data ?? []).filter(
    (a) => a.severity === "critical" && !a.acknowledged,
  ).length;

  // Atajo de teclado: Cmd/Ctrl + K abre la paleta.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaleta((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navegacion = (
    <nav className="flex flex-col gap-5">
      {NAV_GRUPOS.map((grupo) => (
        <div key={grupo.title} className="flex flex-col gap-0.5">
          <p className="kicker px-3 pb-1 text-sidebar-foreground/60">{grupo.title}</p>
          {grupo.items.map((item) => {
            const activo = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMovil(false)}
                title={colapsada ? item.label : undefined}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200",
                  activo
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                {activo && (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-sidebar-primary" />
                )}
                <item.icon
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-200",
                    activo ? "text-sidebar-primary" : "opacity-60 group-hover:opacity-100",
                  )}
                />
                {!colapsada && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Barra lateral (escritorio) */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          colapsada ? "w-[4.25rem]" : "w-60",
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-4">
          <Link to="/" className="flex items-center gap-2.5 overflow-hidden">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-sm">
              D
            </span>
            {!colapsada && (
              <span className="flex flex-col leading-none">
                <span className="text-sm font-semibold tracking-tight text-sidebar-foreground">
                  Deal Maker
                </span>
                <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
                  Trading
                </span>
              </span>
            )}
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">{navegacion}</div>

        <div className="flex items-center gap-2 border-t border-sidebar-border p-3">
          <KillSwitchButton className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setColapsada((v) => !v)}
            aria-label={colapsada ? "Expandir el menú" : "Contraer el menú"}
            className="text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Menu className={cn("size-4 transition-transform", colapsada && "rotate-90")} />
          </Button>
        </div>
      </aside>

      {/* Menú móvil */}
      <Sheet open={movil} onOpenChange={setMovil}>
        <SheetContent
          side="left"
          className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                D
              </span>
              Deal Maker
            </SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto p-3">{navegacion}</div>
        </SheetContent>
      </Sheet>

      {/* Contenido */}
      <div
        className={cn(
          "transition-[padding] duration-200",
          colapsada ? "md:pl-[4.25rem]" : "md:pl-60",
        )}
      >
        <header className="glass sticky top-0 z-30">
          <div className="mx-auto flex h-14 max-w-[110rem] items-center gap-3 px-4 md:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Abrir el menú"
              onClick={() => setMovil(true)}
            >
              <Menu className="size-5" />
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <SwitchModoCuenta />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPaleta(true)}
                className="hidden h-8 gap-2 border-border/70 bg-secondary/30 text-muted-foreground sm:flex"
              >
                <Search className="size-3.5" />
                Buscar
                <kbd className="ml-2 rounded border border-border/70 bg-background/60 px-1.5 py-0.5 font-mono text-[10px]">
                  ⌘K
                </kbd>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="relative text-muted-foreground"
                aria-label="Avisos"
                onClick={() => setAvisos(true)}
              >
                <Bell className="size-4" />
                {sinRevisar > 0 && (
                  <span className="absolute right-1 top-1 grid size-3.5 place-items-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground">
                    {sinRevisar}
                  </span>
                )}
              </Button>
              <KillSwitchButton className="md:hidden" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[110rem] px-4 py-8 md:px-8">{children}</main>
      </div>

      {/* Avisos: el boton del campanito. Antes abria el buscador. */}
      <Dialog open={avisos} onOpenChange={setAvisos}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Avisos del motor y de la cuenta</DialogTitle>
            <DialogDescription>
              Lo que ha pasado: limites de riesgo, ordenes rechazadas, errores y avisos de Binance.
              Con el correo activado, los importantes tambien te llegan a tu correo.
            </DialogDescription>
          </DialogHeader>
          <AlertsPanel title="Avisos" limit={30} />
        </DialogContent>
      </Dialog>

      {/* Paleta de comandos (Cmd+K) */}
      <CommandDialog open={paleta} onOpenChange={setPaleta}>
        <CommandInput placeholder="Ir a… (escribe el nombre de una sección)" />
        <CommandList>
          <CommandEmpty>No hay nada con ese nombre.</CommandEmpty>
          {NAV_GRUPOS.map((grupo) => (
            <CommandGroup key={grupo.title} heading={grupo.title}>
              {grupo.items.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${grupo.title} ${item.label} ${item.detalle}`}
                  onSelect={() => {
                    window.location.href = item.to;
                  }}
                >
                  <item.icon className="size-4" />
                  <span>{item.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{item.detalle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandGroup heading="Acciones">
            <CommandItem
              value="parada total detener bots"
              onSelect={() => {
                window.location.href = "/automatizacion";
              }}
            >
              <OctagonX className="size-4" />
              <span>Parada de emergencia</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
}
