import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import {
  Bot,
  Cpu,
  KeyRound,
  LayoutDashboard,
  Pickaxe,
  Radar,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { KillSwitchButton } from "@/components/KillSwitchButton";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "author", content: "Deal Maker" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap",
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const navGroups = [
  {
    title: "Mi dinero",
    items: [
      { to: "/", label: "Inicio", icon: LayoutDashboard },
      { to: "/fondos", label: "Mi dinero", icon: Wallet },
      { to: "/binance", label: "Mi cuenta Binance", icon: KeyRound },
    ],
  },
  {
    title: "Mis bots",
    items: [
      { to: "/escuadron", label: "Mis bots", icon: Bot },
      { to: "/reconocimiento", label: "Buscar oportunidades", icon: Radar },
      { to: "/automatizacion", label: "Piloto automático", icon: Cpu },
      { to: "/mineria", label: "Minería", icon: Pickaxe },
    ],
  },
  {
    title: "Seguridad",
    items: [{ to: "/acceso", label: "Seguridad", icon: ShieldCheck }],
  },
] as const;

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 border-b border-border bg-sidebar/95 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <Link to="/" className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md bg-primary font-bold text-primary-foreground">
                D
              </span>
              <span className="text-lg font-semibold tracking-tight">Deal Maker</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {navGroups.map((group, i) => (
                <div key={group.title} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden className="mr-2 h-5 w-px bg-border" />}
                  {group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      activeOptions={{ exact: item.to === "/" }}
                      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      activeProps={{ className: "bg-primary text-primary-foreground" }}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
            {/* Parada de emergencia siempre accesible, también en móvil. */}
            <div className="ml-auto">
              <KillSwitchButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8">
          {/* Required: nested routes render here. */}
          <Outlet />
        </main>
      </div>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}

