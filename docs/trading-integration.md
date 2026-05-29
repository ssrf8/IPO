# Trading Integration Notes

> Status: planning document only. The current app remains read-only. Do not add live order execution until the strategy layer has dry-run, idempotency, limits, position reconciliation, and kill-switch controls.

## Scope

The next layer should turn a ranked hedge opportunity into a validated two-leg execution plan. It should not let UI code call exchange clients directly.

Recommended flow:

1. `Opportunity` from the existing calculator.
2. `StrategySignal` decides whether the opportunity is tradable.
3. `ExecutionPlan` converts canonical hedge quantity into venue-native order quantities.
4. `RiskGate` checks max notional, max spread, stale quotes, funding drift, borrow/collateral state, and API mode.
5. `ExecutionAdapter` places or simulates orders.
6. `Reconciler` confirms fills, cancels stale orders, and updates positions.

## Shared Order Model

The strategy layer should normalize all venues into one internal intent before signing anything.

```ts
interface OrderIntent {
  venue: "OKX" | "Binance" | "Ventuals" | "TradeXYZ";
  target: "SPACEX" | "OPENAI" | "ANTHROPIC";
  symbol: string;
  side: "buy" | "sell";
  reduceOnly: boolean;
  orderType: "market" | "limit" | "postOnly" | "ioc";
  price?: string;
  quantity: string;
  clientOrderId: string;
  hedgeGroupId: string;
  maxSlippageBps: number;
  expectedNotionalUsd: number;
}
```

`quantity` must be venue-native, not the current UI's canonical hedge quantity. For equal economic exposure:

- Canonical price = venue raw price * `canonicalMultiplier`.
- Canonical hedge quantity = total notional / (`shortEntry + longEntry`).
- Venue raw quantity = canonical hedge quantity * `canonicalMultiplier`.
- Venue notional estimate = raw quantity * raw entry price.

## Credentials

Never store API keys in source, config committed to git, browser local storage, logs, copied strategy text, or screenshots.

Use server-side environment variables only:

```text
OKX_API_KEY=
OKX_API_SECRET=
OKX_API_PASSPHRASE=
OKX_BASE_URL=https://www.okx.com
OKX_SIMULATED=1

BINANCE_FAPI_KEY=
BINANCE_FAPI_SECRET=
BINANCE_FAPI_BASE_URL=https://fapi.binance.com
BINANCE_FAPI_TESTNET_BASE_URL=https://demo-fapi.binance.com

HYPERLIQUID_PRIVATE_KEY=
HYPERLIQUID_USER_ADDRESS=
HYPERLIQUID_VAULT_ADDRESS=
HYPERLIQUID_BASE_URL=https://api.hyperliquid.xyz
HYPERLIQUID_CHAIN=Mainnet
```

## OKX Order Adapter

Official references:

