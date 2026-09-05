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
  automation_enabled: boolean;
  stop_loss_pct: number;
  take_profit_pct: number;
  max_daily_loss: number;
  max_drawdown_pct: number;
  max_weekly_drawdown_pct: number;
  max_capital: number;
  max_trades_per_day: number;
  trades_today: number;
  daily_loss: number;
  weekly_loss: number;
  demo_since: string | null;
  demo_trades: number;
  auto_stop_reason: string | null;
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
  connection_status: "untested" | "ok" | "failed" | "geo_restricted";
  last_tested_at: string | null;
  geo_restricted: boolean;
  last_error_code: string | null;
  last_error_message: string | null;
};

export type RegionProbeRow = {
  id: string;
  platform: string;
  colo: string | null;
  country: string | null;
  binance_status: number | null;
  binance_restricted: boolean;
  detail: string;
  created_at: string;
};

export const regionProbeQuery = queryOptions({
  queryKey: ["backend_region_probe"],
  queryFn: async () =>
    unwrap<RegionProbeRow[]>(
      await supabase
        .from("backend_region_probes")
        .select("id,platform,colo,country,binance_status,binance_restricted,detail,created_at")
        .order("created_at", { ascending: false })
        .limit(1),
    ).at(0) ?? null,
});


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
        .select(
          "id,name,strategy,pair,capital,status,mode,demo_engine,exchange,pnl,win_rate,automation_enabled,stop_loss_pct,take_profit_pct,max_daily_loss,max_drawdown_pct,max_weekly_drawdown_pct,max_capital,max_trades_per_day,trades_today,daily_loss,weekly_loss,demo_since,demo_trades,auto_stop_reason",
        )
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
        .select(
          "id,api_key_last4,api_secret_last4,market_mode,connection_status,last_tested_at,geo_restricted,last_error_code,last_error_message",
        )

    ).at(0) ?? null,
});

/* ------------------- MOTOR DE AUTOMATIZACIÓN Y GRÁFICAS ------------------ */

export type AutomationSettings = {
  id: string;
  engine_enabled: boolean;
  kill_switch: boolean;
  allow_real_trading: boolean;
  tick_interval_seconds: number;
  global_max_daily_loss: number;
  global_max_drawdown_pct: number;
  engine_status: "stopped" | "running" | "halted" | "error";
  last_heartbeat_at: string | null;
  last_error: string | null;
  global_max_capital: number;
  max_pair_concentration_pct: number;
  global_max_weekly_drawdown_pct: number;
  global_weekly_loss: number;
  min_demo_days: number;
  min_demo_trades: number;
  require_benchmark_outperformance: boolean;
  profit_policy: "reinvest" | "reserve";
  profit_reserve_pct: number;
  last_profit_sweep_on: string | null;
  notify_email: string | null;
  notify_email_enabled: boolean;
  kill_switch_reason: string | null;
  kill_switch_actor: string | null;
  kill_switch_at: string | null;
};

export type BotRisk = {
  id: string;
  automation_enabled: boolean;
  max_daily_loss: number;
  stop_loss_pct: number;
  max_drawdown_pct: number;
  max_capital: number;
  max_trades_per_day: number;
  trades_today: number;
  daily_loss: number;
  auto_stop_reason: string | null;
  last_tick_at: string | null;
};

export type Execution = {
  id: string;
  bot_name: string;
  mode: string;
  side: string;
  symbol: string;
  quantity: number;
  pnl: number;
  status: string;
  attempts: number;
  error: string | null;
  created_at: string;
};

export type EngineRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  bots_processed: number;
  orders_created: number;
  errors: number;
  retries: number;
  duration_ms: number;
  notes: string | null;
};

export type HashratePoint = {
  worker_name: string;
  coin: string;
  recorded_on: string;
  hash_rate: number;
  hash_unit: string;
};

export type PricePoint = { symbol: string; recorded_on: string; price: number };

