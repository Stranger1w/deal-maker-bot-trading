import { useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";

import { cambiarModoCuenta, leerModoCuenta } from "@/lib/modo-cuenta.functions";

/**
 * INTERRUPTOR DEMO / REAL (barra superior).
 *
 * Que sea visible y口红 es a proposito: cambiar a REAL es la decision que
 * mueve dinero de verdad, asi que no puede pasar desapercibida. Verde =
 * DEMO (testnet, no se toca un euro). Rojo = REAL (dinero real).
 *
 * El interruptor NO enciende el trading real por su cuenta: para pasar a
 * REAL hacen falta las dos banderas (allow_real_trading y allow_live_orders)
 * y las credenciales de Binance verificadas. Si faltan, el servidor lo dice
 * con un mensaje claro en vez de dejar medio camino hecho.
 */
export function SwitchModoCuenta({ className }: { className?: string }) {
  const cambiarFn = useServerFn(cambiarModoCuenta);
  const leerFn = useServerFn(leerModoCuenta);
  const [cambiando, setCambiando] = useState(false);

  const estado = useQuery({
    queryKey: ["modo_cuenta"],
    queryFn: () => leerFn({}),
    staleTime: 30_000,
  });

  const pedirCambio = async () => {
    const actual = estado.data?.modo ?? "demo";
    const destino = actual === "demo" ? "real" : "demo";
    if (destino === "real") {
      const ok = window.confirm(
        "Trading REAL: se enviarán órdenes a Binance con dinero de verdad.\n\n" +
          "Si no hay banderas de trading real activadas, el servidor lo rechazará.\n" +
          "¿Continuar?",
      );
      if (!ok) return;
    }
    try {
      setCambiando(true);
      const r = await cambiarFn({ data: { modo: destino } });
      toast.success(
        destino === "real"
          ? "Trading real activado. Ojo: las órdenes van con dinero de verdad."
          : "Vuelves a DEMO (testnet): no se toca dinero real.",
      );
      if (r?.avisos) toast.warning(r.avisos);
      void estado.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar el modo");
    } finally {
      setCambiando(false);
    }
  };

  const modo = estado.data?.modo ?? "demo";
  const esReal = modo === "real";

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void pedirCambio()}
        disabled={cambiando}
        aria-label={
          esReal
            ? "Trading real: pulsa para volver a demo"
            : "Trading en demo: pulsa para ir a real"
        }
        title={
          esReal
            ? "REAL: las órdenes se envían a Binance con dinero de verdad. Pulsa para volver a DEMO."
            : "DEMO (testnet): no se toca dinero real. Pulsa para cambiar a REAL."
        }
        className={[
          "group relative flex h-9 items-center gap-2 rounded-full border px-1.5 pr-3",
          "transition-all duration-500 ease-out focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:opacity-60",
          esReal
            ? "border-destructive/60 bg-destructive/15 shadow-[0_0_18px_-4px] shadow-destructive/60"
            : "border-success/50 bg-success/10 shadow-[0_0_18px_-6px] shadow-success/60",
        ].join(" ")}
      >
        <span
          className={[
            "relative grid size-6 place-items-center rounded-full text-[10px] font-bold",
            "transition-all duration-500 ease-out",
            esReal
              ? "bg-destructive text-destructive-foreground shadow-[0_0_10px_0] shadow-destructive/80"
              : "bg-success text-success-foreground shadow-[0_0_10px_0] shadow-success/80",
          ].join(" ")}
        >
          {esReal ? "R" : "D"}
        </span>
        <span
          className={[
            "text-[11px] font-semibold uppercase tracking-wide transition-colors duration-500",
            esReal ? "text-destructive" : "text-success",
          ].join(" ")}
        >
          {cambiando ? "…" : esReal ? "Real" : "Demo"}
        </span>
        {/* Latido: solo en REAL, para que no pase desapercibido. */}
        {esReal && (
          <span className="pointer-events-none absolute -inset-px animate-ping rounded-full border border-destructive/40" />
        )}
      </button>
    </div>
  );
}
