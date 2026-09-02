import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const unwrap = <T>(res: { data: unknown; error: { message: string } | null }): T => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
};

export type FundAccount = {
  id: string;
  label: string;
  currency: string;
  available_balance: number;
  in_use_balance: number;
};

export type FundTransaction = {
  id: string;
  kind: "deposit" | "withdrawal";
  method: "transfer" | "wallet" | "onchain";
  amount: number;
  status: "pending" | "completed" | "failed";
  reference: string | null;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type Bot = {
  id: string;
  name: string;
  strategy: string;
  pair: string;
  capital: number;
  status: "running" | "paused" | "training" | "stopped";
  mode: "demo" | "real";
  demo_engine: string;
  exchange: string;
  pnl: number;
  win_rate: number;
};

export type BotLog = {
  id: string;
  bot_id: string;
  level: "info" | "warn" | "error";
  message: string;
  created_at: string;
};

export type Sandbox = {
  id: string;
  name: string;
  dataset: string;
  date_from: string;
  date_to: string;
  pairs: string[];
  simulated_capital: number;
  speed: number;
  status: "ready" | "running" | "completed" | "failed";
  return_pct: number | null;
  drawdown_pct: number | null;
  win_rate: number | null;
  ai_sources: { source: string; range: string }[];
  ai_notes: string | null;
};

export type TrainingRun = {
  id: string;
  sandbox_id: string;
  bot_name: string;
  return_pct: number;
  drawdown_pct: number;
  win_rate: number;
  promoted: boolean;
  suggested_params: Record<string, unknown>;
};

export type Worker = {
  id: string;
  name: string;
  coin: string;
  pool: string;
  rig_id: string;
  status: "mining" | "idle" | "offline";
  hash_rate: number;
  hash_unit: string;
  uptime_seconds: number;
  estimated_daily_earnings: number;
};

export type Payout = {
  id: string;
  coin: string;
  pool: string;
  amount: number;
  usd_value: number;
  paid_at: string;
};

export type BinanceSettings = {
  id: string;
  api_key_last4: string;
  api_secret_last4: string;
  market_mode: "spot" | "futures" | "both";
  connection_status: "untested" | "ok" | "failed";
  last_tested_at: string | null;
};

export const fundsQuery = queryOptions({
  queryKey: ["fund_account"],
  queryFn: async () =>
    unwrap<FundAccount[]>(
      await supabase
        .from("fund_accounts")
        .select("id,label,currency,available_balance,in_use_balance")
        .limit(1),
    ).at(0) ?? null,
});

export const transactionsQuery = queryOptions({
  queryKey: ["fund_transactions"],
  queryFn: async () =>
    unwrap<FundTransaction[]>(
      await supabase
        .from("fund_transactions")
        .select("id,kind,method,amount,status,reference,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ),
});

export const auditQuery = queryOptions({
  queryKey: ["audit_events"],
  queryFn: async () =>
    unwrap<AuditEvent[]>(
      await supabase
        .from("audit_events")
        .select("id,action,entity,entity_id,details,created_at")
        .order("created_at", { ascending: false })
        .limit(40),
    ),
});

export const botsQuery = queryOptions({
  queryKey: ["bots"],
  queryFn: async () =>
    unwrap<Bot[]>(
      await supabase
        .from("bots")
        .select("id,name,strategy,pair,capital,status,mode,demo_engine,exchange,pnl,win_rate")
        .order("created_at", { ascending: true }),
    ),
});

export const botLogsQuery = queryOptions({
  queryKey: ["bot_logs"],
  queryFn: async () =>
    unwrap<BotLog[]>(
      await supabase
        .from("bot_logs")
        .select("id,bot_id,level,message,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ),
});

export const sandboxesQuery = queryOptions({
  queryKey: ["training_sandboxes"],
  queryFn: async () =>
    unwrap<Sandbox[]>(
      await supabase
        .from("training_sandboxes")
        .select("*")
        .order("created_at", { ascending: false }),
    ),
});

export const trainingRunsQuery = queryOptions({
  queryKey: ["training_runs"],
  queryFn: async () =>
    unwrap<TrainingRun[]>(
      await supabase
        .from("training_runs")
        .select("id,sandbox_id,bot_name,return_pct,drawdown_pct,win_rate,promoted,suggested_params")
        .order("return_pct", { ascending: false }),
    ),
});

export const workersQuery = queryOptions({
  queryKey: ["mining_workers"],
  queryFn: async () =>
    unwrap<Worker[]>(
      await supabase
        .from("mining_workers")
        .select(
          "id,name,coin,pool,rig_id,status,hash_rate,hash_unit,uptime_seconds,estimated_daily_earnings",
        )
        .order("created_at", { ascending: true }),
    ),
});

export const payoutsQuery = queryOptions({
  queryKey: ["mining_payouts"],
  queryFn: async () =>
    unwrap<Payout[]>(
      await supabase
        .from("mining_payouts")
        .select("id,coin,pool,amount,usd_value,paid_at")
        .order("paid_at", { ascending: false })
        .limit(40),
    ),
});

export const binanceQuery = queryOptions({
  queryKey: ["binance_settings"],
  queryFn: async () =>
    unwrap<BinanceSettings[]>(
      await supabase
        .from("binance_credentials")
        .select("id,api_key_last4,api_secret_last4,market_mode,connection_status,last_tested_at")
        .limit(1),
    ).at(0) ?? null,
});
