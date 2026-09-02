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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createDeposit, createWithdrawal } from "@/lib/dealmaker.functions";
import { dateTime, money } from "@/lib/format";
import { auditQuery, fundsQuery, transactionsQuery } from "@/lib/queries";

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
  const deposit = useServerFn(createDeposit);
  const withdraw = useServerFn(createWithdrawal);

  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] = useState<Method>("transfer");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMethod, setWithdrawMethod] = useState<Method>("wallet");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [twoFactor, setTwoFactor] = useState("");
  const [busy, setBusy] = useState(false);

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
    if (!amount || amount <= 0) return toast.error("Introduce un monto válido");
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
      await withdraw({ data: { amount, method: withdrawMethod, twoFactorCode: twoFactor || undefined } });
      toast.success("Retiro solicitado y registrado en auditoría");
      setWithdrawAmount("");
      setTwoFactor("");
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
    if (!amount || amount <= 0) return toast.error("Introduce un monto válido");
    if (amount > available) return toast.error("El monto supera el saldo disponible");
    setConfirmOpen(true);
  };

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
            <Button onClick={openConfirm} variant="secondary" className="w-full">
              Solicitar retiro
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historial de movimientos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(txs.data ?? []).map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="tabular text-xs">{dateTime(tx.created_at)}</TableCell>
                  <TableCell className="capitalize">
                    {tx.kind === "deposit" ? "Depósito" : "Retiro"}
                  </TableCell>
                  <TableCell>{methodLabels[tx.method]}</TableCell>
                  <TableCell className="tabular text-right">{money(Number(tx.amount))}</TableCell>
                  <TableCell>
                    <StatusPill tone={statusTone(tx.status)}>
                      {tx.status === "pending"
                        ? "Pendiente"
                        : tx.status === "completed"
                          ? "Completado"
                          : "Fallido"}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="tabular text-xs text-muted-foreground">
                    {tx.reference ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
          <div className="space-y-2">
            <Label htmlFor="twofa">Código 2FA (preparado, opcional en MVP)</Label>
            <Input
              id="twofa"
              value={twoFactor}
              onChange={(e) => setTwoFactor(e.target.value)}
              placeholder="000000"
              inputMode="numeric"
            />
          </div>
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
