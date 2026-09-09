// Catálogo de exchanges soportados. Client-safe: aquí no hay claves ni firmas.

export type ExchangeId = "binance" | "coinbase" | "kraken" | "bybit" | "okx" | "kucoin";

export type ExchangeMeta = {
  id: ExchangeId;
  label: string;
  /** Requiere una frase de paso (passphrase) además de clave y secreto. */
  needsPassphrase: boolean;
  /** Soporta whitelist de IP en el propio exchange. */
  ipWhitelist: boolean;
  markets: string;
  docs: string;
  notes: string;
};

export const EXCHANGES: ExchangeMeta[] = [
  {
    id: "binance",
    label: "Binance",
    needsPassphrase: false,
    ipWhitelist: true,
    markets: "Spot · Futures",
    docs: "https://developers.binance.com/docs",
    notes: "Configurado en la tarjeta principal de esta página.",
  },
  {
    id: "coinbase",
    label: "Coinbase Advanced Trade",
    needsPassphrase: false,
    ipWhitelist: true,
    markets: "Spot",
    docs: "https://docs.cdp.coinbase.com/advanced-trade/docs/welcome",
    notes: "Usa claves de Advanced Trade con permisos de ver y operar; nunca de transferir.",
  },
  {
    id: "kraken",
    label: "Kraken",
    needsPassphrase: false,
    ipWhitelist: true,
    markets: "Spot · Futures",
    docs: "https://docs.kraken.com/rest/",
    notes: "Permisos: consultar saldos y crear/cancelar órdenes. Nunca «Withdraw funds».",
  },
  {
    id: "bybit",
    label: "Bybit (V5)",
    needsPassphrase: false,
    ipWhitelist: true,
    markets: "Spot · Futuros · Perpetuos",
    docs: "https://bybit-exchange.github.io/docs/v5/intro",
    notes: "Un solo set de endpoints para spot y derivados. Permiso de retiro desactivado.",
  },
  {
    id: "okx",
    label: "OKX",
    needsPassphrase: true,
    ipWhitelist: true,
    markets: "Spot · Futuros · Opciones",
    docs: "https://www.okx.com/docs-v5/en/",
    notes: "Requiere passphrase creada al generar la clave. Permisos: leer y operar.",
  },
  {
    id: "kucoin",
    label: "KuCoin",
    needsPassphrase: true,
    ipWhitelist: true,
    markets: "Spot · Futuros",
    docs: "https://www.kucoin.com/docs/beginners/introduction",
    notes: "Claves API v2 con passphrase. Permisos: General y Trade, nunca Transfer.",
  },
];

export function exchangeMeta(id: string): ExchangeMeta {
  return EXCHANGES.find((e) => e.id === id) ?? EXCHANGES[0]!;
}

export const EXCHANGE_SECURITY_CHECKLIST = [
  "Activa solo permisos de lectura y trading. Nunca habilites retiros ni transferencias.",
  "Aplica whitelist de IP a las direcciones de salida del backend siempre que el exchange lo permita.",
  "Usa subcuenta o capital limitado mientras validas el motor.",
  "Prueba la conexión (solo lectura) antes de guardar; el secreto se cifra en reposo y nunca vuelve al navegador.",
];
