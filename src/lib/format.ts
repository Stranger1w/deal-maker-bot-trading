export const money = (value: number, currency = "USDT") =>
  `${new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;

export const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

export const uptime = (seconds: number) => {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
};

export const dateTime = (value: string) =>
  new Date(value).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
