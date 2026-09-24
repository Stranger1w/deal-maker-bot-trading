# Deal Maker — Exchanges (APIs conectadas a nivel código)

Estado: **conectadas a nivel código + UI lista**. Falta que pegues tus
API keys en la app (`/binance`) para activar cada una. Nada se opera sin
tu test de solo-lectura previo.

## 1. Qué hay ya integrado

| Exchange | Docs que pasaste | Auth | Test solo-lectura | Permisos a crear |
|---|---|---|---|---|
| Binance | https://developers.binance.com/docs/binance-spot-api-docs | HMAC-SHA256 `X-MBX-APIKEY` | `GET /api/v3/account` | Spot Trade + Futures si usas ambos. **Withdraw OFF** |
| Coinbase Advanced | https://docs.cdp.coinbase.com/advanced-trade/docs/welcome | `CB-ACCESS-*` HMAC | `GET /api/v3/brokerage/accounts?limit=1` | View + Trade (Advanced Trade). **Transfer OFF** |
| Kraken | https://docs.kraken.com/api/ | `API-Key/API-Sign` SHA-512+SHA-256 | `POST /0/private/Balance` | Query funds + Create/cancel orders. **Withdraw OFF** |
| Bybit V5 | https://bybit-exchange.github.io/docs/v5/intro | `X-BAPI-*` HMAC | `GET /v5/account/wallet-balance` | Read-Write (spot+derivados). **Withdraw OFF** |
| OKX | https://www.okx.com/docs-v5/en/ | `OK-ACCESS-*` + passphrase | `GET /api/v5/account/balance` | Read + Trade. **Withdraw OFF** |
| KuCoin | https://www.kucoin.com/docs/beginners/introduction | `KC-API-*` v2 + passphrase firmada | `GET /api/v1/accounts` | General + Trade. **Transfer OFF** |
| eToro | https://api-portal.etoro.com/ | API key partner + OAuth (NO HMAC) | validación + `etoro_oauth_required` | **Solo lectura**: portfolios, watchlists, social. Sin trading spot automático |

Código:
- `src/lib/exchanges.ts` — catálogo con `docs` + `apiDocs` por exchange.
- `src/lib/exchange-clients.server.ts` — `testExchange()` server-only, firmas HMAC, `isGeoRestricted()`, eToro como solo-lectura.
- `src/lib/dealmaker.functions.ts` — `testBinanceConnection` / `saveBinanceCredentials` (AES-GCM).
- Tabla `exchange_credentials` (ver `supabase/migrations/ALL_IN_ONE_PART4.sql`).

## 2. Cómo activar cada una (cuando me pases las keys)

1. Crea la key en el exchange **con los permisos de la tabla** (nunca retiros).
2. Activa whitelist de IP si el exchange lo permite (todos menos eToro).
3. En la app ve a `/binance`:
   - Binance → tarjeta principal (Probar conexión → Guardar cifrado).
   - Resto → tarjeta del exchange (Probar solo-lectura → Guardar).
4. Verifica `/` (Dashboard): cuenta conectada, kill-switch visible.

## 3. Orden en que te las pediré (dejalas para lo último, como pediste)

1. Binance (spot) — `API Key + Secret`
2. Coinbase Advanced — `Key + Secret`
3. Kraken — `Key + Secret`
4. Bybit V5 — `Key + Secret`
5. OKX — `Key + Secret + Passphrase`
6. KuCoin — `Key + Secret + Passphrase (v2)`
7. eToro — `Partner API key` (+ OAuth) — **solo lectura, no opera bots**

Seguridad: secretos cifrados AES-GCM (`CREDENTIALS_ENCRYPTION_KEY`), frontend
solo ve últimos 4, sin logs de firmas, test previo obligatorio, kill-switch
global detiene todo, 2FA (`aal2`) exigida para Real/retiros.