- [OKX API v5 documentation](https://www.okx.com/docs-v5/en/)
- [OKX place order endpoint](https://www.okx.com/docs-v5/en/#order-book-trading-trade-post-place-order)

Order endpoint:

```text
POST /api/v5/trade/order
```

Required private REST headers:

```text
OK-ACCESS-KEY
OK-ACCESS-SIGN
OK-ACCESS-TIMESTAMP
OK-ACCESS-PASSPHRASE
Content-Type: application/json
```

Signing shape:

```text
prehash = timestamp + method + requestPath + body
signature = base64(hmac_sha256(secret, prehash))
```

Premarket swap order fields to support first:

```json
{
  "instId": "ANTHROPIC-USDT-SWAP",
  "tdMode": "cross",
  "side": "sell",
  "posSide": "short",
  "ordType": "limit",
  "px": "1717.5",
  "sz": "1",
  "clOrdId": "ipo-..."
}
```

Implementation notes:

- `tdMode` should be explicit: start with `cross` or `isolated`, do not infer from account state.
- If the account is in hedge/long-short mode, pass `posSide`; if net mode, omit or adapt after account inspection.
- For closing positions, support `reduceOnly` orders first; do not rely only on a market close endpoint.
- OKX regional domains can differ by registration region. Keep `OKX_BASE_URL` configurable.
- Demo trading should be a separate mode and must be visibly shown in logs and health checks.

## Binance USD-M Futures Adapter

Official references:

- [Binance USD-M Futures general info](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info)
- [Binance USD-M Futures new order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order)
- [Binance USD-M Futures test order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order-Test)

Base URLs:

```text
mainnet: https://fapi.binance.com
testnet: https://demo-fapi.binance.com
```

Order endpoint:

```text
POST /fapi/v1/order
```

Authentication:

- Send API key in `X-MBX-APIKEY`.
- Add `timestamp` and optional `recvWindow`.
- Sign the total query/body parameters with `HMAC SHA256(secret, totalParams)`.
- Append `signature` to query or form body.

First supported fields:

```json
{
  "symbol": "ANTHROPICUSDT",
  "side": "BUY",
  "positionSide": "LONG",
  "type": "LIMIT",
  "timeInForce": "GTC",
  "quantity": "1",
  "price": "1406.8",
  "newClientOrderId": "ipo-...",
  "timestamp": 1760000000000,
  "recvWindow": 5000
}
```

Implementation notes:

- Use `POST /fapi/v1/order/test` during adapter development.
- Hedge mode requires `positionSide` as `LONG` or `SHORT`.
- `reduceOnly` cannot be sent in hedge mode according to Binance's order parameter rules; closing logic must use side plus `positionSide`.
- Binance documents `503` "Unknown error" as execution status unknown. Reconcile by order query or user-data stream before retrying to avoid duplicate orders.
- Keep base URL configurable because Binance may be unavailable from some networks or regions.

## Ventuals Adapter

Official references:

- [Ventuals API](https://docs.ventuals.com/developers/api)
- [Ventuals fees](https://docs.ventuals.com/trading/fees)
- [Hyperliquid exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
- [Hyperliquid nonces and API wallets](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets)
- [Hyperliquid signing](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing)
- [Hyperliquid info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)

Ventuals states that its core functionality is available through the Hyperliquid API. Market data, orders, account queries, and positions should therefore share one Hyperliquid adapter with a DEX setting for Ventuals.

Current code note:

- The quote adapter currently uses `dex: "vntl"` and symbols like `vntl:ANTHROPIC`.
- Ventuals docs examples may refer to `dex: "vntls"` and symbols prefixed `vntls:`.
- Before live trading, implement a discovery step that reads `metaAndAssetCtxs` and stores the exact live DEX name, asset index, display symbol, tick size, and lot size.

Order endpoint:

```text
POST https://api.hyperliquid.xyz/exchange
```

Order action shape:

```json
{
  "action": {
    "type": "order",
    "orders": [
      {
        "a": 0,
        "b": true,
        "p": "1406.8",
        "s": "0.16",
        "r": false,
        "t": { "limit": { "tif": "Gtc" } },
        "c": "0x1234567890abcdef1234567890abcdef"
      }
    ],
    "grouping": "na"
  },
  "nonce": 1760000000000,
  "signature": {},
  "vaultAddress": null
}
```

Key mappings:

- `a`: asset index in the DEX `universe`.
- `b`: `true` for buy, `false` for sell.
- `p`: price string.
- `s`: size string.
- `r`: reduce-only.
- `t.limit.tif`: `Alo`, `Ioc`, or `Gtc`.
- `c`: optional 128-bit hex client order id.

Implementation notes:

- Hyperliquid recommends using an SDK rather than hand-writing signatures. If we implement signing in TypeScript, add dedicated signature test vectors before any live mode.
- Use a separate API/agent wallet per trading process to avoid nonce collisions.
- Nonces are tracked per signer, not per account; centralize nonce allocation in one service.
- For subaccounts or vaults, sign with the master/API wallet and pass `vaultAddress`.
- Ventuals HIP-3 fees are 2x normal Hyperliquid core exchange fees, before discounts.
- For HIP-3 collateral behavior, evaluate whether the account needs DEX abstraction enabled before strategy execution.

## Strategy Layer Guardrails

Minimum before live orders:

- Dry-run mode is default and cannot be disabled without an explicit environment flag.
- One-click global kill switch: cancel open orders and block new entries.
- Max total notional per hedge group.
- Max per-venue open notional.
- Quote staleness limit.
- Max allowed entry slippage vs current order book VWAP.
- Min expected net PnL after dynamic fees, funding, slippage, and stablecoin haircut.
- Post-order reconciliation before sending the second leg if execution is sequential.
- Idempotent `clientOrderId` / `cloid` per leg.
- Persistent execution journal for every signal, order intent, signed payload hash, exchange response, fill, cancel, and error.
- No automatic retry on ambiguous order status without querying order state first.

## Suggested File Layout

```text
server/trading/
  credentials.ts
  order-types.ts
  strategy.ts
  risk-gate.ts
  execution-journal.ts
  adapters/
    okx-trade.ts
    binance-futures-trade.ts
    hyperliquid-trade.ts
  routes.ts
```

The first code milestone should expose read-only/simulated endpoints only:

```text
POST /api/strategy/preview
POST /api/trading/simulate-order
GET  /api/trading/health
```

Live endpoints should come later and require a separate `TRADING_ENABLED=true` plus per-venue enable flags.
