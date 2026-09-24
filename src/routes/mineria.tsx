import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  Cpu,
  PlugZap,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Unplug,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatusPill, statusTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { LocalMiningPanel } from "@/components/LocalMiningPanel";
import { SortableTable, type Column } from "@/components/SortableTable";
import {
  connectWorkerPool,
  createMiningSandbox,
  createWorker,
  disconnectWorkerPool,
  listWorkerPoolStatus,
  promoteMiningRun,
  runMiningSandbox,
  setWorkerStatus,
  syncWorkerPoolStats,
  validateMoneroPoolWallet,
} from "@/lib/dealmaker.functions";
import {
  coinAmount,
  dateTime,
  hashrate as formatHashrate,
  money,
  sinceLabel,
  uptime,
} from "@/lib/format";
import {
  moneroAddressKindLabel,
  shortMoneroAddress,
  validateMoneroAddress,
} from "@/lib/monero-address";
import {
  NANOPOOL_ID,
  NANOPOOL_LABEL,
  NANOPOOL_XMR_STRATUM,
  XMR,
  XMR_REFRESH_DEFAULT_MS,
  XMR_REFRESH_OPTIONS,
  XMR_REFRESH_STORAGE_KEY,
  xmrigCommand,
} from "@/lib/nanopool-xmr";
import {
  miningRunsQuery,
  miningSandboxesQuery,
  payoutsQuery,
  workersQuery,
  type MiningSandbox,
  type Payout,
  type Worker,
} from "@/lib/queries";

export const Route = createFileRoute("/mineria")({
  head: () => ({
    meta: [
      { title: "Minería real de Monero (XMR) — Deal Maker" },
      {
        name: "description",
        content:
          "Minería real de Monero (XMR) en CPU con Nanopool: valida tu wallet y consulta hashrate, saldo, pagos y workers reales. Modo demo separado del minado real.",
      },
      { property: "og:title", content: "Minería real de Monero (XMR) — Deal Maker" },
      {
        property: "og:description",
        content:
          "Hashrate, saldo y pagos reales de tu wallet XMR en Nanopool, con el entrenamiento simulado aparte.",
      },
    ],
  }),
  component: MiningPage,
});

/** Estado de pool por worker (respuesta de `listWorkerPoolStatus`). */
type PoolStatus = {
  workerId: string;
  pool: string;
  label: string;
  coin: string;
  uidLast4: string;
  uidShort: string;
  /** Solo XMR: wallet completa para generar el comando de XMRig. */
  wallet: string | null;
  workerName: string | null;
  addressKind: string | null;
  connectedAt: string | null;
  mode: "xmr-real" | "pool-generic";
  hashrate: number | null;
  hashrate24h: number | null;
  balance: number | null;
  paidTotal: number | null;
  paidLast24h: number | null;
  workersActive: number | null;
  lastShareAt: string | null;
  accountExists: boolean | null;
  hasActivity: boolean | null;
  activityNote: string | null;
  dailyEarnings: number | null;
  earningsSource: string | null;
  usdPrice: number | null;
  lastSyncAt: string | null;
};

/** Cifras reales que pinta el panel (misma forma que `MoneroPoolOverview`). */
type RealStats = {
  hashrate: number;
  hashrate24h: number;
  balance: number;
  unconfirmed: number;
  paidTotal: number;
  paidLast24h: number;
  paymentsCount: number;
  workersActive: number;
  accountExists: boolean;
  hasActivity: boolean;
  activityNote: string | null;
  lastShareAt: string | null;
  dailyEarnings: number | null;
  earningsSource: string | null;
  poolHashrate: number | null;
  poolActiveWorkers: number | null;
  userEndpointWorking: boolean;
  payments: { txHash: string; amount: number; date: string; confirmed: boolean }[];
  history: { date: string; hashrate: number }[];
  fetchedAt: string;
};

const POOL_OPTIONS: { id: string; label: string; coins: string[]; hint: string }[] = [
  {
    id: NANOPOOL_ID,
    label: NANOPOOL_LABEL,
    coins: [XMR],
    hint: "Monero real por CPU con XMRig (RandomX).",
  },
  {
    id: "hiveon",
    label: "Hiveon Pool (legado · GPU/ASIC)",
    coins: ["ETC"],
    hint: "Requiere hardware dedicado: no se puede minar en CPU.",
  },
];

const COIN_OPTIONS: { id: string; label: string }[] = [
  { id: XMR, label: "XMR — Monero (RandomX · solo CPU)" },
  { id: "ETC", label: "ETC — Ethereum Classic (GPU/ASIC)" },
];

const refreshLabel = (ms: number) =>
  XMR_REFRESH_OPTIONS.find((option) => option.value === ms)?.label ??
  `Cada ${Math.round(ms / 60000)} min`;

/** Preferencia de refresco (1-5 min) guardada en el navegador. */
function readStoredRefreshMs(): number {
  if (typeof window === "undefined") return XMR_REFRESH_DEFAULT_MS;
  const raw = Number(window.localStorage.getItem(XMR_REFRESH_STORAGE_KEY));
  return XMR_REFRESH_OPTIONS.some((option) => option.value === raw) ? raw : XMR_REFRESH_DEFAULT_MS;
}

