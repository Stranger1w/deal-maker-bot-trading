import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertsPanel } from "@/components/AlertsPanel";
import { SortableTable, type Column } from "@/components/SortableTable";
import { Switch } from "@/components/ui/switch";
import { useSecuritySession } from "@/hooks/useSecuritySession";
import { createDeposit } from "@/lib/dealmaker.functions";
import { createSecureWithdrawal, saveCapitalPolicy } from "@/lib/risk.functions";
import { dateTime, money } from "@/lib/format";
import {
  auditQuery,
  automationQuery,
  fundsQuery,
  transactionsQuery,
  type FundTransaction,
} from "@/lib/queries";

export const Route = createFileRoute("/fondos")({
  head: () => ({
    meta: [
      { title: "Fondos — Deal Maker" },
      {
        name: "description",
        content:
          "Saldo disponible y en uso por bots, depósitos, retiros con confirmación y auditoría de movimientos.",
      },
      { property: "og:title", content: "Fondos — Deal Maker" },
      {
        property: "og:description",
        content: "Control de tesorería: depósitos, retiros validados y registro de auditoría.",
      },
    ],
  }),
  component: FondosPage,
});

type Method = "transfer" | "wallet" | "onchain";
const methodLabels: Record<Method, string> = {
  transfer: "Transferencia",
  wallet: "Wallet interna",
  onchain: "On-chain",
};

