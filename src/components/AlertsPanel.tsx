import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";

import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dateTime } from "@/lib/format";
import { acknowledgeAlert } from "@/lib/risk.functions";
import { alertsQuery, type Alert } from "@/lib/queries";

const tone = (severity: Alert["severity"]) =>
  severity === "critical" ? "danger" : severity === "warning" ? "warning" : "neutral";

export function AlertsPanel({
  category,
  limit = 6,
  title = "Alertas",
}: {
  /** Filtra por categorías; sin valor muestra todas. */
  category?: string[];
  limit?: number;
  title?: string;
}) {
  const qc = useQueryClient();
  const alerts = useQuery(alertsQuery);
  const ack = useServerFn(acknowledgeAlert);

  const list = (alerts.data ?? [])
    .filter((a) => (category ? category.includes(a.category) : true))
    .slice(0, limit);
  const pending = list.filter((a) => !a.acknowledged).length;

  const acknowledge = async (alertId?: string) => {
    try {
      await ack({ data: alertId ? { alertId, all: false } : { all: true } });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo marcar la alerta");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BellRing className="size-4 text-primary" /> {title}
            <StatusPill tone={pending > 0 ? "warning" : "success"}>
              {pending > 0 ? `${pending} sin revisar` : "todo revisado"}
            </StatusPill>
          </span>
          {pending > 0 && (
            <Button size="sm" variant="ghost" onClick={() => acknowledge()}>
              <Check className="size-3.5" /> Marcar todas
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin alertas registradas.</p>
        )}
        {list.map((a) => (
          <div
            key={a.id}
            className={`rounded-md border px-3 py-2 text-sm ${
              a.acknowledged ? "border-border bg-secondary/30 opacity-70" : "border-border bg-secondary/60"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                <StatusPill tone={tone(a.severity)}>{a.severity}</StatusPill>
                {a.title}
              </span>
              <span className="tabular text-xs text-muted-foreground">{dateTime(a.created_at)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{a.message}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>Entrega: {a.delivery_status === "in_app_only" ? "solo in-app" : a.delivery_status}</span>
              {a.is_demo && <span>Datos demo / seed</span>}
              {!a.acknowledged && (
                <button
                  className="text-primary hover:underline"
                  onClick={() => acknowledge(a.id)}
                  type="button"
                >
                  Marcar revisada
                </button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