export type BotPerfPoint = {
  bot_name: string;
  recorded_on: string;
  pnl: number;
  return_pct: number;
  capital: number;
};

export const automationQuery = queryOptions({
  queryKey: ["automation_settings"],
  refetchInterval: 15000,
  queryFn: async () =>
    unwrap<AutomationSettings[]>(
      await supabase.from("automation_settings").select("*").limit(1),
    ).at(0) ?? null,
});

export const botRiskQuery = queryOptions({
  queryKey: ["bots_risk"],
  queryFn: async () =>
    unwrap<BotRisk[]>(
      await supabase
        .from("bots")
        .select(
          "id,automation_enabled,max_daily_loss,stop_loss_pct,max_drawdown_pct,max_capital,max_trades_per_day,trades_today,daily_loss,auto_stop_reason,last_tick_at",
        ),
    ),
});

export const executionsQuery = queryOptions({
  queryKey: ["bot_executions"],
  refetchInterval: 20000,
  queryFn: async () =>
    unwrap<Execution[]>(
      await supabase
        .from("bot_executions")
        .select("id,bot_name,mode,side,symbol,quantity,pnl,status,attempts,error,created_at")
        .order("created_at", { ascending: false })
        .limit(60),
    ),
});

export const engineRunsQuery = queryOptions({
  queryKey: ["engine_runs"],
  refetchInterval: 15000,
  queryFn: async () =>
    unwrap<EngineRun[]>(
      await supabase
        .from("engine_runs")
        .select(
          "id,started_at,finished_at,status,trigger,bots_processed,orders_created,errors,retries,duration_ms,notes",
        )
        .order("started_at", { ascending: false })
        .limit(30),
    ),
});

export const hashrateHistoryQuery = queryOptions({
  queryKey: ["mining_hashrate_history"],
  queryFn: async () =>
    unwrap<HashratePoint[]>(
      await supabase
        .from("mining_hashrate_history")
        .select("worker_name,coin,recorded_on,hash_rate,hash_unit")
        .order("recorded_on", { ascending: true }),
    ),
});

export const marketPricesQuery = queryOptions({
  queryKey: ["market_prices"],
  queryFn: async () =>
    unwrap<PricePoint[]>(
      await supabase
        .from("market_prices")
        .select("symbol,recorded_on,price")
        .order("recorded_on", { ascending: true }),
    ),
});

export const botPerformanceQuery = queryOptions({
  queryKey: ["bot_performance_history"],
  queryFn: async () =>
    unwrap<BotPerfPoint[]>(
      await supabase
        .from("bot_performance_history")
        .select("bot_name,recorded_on,pnl,return_pct,capital")
        .order("recorded_on", { ascending: true }),
    ),
});

/* --------------------- ALERTAS Y REPORTES DE PERFORMANCE -------------------- */

export type Alert = {
  id: string;
  category: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  entity: string | null;
  entity_id: string | null;
  acknowledged: boolean;
  is_demo: boolean;
  delivery_status: string;
  created_at: string;
};

export type PerformanceReport = {
  id: string;
  period: "daily" | "weekly";
  scope: "squad" | "mining";
  period_start: string;
  period_end: string;
  metrics: Record<string, number>;
  summary: string;
  email_status: string;
  is_demo: boolean;
  created_at: string;
};

export const alertsQuery = queryOptions({
  queryKey: ["alerts"],
  refetchInterval: 20000,
  queryFn: async () =>
    unwrap<Alert[]>(
      await supabase
        .from("alerts")
        .select(
          "id,category,severity,title,message,entity,entity_id,acknowledged,is_demo,delivery_status,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ),
});

export const reportsQuery = queryOptions({
  queryKey: ["performance_reports"],
  queryFn: async () =>
    unwrap<PerformanceReport[]>(
      await supabase
        .from("performance_reports")
        .select(
          "id,period,scope,period_start,period_end,metrics,summary,email_status,is_demo,created_at",
        )
        .order("period_end", { ascending: false })
        .limit(20),
    ),
});
