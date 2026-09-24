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

/** Hashrate en la unidad más legible: 34700000 -> "34.70 MH/s". */
export const hashrate = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value <= 0) return "0 H/s";
  const units = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${scaled.toFixed(digits)} ${units[unit] ?? "H/s"}`;
};

/** Cantidad de XMR (u otra moneda de pool) con 8 decimales por defecto. */
export const coinAmount = (value: number | null | undefined, coin = "XMR", digits = 8) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)} ${coin}`;
};

/** "hace 4 min" a partir de una fecha ISO. */
export const sinceLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff)) return "—";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
};