/** Re-render periódico solo para refrescar los textos "hace X min". */
function useTicker(ms = 30000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Cifras reales a partir de la última fotografía guardada (mientras llega la nueva). */
function realFromStatus(status: PoolStatus): RealStats {
  return {
    hashrate: status.hashrate ?? 0,
    hashrate24h: status.hashrate24h ?? status.hashrate ?? 0,
    balance: status.balance ?? 0,
    unconfirmed: 0,
    paidTotal: status.paidTotal ?? 0,
    paidLast24h: status.paidLast24h ?? 0,
    paymentsCount: 0,
    workersActive: status.workersActive ?? 0,
    accountExists: status.accountExists ?? false,
    hasActivity: status.hasActivity ?? false,
    activityNote: status.activityNote,
    lastShareAt: status.lastShareAt,
    dailyEarnings: status.dailyEarnings,
    earningsSource: status.earningsSource,
    poolHashrate: null,
    poolActiveWorkers: null,
    userEndpointWorking: false,
    payments: [],
    history: [],
    fetchedAt: status.lastSyncAt ?? status.connectedAt ?? new Date().toISOString(),
  };
}

/** Campos que el panel usa de la respuesta real de Nanopool (vista estructural). */
type OverviewLike = {
  hashrate: number;
  avgHashrate: { h24: number };
  balance: number;
  unconfirmed: number;
  paidTotal: number;
  paidLast24h: number;
  paymentsCount: number;
  workersActive: number;
  accountExists: boolean;
  hasActivity: boolean;
  activityNote: string | null;
  lastShareAt: string | null;
  poolHashrate: number | null;
  poolActiveWorkers: number | null;
  userEndpointWorking: boolean;
  payments: { txHash: string; amount: number; date: string; confirmed: boolean }[];
  history: { date: string; hashrate: number }[];
  fetchedAt: string;
};

/** Mezcla la lectura recién traída de Nanopool con la última fotografía guardada. */
function realFromOverview(
  overview: OverviewLike,
  previous: RealStats,
  earnings: { dailyEarnings: number | null; source: string | null },
): RealStats {
  return {
    ...previous,
    hashrate: overview.hashrate,
    hashrate24h: overview.avgHashrate.h24 || overview.hashrate,
    balance: overview.balance,
    unconfirmed: overview.unconfirmed,
    paidTotal: overview.paidTotal,
    paidLast24h: overview.paidLast24h,
    paymentsCount: overview.paymentsCount,
    workersActive: overview.workersActive,
    accountExists: overview.accountExists,
    hasActivity: overview.hasActivity,
    activityNote: overview.activityNote,
    lastShareAt: overview.lastShareAt,
    poolHashrate: overview.poolHashrate,
    poolActiveWorkers: overview.poolActiveWorkers,
    userEndpointWorking: overview.userEndpointWorking,
    payments: overview.payments,
    history: overview.history,
    fetchedAt: overview.fetchedAt,
    dailyEarnings: earnings.dailyEarnings ?? previous.dailyEarnings,
    earningsSource: earnings.source ?? previous.earningsSource,
  };
}

/** Comando de XMRig listo para pegar, con servidor/puerto de Nanopool y copia rápida. */
function XmrigCommandPanel({ wallet, rigName }: { wallet: string | null; rigName: string }) {
  const [serverIndex, setServerIndex] = useState(0);
  const [tls, setTls] = useState(false);
  const [copied, setCopied] = useState(false);
  const server = NANOPOOL_XMR_STRATUM.servers[serverIndex] ?? NANOPOOL_XMR_STRATUM.servers[0];
  const port = tls ? NANOPOOL_XMR_STRATUM.tlsPort : NANOPOOL_XMR_STRATUM.port;
  const command = wallet
    ? xmrigCommand({ wallet, workerName: rigName, host: server?.host ?? "", port, tls })
    : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success("Comando de XMRig copiado");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar: selecciona el texto y cópialo a mano");
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-border bg-background/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Conectar XMRig (CPU) a esta wallet
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(serverIndex)}
          onValueChange={(value) => setServerIndex(Number(value))}
        >
          <SelectTrigger className="h-8 w-[210px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NANOPOOL_XMR_STRATUM.servers.map((item, index) => (
              <SelectItem key={item.host} value={String(index)}>
                {item.region} · {item.host}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tls ? "tls" : "plain"} onValueChange={(value) => setTls(value === "tls")}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Puerto {NANOPOOL_XMR_STRATUM.port}</SelectItem>
            <SelectItem value="tls">TLS · puerto {NANOPOOL_XMR_STRATUM.tlsPort}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <pre className="overflow-x-auto rounded bg-secondary/60 p-2 text-[11px] leading-relaxed">
        {command || "Conecta la wallet para generar el comando de XMRig."}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!command} onClick={copy}>
          {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />} Copiar
          comando
        </Button>
        <span className="text-xs text-muted-foreground">
          {NANOPOOL_XMR_STRATUM.algorithm} · el minero lo ejecutas tú; la app solo lee tus datos
          reales.
        </span>
      </div>
    </div>
  );
}

/** Mini-gráfico del hashrate real de las últimas 24 h (una muestra cada 10 min). */
function HashrateSpark({ points }: { points: { date: string; hashrate: number }[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points.map((point) => point.hashrate), 1);
  const width = 100;
  const height = 28;
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - (point.hashrate / max) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-10 w-full">
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
      </svg>
      <p className="text-[11px] text-muted-foreground">
        Hashrate real de las últimas 24 h (máximo {formatHashrate(max)}) · {points.length} muestras
        de 10 min
      </p>
    </div>
  );
}

