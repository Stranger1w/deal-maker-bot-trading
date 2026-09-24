// Contabilidad del motor de mineria propio (server-only).
// El servidor emite el trabajo y VERIFICA cada share con SHA-256
// antes de acreditar creditos internos DMR. Sin verificacion no hay credito.

import { createHash, randomBytes } from "node:crypto";

import {
  DEFAULT_TARGET_ZEROS,
  LOCAL_COIN,
  LOCAL_POOL_ID,
  LOCAL_POOL_LABEL,
  SHARE_REWARD_DMR,
  hashInput,
  hashMeetsTarget,
  type LocalJob,
} from "./local-mining";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function sha256Hex(message: string): string {
  return createHash("sha256").update(message, "ascii").digest("hex");
}

/** Emite un trabajo de minado para una wallet. */
export async function issueLocalJob(wallet: string): Promise<LocalJob> {
  void wallet;
  return {
    jobId: randomBytes(8).toString("hex"),
    seed: `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`,
    targetZeros: DEFAULT_TARGET_ZEROS,
    rewardPerShare: SHARE_REWARD_DMR,
    issuedAt: new Date().toISOString(),
  };
}

export type SubmitSharesInput = {
  wallet: string;
  workerName?: string;
  job: LocalJob;
  shares: { nonce: number; hashHex: string }[];
  hashes: number;
  seconds: number;
};

export type SubmitSharesResult = {
  ok: true;
  accepted: number;
  rejected: number;
  creditedDmr: number;
  hashrate: number;
  totalPaidDmr: number;
  workerId: string;
};

/** Verifica shares, acredita DMR y actualiza el worker local. */
export async function submitLocalShares(input: SubmitSharesInput): Promise<SubmitSharesResult> {
  const client = await db();
  const wallet = String(input.wallet ?? "").trim().slice(0, 128);
  if (!wallet) throw new Error("Falta la wallet para acreditar el minado local.");
  const shares = Array.isArray(input.shares) ? input.shares.slice(0, 32) : [];
  const hashes = Math.max(0, Math.floor(Number(input.hashes) || 0));
  const seconds = Math.max(0.001, Number(input.seconds) || 1);
  const hashrate = hashes / seconds;
  const name = String(input.workerName ?? "motor-propio").slice(0, 60) || "motor-propio";

  const { data: existing } = await client
    .from("mining_workers")
    .select("id,uptime_seconds")
    .eq("coin", LOCAL_COIN)
    .eq("pool", LOCAL_POOL_ID)
    .eq("rig_id", wallet)
    .limit(1)
    .maybeSingle();
  let workerId = (existing as { id?: string } | null)?.id ?? null;
  if (!workerId) {
    const { data: created, error } = await client
      .from("mining_workers")
      .insert({
        name,
        coin: LOCAL_COIN,
        pool: LOCAL_POOL_ID,
        rig_id: wallet,
        status: "mining",
        hash_rate: Math.round(hashrate),
        hash_unit: "H/s",
        uptime_seconds: Math.round(seconds),
        estimated_daily_earnings: 0,
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    workerId = (created as { id: string }).id;
  }

  let accepted = 0;
  let rejected = 0;
  const seen = new Set<string>();
  for (const s of shares) {
    const nonce = Math.floor(Number(s?.nonce));
    const claimed = String(s?.hashHex ?? "").toLowerCase();
    if (!Number.isFinite(nonce) || nonce < 0 || seen.has(String(nonce))) {
      rejected++;
      continue;
    }
    seen.add(String(nonce));
    const expected = sha256Hex(hashInput(input.job.seed, wallet, nonce));
    if (expected !== claimed || !hashMeetsTarget(expected, input.job.targetZeros)) {
      rejected++;
      continue;
    }
    accepted++;
  }

  const creditedDmr = accepted * SHARE_REWARD_DMR;
  if (accepted > 0) {
    const rows = Array.from({ length: accepted }, () => ({
      coin: LOCAL_COIN,
      pool: LOCAL_POOL_LABEL,
      amount: SHARE_REWARD_DMR,
      usd_value: 0,
    }));
    const { error: payError } = await client.from("mining_payouts").insert(rows);
    if (payError) throw new Error(payError.message);
  }

  let totalPaidDmr = creditedDmr;
  try {
    const { data: payouts } = await client
      .from("mining_payouts")
      .select("amount")
      .eq("coin", LOCAL_COIN)
      .eq("pool", LOCAL_POOL_LABEL)
      .limit(5000);
    totalPaidDmr = ((payouts ?? []) as { amount: number | string }[]).reduce(
      (sum, p) => sum + Number(p.amount ?? 0),
      0,
    );
  } catch {
    totalPaidDmr = creditedDmr;
  }

  const prevUptime = Number((existing as { uptime_seconds?: number } | null)?.uptime_seconds ?? 0);
  const daily = creditedDmr > 0 ? (creditedDmr / seconds) * 86400 : 0;
  const { error: wError } = await client
    .from("mining_workers")
    .update({
      status: "mining",
      hash_rate: Math.round(hashrate),
      hash_unit: "H/s",
      uptime_seconds: prevUptime + Math.round(seconds),
      estimated_daily_earnings: daily,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workerId);
  if (wError) throw new Error(wError.message);

  await client.from("audit_events").insert({
    action: "mining.local_shares",
    entity: "mining_worker",
    entity_id: workerId,
    details: {
      wallet_tail: wallet.slice(-6),
      accepted,
      rejected,
      hashes,
      hashrate: Math.round(hashrate),
    } as never,
  });

  return { ok: true, accepted, rejected, creditedDmr, hashrate, totalPaidDmr, workerId };
}

/** Detiene el worker local (mineria propia apagada). */
export async function stopLocalWorker(wallet: string): Promise<{ ok: true }> {
  const client = await db();
  await client
    .from("mining_workers")
    .update({ status: "idle", hash_rate: 0, updated_at: new Date().toISOString() })
    .eq("coin", LOCAL_COIN)
    .eq("pool", LOCAL_POOL_ID)
    .eq("rig_id", String(wallet ?? "").trim());
  return { ok: true };
}