function FondosPage() {
  const qc = useQueryClient();
  const account = useQuery(fundsQuery);
  const txs = useQuery(transactionsQuery);
  const audit = useQuery(auditQuery);
  const settings = useQuery(automationQuery);
  const session = useSecuritySession();
  const deposit = useServerFn(createDeposit);
  const withdraw = useServerFn(createSecureWithdrawal);
  const savePolicy = useServerFn(saveCapitalPolicy);

  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<Method>("transfer");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState<Method>("wallet");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [policy, setPolicy] = useState<{
    profitPolicy: "reinvest" | "reserve";
    profitReservePct: string;
    notifyEmail: string;
    notifyEmailEnabled: boolean;
  } | null>(null);

  const currentPolicy = policy ?? {
    profitPolicy: (settings.data?.profit_policy ?? "reinvest") as "reinvest" | "reserve",
    profitReservePct: String(settings.data?.profit_reserve_pct ?? 20),
    notifyEmail: settings.data?.notify_email ?? "",
    notifyEmailEnabled: settings.data?.notify_email_enabled ?? false,
  };

  const available = Number(account.data?.available_balance ?? 0);
  const inUse = Number(account.data?.in_use_balance ?? 0);
  const total = available + inUse;
  const usage = total > 0 ? (inUse / total) * 100 : 0;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["fund_account"] });
    void qc.invalidateQueries({ queryKey: ["fund_transactions"] });
    void qc.invalidateQueries({ queryKey: ["audit_events"] });
  };

  const submitDeposit = async () => {
    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      toast.error("Introduce un monto válido");
      return;
    }
    setBusy(true);
    try {
      await deposit({ data: { amount, method: depositMethod } });
      toast.success("Depósito registrado en estado pendiente");
      setDepositAmount("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo registrar el depósito");
    } finally {
      setBusy(false);
    }
  };

  const submitWithdrawal = async () => {
    const amount = Number(withdrawAmount);
    setBusy(true);
    try {
      await withdraw({ data: { amount, method: withdrawMethod, confirmed: true } });
      toast.success("Retiro solicitado y registrado en auditoría");
      setWithdrawAmount("");
      setConfirmOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo procesar el retiro");
    } finally {
      setBusy(false);
    }
  };

  const openConfirm = () => {
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) {
      toast.error("Introduce un monto válido");
      return;
    }
    if (amount > available) {
      toast.error("El monto supera el saldo disponible");
      return;
    }
    if (!session.twoFactorVerified) {
      toast.error("Los retiros exigen sesión iniciada con 2FA verificada (Acceso y 2FA).");
      return;
    }
    setConfirmOpen(true);
  };

  const submitPolicy = async () => {
    setBusy(true);
    try {
      await savePolicy({
        data: {
          profitPolicy: currentPolicy.profitPolicy,
          profitReservePct: Number(currentPolicy.profitReservePct) || 0,
          notifyEmail: currentPolicy.notifyEmail,
          notifyEmailEnabled: currentPolicy.notifyEmailEnabled,
        },
      });
      toast.success("Política de capital y avisos guardada");
      void qc.invalidateQueries({ queryKey: ["automation_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la política");
    } finally {
      setBusy(false);
    }
  };

  const txList = txs.data ?? [];
  const term = search.trim().toLowerCase();
  const filteredTxs = term
    ? txList.filter((t) =>
        [t.kind, t.method, t.status, t.reference ?? ""].join(" ").toLowerCase().includes(term),
      )
    : txList;

  // Saldo acumulado (resultado) recalculado sobre los movimientos mostrados.
  const runningBalance = new Map<string, number>();
  {
    const chronological = [...txList].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    let acc = 0;
    for (const t of chronological) {
      if (t.status !== "failed") acc += t.kind === "deposit" ? Number(t.amount) : -Number(t.amount);
      runningBalance.set(t.id, Number(acc.toFixed(2)));
    }
  }

  const txColumns: Column<FundTransaction>[] = [
    {
      key: "created_at",
      label: "Fecha",
      value: (t) => new Date(t.created_at).getTime(),
      render: (t) => <span className="tabular text-xs">{dateTime(t.created_at)}</span>,
    },
    {
      key: "kind",
      label: "Tipo",
      value: (t) => t.kind,
      render: (t) => (t.kind === "deposit" ? "Depósito" : "Retiro"),
    },
    {
      key: "method",
      label: "Método",
      value: (t) => t.method,
      render: (t) => methodLabels[t.method],
    },
    {
      key: "amount",
      label: "Monto",
      align: "right",
      value: (t) => Number(t.amount),
      render: (t) => (
        <span className={t.kind === "deposit" ? "text-success" : "text-destructive"}>
          {t.kind === "deposit" ? "+" : "−"}
          {money(Number(t.amount))}
        </span>
      ),
    },
    {
      key: "balance",
      label: "Saldo resultante",
      align: "right",
      value: (t) => runningBalance.get(t.id) ?? 0,
      render: (t) => money(runningBalance.get(t.id) ?? 0),
    },
    {
      key: "status",
      label: "Estado",
      value: (t) => t.status,
      render: (t) => (
        <StatusPill tone={statusTone(t.status)}>
          {t.status === "pending" ? "Pendiente" : t.status === "completed" ? "Completado" : "Fallido"}
        </StatusPill>
      ),
    },
    {
      key: "reference",
      label: "Referencia",
      value: (t) => t.reference ?? "",
      render: (t) => (
        <span className="tabular text-xs text-muted-foreground">{t.reference ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fondos"
        subtitle="Tesorería operativa: saldo libre, capital comprometido por bots activos y trazabilidad completa de cada movimiento."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Saldo disponible
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold text-success">{money(available)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              En uso por bots activos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold text-warning">{money(inUse)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{usage.toFixed(1)}% del capital total</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Capital total</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-semibold">{money(total)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Depósito</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dep-amount">Monto (USDT)</Label>
              <Input
                id="dep-amount"
                inputMode="decimal"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="1000.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Método</Label>
              <Select value={depositMethod} onValueChange={(v) => setDepositMethod(v as Method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={submitDeposit} disabled={busy} className="w-full">
              Registrar depósito
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retiro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wd-amount">Monto (USDT)</Label>
              <Input
                id="wd-amount"
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="500.00"
              />
              <p className="text-xs text-muted-foreground">Disponible: {money(available)}</p>
            </div>
            <div className="space-y-2">
              <Label>Método</Label>
              <Select value={withdrawMethod} onValueChange={(v) => setWithdrawMethod(v as Method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs">
              {session.twoFactorVerified ? (
                <span className="text-success">2FA verificada: retiros habilitados.</span>
              ) : (
                <span className="text-warning">
                  Retiros bloqueados: inicia sesión y verifica tu segundo factor en “Acceso y 2FA”.
                  No se acepta ningún código sin autenticación real.
                </span>
              )}
            </div>
            <Button
              onClick={openConfirm}
              variant="secondary"
              className="w-full"
              disabled={!session.twoFactorVerified}
            >
              Solicitar retiro
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            Historial de movimientos
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar tipo, método, estado o referencia"
              className="max-w-xs"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={filteredTxs}
            rowKey={(t) => t.id}
            initialSort={{ key: "created_at", dir: "desc" }}
            columns={txColumns}
            empty="Sin movimientos registrados."
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Política de capital y avisos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Ganancias semanales</Label>
              <Select
                value={currentPolicy.profitPolicy}
                onValueChange={(v) =>
                  setPolicy({ ...currentPolicy, profitPolicy: v as "reinvest" | "reserve" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reinvest">Reinvertir automáticamente</SelectItem>
                  <SelectItem value="reserve">Reservar % como saldo disponible</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reserve-pct">% de la ganancia semanal a reservar</Label>
              <Input
                id="reserve-pct"
                inputMode="decimal"
                value={currentPolicy.profitReservePct}
                onChange={(e) => setPolicy({ ...currentPolicy, profitReservePct: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notify-email">Correo para reportes y alertas</Label>
              <Input
                id="notify-email"
                type="email"
                value={currentPolicy.notifyEmail}
                onChange={(e) => setPolicy({ ...currentPolicy, notifyEmail: e.target.value })}
                placeholder="operaciones@tudominio.com"
              />
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Envío por email: requiere dominio de envío verificado. Hasta entonces las alertas
                  quedan solo in-app y los reportes marcados como pendientes; no se simulan entregas.
                </span>
                <Switch
                  checked={currentPolicy.notifyEmailEnabled}
                  onCheckedChange={(v) => setPolicy({ ...currentPolicy, notifyEmailEnabled: v })}
                  aria-label="Activar avisos por email"
                />
              </div>
            </div>
            <Button onClick={submitPolicy} disabled={busy} className="w-full">
              Guardar política
            </Button>
            <p className="text-xs text-muted-foreground">
              La regla se ejecuta en el backend programado con auditoría. Nunca realiza retiros
              externos automáticos. Último barrido: {settings.data?.last_profit_sweep_on ?? "sin ejecutar"}.
            </p>
          </CardContent>
        </Card>

        <AlertsPanel title="Alertas de fondos" category={["funds", "security"]} limit={6} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" /> Auditoría de acciones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(audit.data ?? []).map((event) => (
            <div
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
            >
              <span className="tabular text-xs text-muted-foreground">
                {dateTime(event.created_at)}
              </span>
              <span className="font-medium">{event.action}</span>
              <span className="text-xs text-muted-foreground">{event.entity_id ?? event.entity}</span>
              <span className="tabular text-xs text-muted-foreground">
                {JSON.stringify(event.details)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar retiro</DialogTitle>
            <DialogDescription>
              Vas a retirar {money(Number(withdrawAmount || 0))} mediante{" "}
              {methodLabels[withdrawMethod]}. Esta acción queda registrada en la auditoría.
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
            Autorizado con la sesión de {session.email} y segundo factor TOTP verificado. El backend
            vuelve a validar la 2FA antes de registrar el retiro.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitWithdrawal} disabled={busy}>
              Confirmar retiro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