/** Cuadro compacto con una métrica real de la pool. */
function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="rounded-md border border-border bg-background/60 px-2.5 py-2">
      <p className="text-[11px] uppercase text-muted-foreground">{label}</p>
      <p className="tabular text-sm font-semibold">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Worker conectado a Nanopool XMR: datos reales de la pool, refresco cada 1-5 min
 * (Nanopool no publica en tiempo real) y aviso explícito cuando la wallet todavía
 * no tiene un minero reportando hashrate.
 */
function MoneroRealPanel({
  worker,
  status,
  onDone,
}: {
  worker: Worker;
  status: PoolStatus;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const sync = useServerFn(syncWorkerPoolStats);
  const disconnect = useServerFn(disconnectWorkerPool);
  const [refreshMs, setRefreshMs] = useState(readStoredRefreshMs);
  const [busy, setBusy] = useState(false);
  useTicker();

  const live = useQuery({
    queryKey: ["xmr_pool_sync", worker.id],
    queryFn: () => sync({ data: { workerId: worker.id } }),
    refetchInterval: refreshMs,
    refetchIntervalInBackground: false,
    staleTime: Math.max(refreshMs - 15000, 20000),
    retry: 0,
  });

  const stored = realFromStatus(status);
  const synced = live.data ?? null;
  const real = synced?.monero
    ? realFromOverview(synced.monero, stored, {
        dailyEarnings: synced.dailyEarnings,
        source: synced.earningsSource ?? null,
      })
    : stored;
  const pollError = live.error instanceof Error ? live.error.message : null;

  const changeInterval = (value: string) => {
    const ms = Number(value);
    setRefreshMs(ms);
    try {
      window.localStorage.setItem(XMR_REFRESH_STORAGE_KEY, String(ms));
    } catch {
      /* sin almacenamiento: se aplica solo en esta sesión */
    }
  };

  const refreshNow = async () => {
    setBusy(true);
    try {
      const result = await live.refetch();
      if (result.data) {
        toast.success(
          result.data.monero?.hasActivity
            ? `Datos reales actualizados · ${formatHashrate(result.data.hashrate)} · ${coinAmount(result.data.accrued)}`
            : "Sincronizado: la wallet sigue sin minero reportando.",
        );
      }
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo sincronizar");
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setBusy(true);
    try {
      await disconnect({ data: { workerId: worker.id } });
      qc.removeQueries({ queryKey: ["xmr_pool_sync", worker.id] });
      toast.success("Worker desconectado: vuelve al modo demo (entrenamiento simulado)");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo desconectar");
    } finally {
      setBusy(false);
    }
  };

  const earningsHint =
    real.dailyEarnings === null
      ? "Se calcula con los pagos reales o el aumento de saldo entre lecturas"
      : real.earningsSource === "pagos"
        ? "Suma de pagos reales de las últimas 24 h"
        : "Estimado con el aumento real de saldo entre dos lecturas";

  return (
    <div className="space-y-3 rounded-md border border-success/30 bg-success/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="success">Pool real · {status.label}</StatusPill>
        <StatusPill tone="neutral">Sin simulación</StatusPill>
        {!real.hasActivity && <StatusPill tone="warning">Sin actividad</StatusPill>}
        <span className="text-xs text-muted-foreground">
          {status.uidShort} · {moneroAddressKindLabel(status.addressKind)} · rig{" "}
          {status.workerName ?? worker.name}
        </span>
      </div>

      {real.hasActivity ? (
        <p className="text-xs text-muted-foreground">
          Lectura directa de las rutas públicas de Nanopool · actualización automática{" "}
          {refreshLabel(refreshMs).toLowerCase()}.
        </p>
      ) : (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5">
          <p className="text-sm font-medium text-warning">
            Sin actividad — conecta un minero (XMRig) a esta wallet
          </p>
          <p className="text-xs text-muted-foreground">
            {real.activityNote ??
              "Nanopool todavía no recibe shares de esta wallet, así que no hay hashrate ni ganancias que mostrar."}
          </p>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <MetricTile label="Hashrate actual" value={formatHashrate(real.hashrate)} />
        <MetricTile label="Media 24 h" value={formatHashrate(real.hashrate24h)} />
        <MetricTile label="Saldo pendiente" value={coinAmount(real.balance)} />
        <MetricTile
          label="Ganancia real / día"
          value={real.dailyEarnings === null ? "Sin datos aún" : coinAmount(real.dailyEarnings)}
          hint={earningsHint}
        />
        <MetricTile
          label="Total pagado"
          value={coinAmount(real.paidTotal)}
          hint={`${real.paymentsCount} pago(s) registrados${
            real.paidLast24h > 0 ? ` · ${coinAmount(real.paidLast24h)} en 24 h` : ""
          }`}
        />
        <MetricTile
          label="Workers activos"
          value={String(real.workersActive)}
          hint={
            real.lastShareAt ? `último share ${sinceLabel(real.lastShareAt)}` : "sin shares todavía"
          }
        />
      </div>

      <HashrateSpark points={real.history} />

      {pollError && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          No se pudo leer Nanopool en la última actualización ({pollError}). Se reintentará
          automáticamente; las cifras de arriba son la última lectura guardada.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={refreshNow}>
          <RefreshCw className="size-3.5" /> Sincronizar ahora
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={leave}>
          <Unplug className="size-3.5" /> Desconectar (volver a demo)
        </Button>
        <Select value={String(refreshMs)} onValueChange={changeInterval}>
          <SelectTrigger className="h-8 w-[210px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {XMR_REFRESH_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Última lectura {sinceLabel(real.fetchedAt)}
          {real.poolHashrate
            ? ` · pool ${formatHashrate(real.poolHashrate)} · ${real.poolActiveWorkers ?? 0} workers`
            : ""}
        </span>
      </div>

      {real.payments.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pagos reales de la pool
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="border-b border-border bg-secondary/60 text-left">
                  <th className="px-2 py-1.5">Fecha</th>
                  <th className="px-2 py-1.5 text-right">XMR</th>
                  <th className="px-2 py-1.5 text-right">USD estimado</th>
                  <th className="px-2 py-1.5">Transacción</th>
                  <th className="px-2 py-1.5">Estado</th>
                </tr>
              </thead>
              <tbody>
                {real.payments.slice(0, 8).map((payment) => (
                  <tr key={payment.txHash} className="border-b border-border/60 last:border-0">
                    <td className="px-2 py-1.5">{dateTime(payment.date)}</td>
                    <td className="tabular px-2 py-1.5 text-right">{payment.amount.toFixed(8)}</td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {status.usdPrice ? money(payment.amount * status.usdPrice, "USD") : "—"}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[10px]">
                      {payment.txHash.slice(0, 12)}…
                    </td>
                    <td className="px-2 py-1.5">
                      {payment.confirmed ? "confirmado" : "pendiente"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            USD estimado con el último precio XMR/USD leído (Kraken). Los pagos quedan además
            guardados en «Historial de pagos», al final de la página.
          </p>
        </div>
      )}

      <XmrigCommandPanel wallet={status.wallet} rigName={status.workerName ?? worker.name} />
    </div>
  );
}

/** Worker conectado a una pool que no es Monero (legado): sincronizar y desconectar. */
function LegacyPoolPanel({
  worker,
  status,
  onDone,
}: {
  worker: Worker;
  status: PoolStatus;
  onDone: () => void;
}) {
  const sync = useServerFn(syncWorkerPoolStats);
  const disconnect = useServerFn(disconnectWorkerPool);
  const [busy, setBusy] = useState(false);

  const run = async (kind: "sync" | "disconnect") => {
    setBusy(true);
    try {
      if (kind === "sync") {
        const result = await sync({ data: { workerId: worker.id } });
        toast.success(`Datos reales actualizados · ${coinAmount(result.accrued, result.coin)}`);
      } else {
        await disconnect({ data: { workerId: worker.id } });
        toast.success("Worker devuelto al entrenamiento (simulado)");
      }
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la operación");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="success">Pool real · {status.label}</StatusPill>
        <span className="text-xs text-muted-foreground">
          UID ••••{status.uidLast4} · {status.coin}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Este worker no usa Monero: el hashrate viene de la API pública de la pool y las ganancias se
        calculan con el aumento de saldo entre lecturas (nunca con el simulador).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("sync")}>
          <RefreshCw className="size-3.5" /> Sincronizar datos reales
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("disconnect")}>
          <Unplug className="size-3.5" /> Desconectar
        </Button>
      </div>
    </div>
  );
}

/**
 * Conexión del worker a su pool real. Sin pool conectada el worker está en modo demo
 * (entrenamiento simulado); con pool conectada solo se muestran datos reales.
 */
function PoolConnection({
  worker,
  status,
  onDone,
}: {
  worker: Worker;
  status: PoolStatus | undefined;
  onDone: () => void;
}) {
  if (!status) return <DemoConnectForm worker={worker} onDone={onDone} />;
  return status.mode === "xmr-real" ? (
    <MoneroRealPanel worker={worker} status={status} onDone={onDone} />
  ) : (
    <LegacyPoolPanel worker={worker} status={status} onDone={onDone} />
  );
}
/**
 * Formulario de conexión a Nanopool XMR: valida la dirección Monero en local
 * (formato, longitud y checksum), la comprueba contra la API pública de la pool y
 * deja claro que sin conectar el worker sigue en modo demo.
 */
function DemoConnectForm({ worker, onDone }: { worker: Worker; onDone: () => void }) {
  const connect = useServerFn(connectWorkerPool);
  const validate = useServerFn(validateMoneroPoolWallet);
  const [pool, setPool] = useState(NANOPOOL_ID);
  const [wallet, setWallet] = useState("");
  const [rigName, setRigName] = useState(worker.name);
  const [coin, setCoin] = useState(XMR);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{
    ok: boolean;
    message: string;
    detail: string | null;
  } | null>(null);

  const meta = POOL_OPTIONS.find((option) => option.id === pool) ?? POOL_OPTIONS[0];
  const local = validateMoneroAddress(wallet);
  const entered = wallet.trim().length > 0;

  const runValidation = async () => {
    if (!local.ok) {
      setCheck({ ok: false, message: local.message, detail: null });
      return;
    }
    setChecking(true);
    try {
      const result = await validate({ data: { wallet: wallet.trim() } });
      if (!result.ok) {
        setCheck({
          ok: false,
          message: result.error ?? "Nanopool no devolvió datos.",
          detail: null,
        });
      } else if (result.overview?.hasActivity) {
        setCheck({
          ok: true,
          message: "Wallet válida y con actividad real en Nanopool.",
          detail: `Hashrate ${formatHashrate(result.overview.hashrate)} · saldo ${coinAmount(result.overview.balance)}`,
        });
      } else {
        setCheck({
          ok: true,
          message: "Wallet válida, todavía sin actividad en Nanopool.",
          detail: result.overview?.activityNote ?? null,
        });
      }
    } catch (error) {
      setCheck({
        ok: false,
        message: error instanceof Error ? error.message : "No se pudo validar la wallet",
        detail: null,
      });
    } finally {
      setChecking(false);
    }
  };

  const runConnect = async () => {
    setBusy(true);
    try {
      const result = await connect({
        data: {
          workerId: worker.id,
          pool,
          uid: wallet.trim(),
          coin,
          workerName: rigName.trim() || undefined,
        },
      });
      const payload = "sync" in result ? result.sync : null;
      if (payload && !payload.monero?.hasActivity) {
        toast.success(
          "Wallet conectada a Nanopool XMR. Sin actividad todavía: arranca XMRig para ver hashrate real.",
        );
      } else {
        toast.success(
          `Conectado a ${result.config.label} · ${formatHashrate(payload?.hashrate ?? 0)} reales`,
        );
      }
      setWallet("");
      setCheck(null);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo conectar a la pool");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-secondary/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone="warning">Modo demo · entrenamiento simulado</StatusPill>
        <span className="text-xs text-muted-foreground">
          Sin pool conectada, las cifras de este worker son simuladas. Al conectar la wallet se
          sustituyen por datos reales de la pool.
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Pool</Label>
          <Select
            value={pool}
            onValueChange={(value) => {
              setPool(value);
              const next = POOL_OPTIONS.find((option) => option.id === value);
              const first = next?.coins[0];
              if (next && first && !next.coins.includes(coin.toUpperCase())) setCoin(first);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POOL_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{meta?.hint}</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Moneda</Label>
          <Select value={coin.toUpperCase()} onValueChange={setCoin}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COIN_OPTIONS.filter((option) => (meta?.coins ?? [XMR]).includes(option.id)).map(
                (option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            XMR se mina en CPU con XMRig (RandomX); el resto exige hardware dedicado.
          </p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Wallet XMR (dirección Monero)</Label>
          <Input
            value={wallet}
            onChange={(event) => {
              setWallet(event.target.value);
              setCheck(null);
            }}
            placeholder="4A… (95 caracteres, empieza por 4 u 8)"
          />
          {entered && (
            <p className={`text-xs ${local.ok ? "text-success" : "text-warning"}`}>
              {local.ok
                ? `${local.message} Tipo: ${moneroAddressKindLabel(local.kind)}.`
                : local.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Nombre del rig (opcional)</Label>
          <Input
            value={rigName}
            onChange={(event) => setRigName(event.target.value)}
            placeholder="rig-norte-01"
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!local.ok || checking}
            onClick={runValidation}
          >
            {checking ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}{" "}
            Validar en Nanopool
          </Button>
          <Button size="sm" disabled={!local.ok || busy} onClick={runConnect}>
            <PlugZap className="size-3.5" /> Conectar pool real
          </Button>
        </div>
      </div>

      {check && (
        <p
          className={`flex items-start gap-1.5 text-xs ${check.ok ? "text-success" : "text-warning"}`}
        >
          {check.ok ? (
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>
            {check.message}
            {check.detail ? ` · ${check.detail}` : ""}
          </span>
        </p>
      )}

      {local.ok && <XmrigCommandPanel wallet={local.address} rigName={rigName || worker.name} />}

      <p className="text-xs text-muted-foreground">
        Endpoints públicos consultados: <span className="font-mono text-[10px]">/v1/xmr/user</span>,{" "}
        <span className="font-mono text-[10px]">/v1/xmr/hashrate</span>,{" "}
        <span className="font-mono text-[10px]">/v1/xmr/balance</span> y{" "}
        <span className="font-mono text-[10px]">/v1/xmr/payments</span> (más{" "}
        <span className="font-mono text-[10px]">/accountexist</span>,{" "}
        <span className="font-mono text-[10px]">/workers</span> y{" "}
        <span className="font-mono text-[10px]">/history</span>). Si la pool no responde se avisa y
        se mantiene la última lectura real: nunca se inventan cifras.
      </p>
    </div>
  );
}

function MiningPage() {
  const qc = useQueryClient();
  const workers = useQuery(workersQuery);
  const payouts = useQuery(payoutsQuery);
  const poolStatus = useQuery({
    queryKey: ["mining_pool_status"],
    queryFn: () => listWorkerPoolStatus(),
    staleTime: 15000,
  });
  const poolByWorker = new Map(
    (poolStatus.data ?? []).map((row) => [row.workerId, row as PoolStatus]),
  );
  const control = useServerFn(setWorkerStatus);
  const create = useServerFn(createWorker);

  const [form, setForm] = useState({ name: "", coin: XMR, pool: NANOPOOL_LABEL, rigId: "" });
  const [search, setSearch] = useState("");

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["mining_workers"] });
    void qc.invalidateQueries({ queryKey: ["mining_pool_status"] });
  };

  const list = workers.data ?? [];
  /** Workers con pool real conectada (cifras reales de la API de la pool). */
  const poolRows = list
    .map((worker) => poolByWorker.get(worker.id))
    .filter((row): row is PoolStatus => Boolean(row));
  const xmrWorkers = poolRows.filter((row) => row.mode === "xmr-real");
  /** Workers sin pool: sus cifras son simuladas (entrenamiento). */
  const demoWorkers = list.filter((worker) => !poolByWorker.has(worker.id));
  const realHashrate = xmrWorkers.reduce((sum, row) => sum + (row.hashrate ?? 0), 0);
  const realDailyEarnings = xmrWorkers.reduce((sum, row) => sum + (row.dailyEarnings ?? 0), 0);
  const realPaidTotal = xmrWorkers.reduce((sum, row) => sum + (row.paidTotal ?? 0), 0);
  const usdPrice = xmrWorkers.find((row) => row.usdPrice)?.usdPrice ?? null;
  const demoDailyEarnings = demoWorkers.reduce(
    (sum, worker) => sum + Number(worker.estimated_daily_earnings),
    0,
  );

  const act = async (action: "start" | "stop" | "restart", workerId?: string) => {
    try {
      await control({ data: { action, ...(workerId ? { workerId } : {}) } });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Acción fallida");
    }
  };

  const addWorker = async () => {
    if (form.name.trim().length < 2 || !form.pool || !form.rigId) {
      toast.error("Completa nombre, pool e ID de hardware");
      return;
    }
    try {
      await create({ data: { ...form, name: form.name.trim() } });
      toast.success("Worker añadido al enjambre");
      setForm({ name: "", coin: "BTC", pool: "", rigId: "" });
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo añadir el worker");
    }
  };

  const term = search.trim().toLowerCase();
  const filtered = term
    ? list.filter((w) =>
        [w.name, w.coin, w.pool, w.rig_id, w.status].join(" ").toLowerCase().includes(term),
      )
    : list;

  const workerColumns: Column<Worker>[] = [
    {
      key: "name",
      label: "Worker",
      value: (w) => w.name,
      render: (w) => (
        <div>
          <p className="font-medium">{w.name}</p>
          <p className="text-xs text-muted-foreground">{w.rig_id}</p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Estado",
      value: (w) => w.status,
      render: (w) => (
        <StatusPill tone={statusTone(w.status)}>
          {w.status === "mining" ? "minando" : w.status === "idle" ? "inactivo" : "offline"}
        </StatusPill>
      ),
    },
    {
      key: "mode",
      label: "Modo",
      value: (w) => (poolByWorker.has(w.id) ? "pool real" : "demo"),
      render: (w) => {
        const pool = poolByWorker.get(w.id);
        if (!pool) return <StatusPill tone="warning">Demo · simulado</StatusPill>;
        return (
          <div className="space-y-1">
            <StatusPill tone={pool.hasActivity === false ? "neutral" : "success"}>
              {pool.mode === "xmr-real" ? "Pool real · XMR" : "Pool real"}
            </StatusPill>
            {pool.hasActivity === false && (
              <p className="text-[11px] text-muted-foreground">sin actividad (sin minero)</p>
            )}
          </div>
        );
      },
    },
    {
      key: "hash",
      label: "Hash rate",
      align: "right",
      value: (w) => poolByWorker.get(w.id)?.hashrate ?? Number(w.hash_rate),
      render: (w) => {
        const pool = poolByWorker.get(w.id);
        if (!pool) return `${Number(w.hash_rate).toFixed(2)} ${w.hash_unit} (simulado)`;
        return formatHashrate(pool.hashrate ?? 0);
      },
    },
    {
      key: "coin",
      label: "Moneda",
      value: (w) => poolByWorker.get(w.id)?.coin ?? w.coin,
      render: (w) => poolByWorker.get(w.id)?.coin ?? w.coin,
    },
    {
      key: "wallet",
      label: "Wallet / pool",
      value: (w) => poolByWorker.get(w.id)?.uidShort ?? "",
      render: (w) => {
        const pool = poolByWorker.get(w.id);
        if (!pool) return <span className="text-xs text-muted-foreground">sin pool conectada</span>;
        return (
          <div>
            <p className="font-mono text-[11px]">
              {pool.uidShort || shortMoneroAddress(pool.wallet ?? "")}
            </p>
            <p className="text-[11px] text-muted-foreground">{pool.label}</p>
          </div>
        );
      },
    },
    {
      key: "uptime",
      label: "Uptime",
      align: "right",
      value: (w) => Number(w.uptime_seconds),
      render: (w) => uptime(Number(w.uptime_seconds)),
    },
    {
      key: "earnings",
      label: "Real/día",
      align: "right",
      value: (w) =>
        poolByWorker.get(w.id)
          ? (poolByWorker.get(w.id)?.dailyEarnings ?? 0) * 1e8
          : Number(w.estimated_daily_earnings),
      render: (w) => {
        const pool = poolByWorker.get(w.id);
        if (!pool) {
          return (
            <span className="text-muted-foreground">
              {money(Number(w.estimated_daily_earnings), "USD")} (demo)
            </span>
          );
        }
        return (
          <span className="text-success">
            {pool.dailyEarnings === null
              ? "sin datos aún"
              : coinAmount(pool.dailyEarnings, pool.coin)}
          </span>
        );
      },
    },
    {
      key: "actions",
      label: "Acciones",
      render: (w) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act("start", w.id)}
            aria-label={`Iniciar ${w.name}`}
          >
            <Play className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => act("stop", w.id)}
            aria-label={`Detener ${w.name}`}
          >
            <Square className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => act("restart", w.id)}
            aria-label={`Reiniciar ${w.name}`}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const payoutColumns: Column<Payout>[] = [
    {
      key: "paid_at",
      label: "Fecha",
      value: (p) => new Date(p.paid_at).getTime(),
      render: (p) => <span className="tabular text-xs">{dateTime(p.paid_at)}</span>,
    },
    {
      key: "coin",
      label: "Moneda",
      value: (p) => p.coin,
      render: (p) => <span className="font-medium">{p.coin}</span>,
    },
    { key: "pool", label: "Pool", value: (p) => p.pool, render: (p) => p.pool },
    {
      key: "amount",
      label: "Cantidad",
      align: "right",
      value: (p) => Number(p.amount),
      render: (p) => `${Number(p.amount).toFixed(8)} ${p.coin}`,
    },
    {
      key: "usd",
      label: "Valor USD",
      align: "right",
      value: (p) => Number(p.usd_value),
      render: (p) =>
        Number(p.usd_value) > 0 ? (
          money(Number(p.usd_value), "USD")
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Minería real de Monero (XMR)"
        subtitle="Monero en CPU con Nanopool (RandomX + XMRig): valida tu wallet y la app lee hashrate, saldo y pagos reales. Cada worker está en modo demo (entrenamiento simulado) o conectado a pool real, nunca mezclados."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => act("start")}>
              <Play className="size-4" /> Iniciar enjambre (app)
            </Button>
            <Button variant="secondary" onClick={() => act("stop")}>
              <Square className="size-4" /> Detener enjambre (app)
            </Button>
          </div>
        }
      />

      <LocalMiningPanel />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Cpu className="size-4" /> Pool externa (Nanopool · legado)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. Crea (o usa) una <b className="text-foreground">wallet Monero</b>. 2. Conéctala en la
            tarjeta de un worker eligiendo la pool{" "}
            <b className="text-foreground">{NANOPOOL_LABEL}</b> y la moneda{" "}
            <b className="text-foreground">XMR</b>. 3. Ejecuta{" "}
            <b className="text-foreground">XMRig</b> en tu PC con el comando que genera la app
            (RandomX, {NANOPOOL_XMR_STRATUM.port} o TLS {NANOPOOL_XMR_STRATUM.tlsPort}). 4. Vuelve
            aquí: las cifras del worker pasan a ser las reales de la pool.
          </p>
          <p className="text-xs">
            La app no ejecuta ni descarga mineros: solo consulta la API pública de Nanopool en
            intervalos de 1 a 5 minutos (la pool no publica en tiempo real). Si no hay minero
            reportando, se muestra «sin actividad» en lugar de ceros.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Hash rate real (Nanopool XMR)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="tabular text-3xl font-semibold">{formatHashrate(realHashrate)}</p>
            <p className="text-xs text-muted-foreground">
              {xmrWorkers.length} worker(s) en pool real · {demoWorkers.length} en demo
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ganancia real / día
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="tabular text-3xl font-semibold text-success">
              {coinAmount(realDailyEarnings)}
            </p>
            <p className="text-xs text-muted-foreground">
              {usdPrice
                ? `≈ ${money(realDailyEarnings * usdPrice, "USD")} (XMR/USD ${usdPrice.toFixed(2)})`
                : "Sin precio XMR/USD disponible por ahora"}
            </p>
            <p className="text-xs text-muted-foreground">
              Demo (simulado, aparte): {money(demoDailyEarnings, "USD")}/día
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Workers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="tabular text-3xl font-semibold">
              {xmrWorkers.length}
              <span className="text-base text-muted-foreground"> / {list.length} en pool real</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Pagado histórico real: {coinAmount(realPaidTotal)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agregar worker</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Moneda objetivo</Label>
            <Select value={form.coin} onValueChange={(value) => setForm({ ...form, coin: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COIN_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Pool</Label>
            <Input value={form.pool} onChange={(e) => setForm({ ...form, pool: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>ID hardware / rig</Label>
            <Input
              value={form.rigId}
              onChange={(e) => setForm({ ...form, rigId: e.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={addWorker}>
              Añadir
            </Button>
          </div>
          <p className="text-xs text-muted-foreground md:col-span-5">
            El worker nace en modo demo. Para minar Monero de verdad, conéctalo después con tu
            wallet XMR en su tarjeta: entonces sus cifras pasan a ser las reales de Nanopool.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((w) => {
          const pool = poolByWorker.get(w.id);
          return (
            <Card key={w.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{w.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pool?.coin ?? w.coin} · {pool?.label ?? w.pool} · {w.rig_id}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(w.status)}>
                    {w.status === "mining"
                      ? "minando"
                      : w.status === "idle"
                        ? "inactivo"
                        : "offline"}
                  </StatusPill>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground">Hash rate</p>
                    <p className="tabular font-semibold">
                      {pool
                        ? formatHashrate(pool.hashrate ?? 0)
                        : `${Number(w.hash_rate).toFixed(2)} ${w.hash_unit}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {pool ? "real (pool)" : "simulado"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground">Uptime</p>
                    <p className="tabular font-semibold">{uptime(Number(w.uptime_seconds))}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-muted-foreground">Ganancia/día</p>
                    {pool ? (
                      <>
                        <p className="tabular font-semibold text-success">
                          {pool.dailyEarnings === null
                            ? "sin datos aún"
                            : `${pool.dailyEarnings.toFixed(8)} ${pool.coin}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">real</p>
                      </>
                    ) : (
                      <>
                        <p className="tabular font-semibold text-success">
                          {money(Number(w.estimated_daily_earnings), "USD")}
                        </p>
                        <p className="text-[11px] text-muted-foreground">demo</p>
                      </>
                    )}
                  </div>
                </div>
                <PoolConnection worker={w} status={pool} onDone={refresh} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => act("start", w.id)}>
                    <Play className="size-3.5" /> Iniciar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => act("stop", w.id)}>
                    <Square className="size-3.5" /> Detener
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act("restart", w.id)}>
                    <RotateCcw className="size-3.5" /> Reiniciar
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    control de la app (no arranca XMRig)
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AlertsPanel
        title="Salud y alertas del enjambre"
        category={["mining", "security"]}
        limit={5}
      />

      <MiningTraining />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3">
            Workers (vista de tabla)
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar worker, moneda, pool o rig"
              className="max-w-xs"
            />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SortableTable
            rows={filtered}
            rowKey={(w) => w.id}
            initialSort={{ key: "hash", dir: "desc" }}
            columns={workerColumns}
            empty="Sin workers en el enjambre."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial de pagos reales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Cada pago de Nanopool detectado al sincronizar una wallet XMR se guarda aquí (importe en
            XMR y valor en USD con el precio de Kraken del momento). El valor USD puede aparecer
            como «—» si el precio no estaba disponible al registrar el pago.
          </p>
          <SortableTable
            rows={payouts.data ?? []}
            rowKey={(p) => p.id}
            initialSort={{ key: "paid_at", dir: "desc" }}
            columns={payoutColumns}
            empty="Sin pagos registrados todavía. Se rellenan al sincronizar una wallet XMR con pagos."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MiningTraining() {
  const qc = useQueryClient();
  const sandboxes = useQuery(miningSandboxesQuery);
  const create = useServerFn(createMiningSandbox);
  const run = useServerFn(runMiningSandbox);
  const promote = useServerFn(promoteMiningRun);
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useQuery(miningRunsQuery(selected));
  const [form, setForm] = useState({
    name: "Sim BTC vs KAS",
    coins: "BTC,KAS",
    pools: "Foundry USA,Kaspa Pool",
    hashRate: "120",
    hashUnit: "TH/s",
    powerCost: "0.12",
    speed: "10",
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["mining_sandboxes"] });
    void qc.invalidateQueries({ queryKey: ["mining_training_runs"] });
    void qc.invalidateQueries({ queryKey: ["mining_workers"] });
  };
  const add = async () => {
    try {
      await create({
        data: {
          name: form.name.trim(),
          coins: form.coins
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          pools: form.pools
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          hashRate: Number(form.hashRate) || 100,
          hashUnit: form.hashUnit.trim() || "TH/s",
          powerCost: Number(form.powerCost) || 0.12,
          dateFrom: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
          dateTo: new Date().toISOString().slice(0, 10),
          speed: Number(form.speed) || 10,
        },
      });
      toast.success("Sandbox de minería creado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear");
    }
  };
  const exec = async (s: MiningSandbox) => {
    try {
      setSelected(s.id);
      await run({ data: { sandboxId: s.id } });
      toast.success("Entrenamiento de minería completado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falló el entrenamiento");
    }
  };
  const pub = async (id: string) => {
    try {
      await promote({ data: { runId: id } });
      toast.success("Mejor combinación aplicada al worker");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo promover");
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campo de entrenamiento — minería (qué minar / dónde)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Laboratorio <b className="text-foreground">simulado</b>: sirve para comparar combinaciones
          moneda/pool antes de decidir. Los workers conectados a una pool real (Nanopool XMR) quedan
          excluidos automáticamente, y sus resultados no se pueden aplicar a un worker con wallet
          real hasta desconectarlo. El entrenamiento fija hashrate y ganancias del simulador, no
          datos de la pool.
        </p>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Nombre</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>Monedas (coma)</Label>
            <Input
              value={form.coins}
              onChange={(e) => setForm({ ...form, coins: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Pools (coma)</Label>
            <Input
              value={form.pools}
              onChange={(e) => setForm({ ...form, pools: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Costo luz USD/kWh</Label>
            <Input
              value={form.powerCost}
              onChange={(e) => setForm({ ...form, powerCost: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Potencia (hash rate)</Label>
            <Input
              value={form.hashRate}
              onChange={(e) => setForm({ ...form, hashRate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unidad</Label>
            <Input
              value={form.hashUnit}
              onChange={(e) => setForm({ ...form, hashUnit: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Velocidad</Label>
            <Input
              value={form.speed}
              onChange={(e) => setForm({ ...form, speed: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={add}>Crear sandbox</Button>
        </div>
        {(sandboxes.data ?? []).map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <div>
              <p className="font-medium">
                {s.name} <span className="text-xs text-muted-foreground">({s.status})</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {s.coins.join(", ")} · {s.pools.join(", ")}
                {s.best_coin
                  ? ` · mejor: ${s.best_coin}/${s.best_pool} ${s.estimated_daily_usd} USD/día`
                  : ""}
              </p>
              {s.ai_notes && <p className="text-xs text-muted-foreground">{s.ai_notes}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => exec(s)}>
                Entrenar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(s.id)}>
                Ver resultados
              </Button>
            </div>
          </div>
        ))}
        {selected && (
          <div className="space-y-2">
            {(runs.data ?? []).map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
              >
                <span>
                  <b>{r.worker_name}</b> · {r.coin}/{r.pool} · neto{" "}
                  <b className="tabular text-success">{money(Number(r.net_daily_usd), "USD")}</b>
                  /día (bruto {money(Number(r.gross_daily_usd), "USD")} − luz{" "}
                  {money(Number(r.power_daily_usd), "USD")})
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={r.promoted}
                  onClick={() => pub(r.id)}
                >
                  {r.promoted ? "Aplicado" : "Aplicar al worker"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
