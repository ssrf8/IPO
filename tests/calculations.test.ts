import { describe, expect, it } from "vitest";
import { calculateOpportunities, canonicalPrice, DEFAULT_PARAMS } from "../shared/calculations";
import type { MarketQuote } from "../shared/types";

function quote(overrides: Partial<MarketQuote>): MarketQuote {
  return {
    venue: "OKX",
    symbol: "SPACEX-USDT-SWAP",
    target: "SPACEX",
    bid: 100,
    ask: 101,
    mid: 100.5,
    mark: 100.5,
    oracle: 100.5,
    fundingRateHourly: 0,
    fundingIntervalHours: 1,
    feeMaker: 0.0002,
    feeTaker: 0.0005,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    quoteUnit: "VALUATION_BILLION",
    settleAsset: "USDT",
    comparable: true,
    timestamp: Date.now(),
    status: "ok",
    ...overrides
  };
}

describe("canonicalPrice", () => {
  it("keeps valuation-billion quotes comparable", () => {
    expect(canonicalPrice(quote({ mid: 420, quoteUnit: "VALUATION_BILLION" }))).toBe(420);
  });

  it("excludes unsupported contract-unit quotes from arbitrage", () => {
    expect(canonicalPrice(quote({ quoteUnit: "CONTRACT_UNIT" }))).toBeNull();
  });

  it("converts share-price quotes with a canonical multiplier before comparison", () => {
    expect(canonicalPrice(quote({ mid: 201, quoteUnit: "SHARE_PRICE", canonicalMultiplier: 12 }))).toBe(2412);
  });
});

describe("calculateOpportunities", () => {
  it("calculates open and close fees for both legs", () => {
    const opportunities = calculateOpportunities([
      quote({ venue: "OKX", bid: 110, ask: 111, mid: 110.5 }),
      quote({ venue: "Ventuals", symbol: "vntl:SPACEX", bid: 100, ask: 101, mid: 100.5, settleAsset: "USDH" })
    ], { ...DEFAULT_PARAMS, notionalUsd: 10_000, manualSlippageBps: 0 });
    expect(opportunities[0].longNotional + opportunities[0].shortNotional).toBeCloseTo(10_000);
    expect(opportunities[0].costBreakdown.openFees).toBeCloseTo(5);
    expect(opportunities[0].costBreakdown.closeFees).toBeCloseTo(5);
  });

  it("applies funding direction: positive long funding is a cost and positive short funding is income", () => {
    const opportunities = calculateOpportunities([
      quote({ venue: "OKX", bid: 110, ask: 111, mid: 110.5, fundingRateHourly: 0.001 }),
      quote({ venue: "Ventuals", symbol: "vntl:SPACEX", bid: 100, ask: 101, mid: 100.5, fundingRateHourly: 0.002, settleAsset: "USDH" })
    ], { ...DEFAULT_PARAMS, notionalUsd: 10_000, holdingHours: 2, manualSlippageBps: 0 });
    expect(opportunities[0].costBreakdown.funding).toBeCloseTo(8.72, 2);
  });

  it("lowers the remaining-spread redline as costs increase", () => {
    const quotes = [
      quote({ venue: "OKX", bid: 110, ask: 111, mid: 110.5 }),
      quote({ venue: "Ventuals", symbol: "vntl:SPACEX", bid: 100, ask: 101, mid: 100.5, settleAsset: "USDH" })
    ];
    const lowCost = calculateOpportunities(quotes, { ...DEFAULT_PARAMS, manualSlippageBps: 1 })[0];
    const highCost = calculateOpportunities(quotes, { ...DEFAULT_PARAMS, manualSlippageBps: 50 })[0];
    expect(highCost.costSpread).toBeGreaterThan(lowCost.costSpread);
    expect(highCost.breakEvenSpread).toBeLessThan(lowCost.breakEvenSpread);
    expect(highCost.breakEvenShortPriceAtLongClose).toBeGreaterThan(highCost.expectedClose);
    expect(highCost.breakEvenLongPriceAtShortClose).toBeLessThan(highCost.expectedClose);
  });

  it("reports the break-even remaining spread instead of only the cost buffer", () => {
    const opportunities = calculateOpportunities([
      quote({ venue: "OKX", target: "ANTHROPIC", symbol: "ANTHROPIC-USDT-SWAP", bid: 1717.5, ask: 1718, mid: 1717.75 }),
      quote({ venue: "Ventuals", target: "ANTHROPIC", symbol: "vntl:ANTHROPIC", bid: 1406, ask: 1406.8, mid: 1406.4, settleAsset: "USDH" })
    ], { ...DEFAULT_PARAMS, notionalUsd: 500, manualSlippageBps: 10 });

    expect(opportunities[0].longNotional).toBeCloseTo(225.14, 2);
    expect(opportunities[0].shortNotional).toBeCloseTo(274.86, 2);
    expect(opportunities[0].executableSpread).toBeCloseTo(310.7);
    expect(opportunities[0].breakEvenSpread).toBeGreaterThan(290);
    expect(opportunities[0].breakEvenSpread).toBeLessThan(310.7);
  });

  it("falls back to manual slippage when requested orderbook depth is insufficient", () => {
    const opportunities = calculateOpportunities([
      quote({ venue: "OKX", bid: 110, ask: 111, mid: 110.5, orderBook: { bids: [{ price: 110, size: 1 }], asks: [{ price: 111, size: 1 }] } }),
      quote({ venue: "Ventuals", symbol: "vntl:SPACEX", bid: 100, ask: 101, mid: 100.5, settleAsset: "USDH", orderBook: { bids: [], asks: [] } })
    ], { ...DEFAULT_PARAMS, slippageMode: "orderbook", manualSlippageBps: 7 });
    expect(opportunities[0].notes.length).toBeGreaterThan(0);
    expect(opportunities[0].costBreakdown.openSlippage).toBeGreaterThan(0);
  });

  it("applies canonical multipliers to orderbook slippage", () => {
    const opportunities = calculateOpportunities([
      quote({
        venue: "OKX",
        bid: 2420,
        ask: 2421,
        mid: 2420.5,
        orderBook: { bids: [{ price: 2420, size: 10 }], asks: [{ price: 2421, size: 10 }] }
      }),
      quote({
        venue: "TradeXYZ",
        symbol: "xyz:SPCX",
        bid: 200,
        ask: 201,
        mid: 200.5,
        quoteUnit: "SHARE_PRICE",
        canonicalMultiplier: 12,
        settleAsset: "USDC",
        orderBook: { bids: [{ price: 200, size: 10 }], asks: [{ price: 201, size: 10 }] }
      })
    ], { ...DEFAULT_PARAMS, slippageMode: "orderbook", manualSlippageBps: 0 });
    expect(opportunities[0].longEntry).toBeCloseTo(2412);
    expect(opportunities[0].costBreakdown.openSlippage).toBeGreaterThanOrEqual(0);
  });

  it("does not generate TradeXYZ opportunities for missing quotes", () => {
    const opportunities = calculateOpportunities([
      quote({ venue: "OKX", bid: 110, ask: 111, mid: 110.5 }),
      quote({ venue: "TradeXYZ", symbol: "xyz:OPENAI", target: "OPENAI", status: "missing", bid: null, ask: null, mid: null })
    ], DEFAULT_PARAMS);
    expect(opportunities.every((item) => item.longVenue !== "TradeXYZ" && item.shortVenue !== "TradeXYZ")).toBe(true);
  });
});
