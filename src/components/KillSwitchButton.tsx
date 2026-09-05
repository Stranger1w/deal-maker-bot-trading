import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { OctagonX } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSecuritySession } from "@/hooks/useSecuritySession";
import { triggerKillSwitch } from "@/lib/risk.functions";
import { automationQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Botón de emergencia global: detiene todos los bots y todos los workers. */
export function KillSwitchButton({ className }: { className?: string }) {
  const qc = useQueryClient();
  const settings = useQuery(automationQuery);
  const session = useSecuritySession();
  const trigger = useServerFn(triggerKillSwitch);

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const active = settings.data?.kill_switch === true;

  const confirm = async () => {
    if (reason.trim().length < 3) {
      toast.error("Indica el motivo para la auditoría");
      return;
    }
    setBusy(true);
    try {
      const res = await trigger({
        data: {
          active: !active,
          reason: reason.trim(),
          actor: session.email ?? "operador-no-autenticado",
          confirmed: true,
        },
      });
      toast.success(
        active
          ? "Kill switch desactivado. Reactiva bots y workers manualmente."
          : `Parada de emergencia: ${res.botsStopped} bots y ${res.workersStopped} workers detenidos.`,
      );
      setOpen(false);
      setReason("");
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar la parada");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={active ? "secondary" : "destructive"}
        size="sm"
        onClick={() => setOpen(true)}
        className={cn("gap-2", className)}
        aria-label="Parada de emergencia global"
      >
        <OctagonX className="size-4" />
        <span className="hidden sm:inline">{active ? "Kill switch activo" : "Parada total"}</span>
        <span className="sm:hidden">{active ? "Activo" : "Parar"}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {active ? "Desactivar kill switch" : "Parada de emergencia global"}
            </DialogTitle>
            <DialogDescription>
              {active
                ? "Al desactivarlo el motor sigue detenido: deberás reactivar bots y workers manualmente."
                : "Se detendrán inmediatamente todos los bots (sin abrir nuevas órdenes) y todos los workers de minería. Queda registrado quién, cuándo y por qué."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ks-reason">Motivo (obligatorio, se audita)</Label>
            <Input
              id="ks-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: volatilidad extrema del mercado"
            />
            <p className="text-xs text-muted-foreground">
              Operador: {session.email ?? "sesión no iniciada"}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant={active ? "default" : "destructive"} onClick={confirm} disabled={busy}>
              {active ? "Sí, desactivar" : "Sí, detener todo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function KillSwitchStatus() {
  const settings = useQuery(automationQuery);
  const s = settings.data;
  if (!s) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <StatusPill tone={s.kill_switch ? "danger" : "success"}>
        {s.kill_switch ? "kill switch activo" : "kill switch en reposo"}
      </StatusPill>
      {s.kill_switch && (
        <span>
          {s.kill_switch_actor ?? "operador"} · {s.kill_switch_reason ?? "sin motivo"}
        </span>
      )}
    </div>
  );
}
