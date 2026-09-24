// Panel del motor de mineria propio: CPU real con SHA-256, creditos DMR.
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Cpu, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/StatusPill";
import { getLocalMiningJob, stopLocalMining, submitLocalMiningShares } from "@/lib/local-mining-actions";
import { LOCAL_COIN, LOCAL_POOL_LABEL, mineBatch, type LocalJob } from "@/lib/local-mining";
import { coinAmount, hashrate as formatHashrate } from "@/lib/format";
const BATCH = 4000;
export function LocalMiningPanel({ defaultWallet = "" }: { defaultWallet?: string }) {
  const getJob = useServerFn(getLocalMiningJob);
  const submit = useServerFn(submitLocalMiningShares);
  const stopFn = useServerFn(stopLocalMining);
  const [wallet, setWallet] = useState(defaultWallet);
  const [workerName, setWorkerName] = useState("motor-propio-01");
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(0);
  const [hashes, setHashes] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [credited, setCredited] = useState(0);
  const stopRef = useRef(false);
  const nonceRef = useRef(0);
  useEffect(() => { setWallet(defaultWallet); }, [defaultWallet]);
  useEffect(() => () => { stopRef.current = true; }, []);

  async function runLoop(w: string, name: string) {
    let job: LocalJob | null = null;
    try {
      job = await getJob({ data: { wallet: w } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo pedir trabajo");
      setRunning(false);
      return;
    }
    nonceRef.current = Math.floor(Math.random() * 1000000);
    let total = 0;
    let acc = 0;
    let cred = 0;
    let lastSubmit = Date.now();
    while (!stopRef.current && job) {
      const t0 = performance.now();
      const batch = mineBatch(job.seed, w, nonceRef.current, BATCH, job.targetZeros);
      nonceRef.current += BATCH;
      const secs = Math.max(0.01, (performance.now() - t0) / 1000);
      const instant = batch.hashes / secs;
      total += batch.hashes;
      setHashes(total);
      setRate((p) => (p === 0 ? instant : p * 0.7 + instant * 0.3));
      const due = Date.now() - lastSubmit > 10000 || batch.shares.length > 0;
      if (due) {
        try {
          const res = await submit({
            data: { wallet: w, workerName: name, job, shares: batch.shares, hashes: batch.hashes, seconds: secs },
          });
          acc += res.accepted;
          cred += res.creditedDmr;
          setAccepted(acc);
          setCredited(cred);
          lastSubmit = Date.now();
        } catch { /* sigue midiendo hashrate local */ }
      }
      await new Promise((r) => setTimeout(r, 0));
      if (Date.now() - Date.parse(job.issuedAt) > 120000) {
        try { job = await getJob({ data: { wallet: w } }); } catch { /* mantiene job */ }
      }
    }
  }

  async function start() {
    const w = wallet.trim();
    if (!w) { toast.error("Escribe tu wallet (identificador del worker)."); return; }
    stopRef.current = false;
    setRunning(true);
    toast.success("Motor propio encendido: minando con tu CPU.");
    void runLoop(w, workerName.trim() || "motor-propio-01");
  }

  async function stop() {
    stopRef.current = true;
    setRunning(false);
    const w = wallet.trim();
    if (w) { try { await stopFn({ data: { wallet: w } }); } catch { /* ya paro local */ } }
    toast.success("Motor propio detenido.");
  }

  return (
    <Card className="border-success/40">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Cpu className="size-4" aria-hidden />
          Motor propio (CPU local, sin XMRig ni pools)
          <StatusPill tone={running ? "success" : "neutral"}>{running ? "minando" : "apagado"}</StatusPill>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {LOCAL_POOL_LABEL}. Hashrate real SHA-256 de tu CPU. Recompensa en creditos internos{" "}
          <b>{LOCAL_COIN}</b> (no XMR real): 0.0001 {LOCAL_COIN} por share verificado.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="local-wallet">Wallet / identificador</Label>
            <Input id="local-wallet" value={wallet} onChange={(e) => setWallet(e.target.value)} disabled={running} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="local-worker">Worker</Label>
            <Input id="local-worker" value={workerName} onChange={(e) => setWorkerName(e.target.value)} disabled={running} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] text-muted-foreground">Hashrate real</p>
            <p className="text-lg font-semibold tabular">{formatHashrate(rate)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] text-muted-foreground">Hashes</p>
            <p className="text-lg font-semibold tabular">{hashes.toLocaleString("es-ES")}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] text-muted-foreground">Shares</p>
            <p className="text-lg font-semibold tabular">{accepted}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-[11px] text-muted-foreground">Ganado ({LOCAL_COIN})</p>
            <p className="text-lg font-semibold tabular text-success">{coinAmount(credited, LOCAL_COIN)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!running ? (
            <Button onClick={start}><Play className="size-4" /> Conectar y minar con mi CPU</Button>
          ) : (
            <Button variant="secondary" onClick={stop}><Square className="size-4" /> Desconectar motor</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

