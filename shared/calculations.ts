import type { CalculationParams, MarketQuote, Opportunity } from "./types";
import { TARGETS } from "./markets.config";

export const DEFAULT_PARAMS: CalculationParams = {
  notionalUsd: 10_000,
  holdingHours: 24,
  feeModeOpen: "taker",
  feeModeClose: "taker",
  slippageMode: "manual",
  manualSlippageBps: 10,
  closingPrice: null,
  stablecoinHaircutsBps: {
    USDT: 0,
    USDC: 0,
    USDH: 0,
    USD: 0
  }
};

export function canonicalPrice(quote: MarketQuote): number | null {
  if (!quote.comparable || quote.status !== "ok" || quote.mid == null) return null;
  if (quote.quoteUnit === "VALUATION_BILLION") return quote.mid * quote.canonicalMultiplier;
  if (quote.quoteUnit === "SHARE_PRICE") return quote.mid * quote.canonicalMultiplier;
  return null;
}

function toCanonicalPrice(quote: MarketQuote, price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  if (quote.quoteUnit === "CONTRACT_UNIT") return null;
  return price * quote.canonicalMultiplier;
}

function feeRate(quote: MarketQuote, mode: "maker" | "taker") {
  return mode === "maker" ? quote.feeMaker : quote.feeTaker;
}

function estimateManualSlippage(notional: number, bps: number) {
  return notional * (bps / 10_000);
}

function vwap(levels: Array<{ price: number; size: number }>, quantity: number): number | null {
  let remaining = quantity;
  let total = 0;
  for (const level of levels) {
    const take = Math.min(remaining, level.size);
    total += take * level.price;
    remaining -= take;
    if (remaining <= 1e-10) return total / quantity;
  }
  return null;
}

function orderBookSlippage(quote: MarketQuote, side: "buy" | "sell", quantity: number, referencePrice: number) {
  if (!quote.orderBook) return null;
  const levels = (side === "buy" ? quote.orderBook.asks : quote.orderBook.bids)
    .map((level) => ({
      price: level.price * quote.canonicalMultiplier,
      size: level.size / quote.canonicalMultiplier
    }));
  const execution = vwap(levels, quantity);
  if (execution == null) return null;
  const diff = side === "buy" ? execution - referencePrice : referencePrice - execution;
  return Math.max(0, diff * quantity);
}

function estimateSlippage(quote: MarketQuote, side: "buy" | "sell", params: CalculationParams, referencePrice: number, quantity: number, notionalUsd: number) {
  if (params.slippageMode === "orderbook") {
    const fromBook = orderBookSlippage(quote, side, quantity, referencePrice);
    if (fromBook != null) return { value: fromBook, note: null };
    return {
      value: estimateManualSlippage(notionalUsd, params.manualSlippageBps),
      note: `${quote.venue} ${quote.symbol} 订单簿深度不足，使用手动滑点`
    };
  }
  return { value: estimateManualSlippage(notionalUsd, params.manualSlippageBps), note: null };
}

function fundingCost(longQuote: MarketQuote, shortQuote: MarketQuote, params: CalculationParams, longNotional: number, shortNotional: number) {
  const longRate = longQuote.fundingRateHourly ?? 0;
  const shortRate = shortQuote.fundingRateHourly ?? 0;
  const longCost = longNotional * longRate * params.holdingHours;
  const shortCost = -shortNotional * shortRate * params.holdingHours;
  return longCost + shortCost;
}

function stablecoinHaircutCost(longQuote: MarketQuote, shortQuote: MarketQuote, params: CalculationParams, longNotional: number, shortNotional: number) {
  const longHaircut = params.stablecoinHaircutsBps[longQuote.settleAsset] ?? 0;
  const shortHaircut = params.stablecoinHaircutsBps[shortQuote.settleAsset] ?? 0;
  return longNotional * (longHaircut / 10_000) + shortNotional * (shortHaircut / 10_000);
}

export function calculateOpportunities(quotes: MarketQuote[], params: CalculationParams): Opportunity[] {
  const opportunities: Opportunity[] = [];

  for (const target of TARGETS) {
    const targetQuotes = quotes
      .filter((quote) => quote.target === target)
      .map((quote) => ({ quote, price: canonicalPrice(quote) }))
      .filter((item): item is { quote: MarketQuote; price: number } => item.price != null);

    for (let i = 0; i < targetQuotes.length; i += 1) {
      for (let j = i + 1; j < targetQuotes.length; j += 1) {
        const a = targetQuotes[i];
        const b = targetQuotes[j];
        const high = a.price >= b.price ? a : b;
        const low = a.price >= b.price ? b : a;
        const shortEntry = toCanonicalPrice(high.quote, high.quote.bid) ?? high.price;
        const longEntry = toCanonicalPrice(low.quote, low.quote.ask) ?? low.price;
        if (shortEntry <= longEntry) continue;

        const expectedClose = params.closingPrice && params.closingPrice > 0
          ? params.closingPrice
          : (high.price + low.price) / 2;
        const quantity = params.notionalUsd / (shortEntry + longEntry);
        const longNotional = quantity * longEntry;
        const shortNotional = quantity * shortEntry;
        const closeLegNotional = quantity * expectedClose;
        const grossPnl = (shortEntry - expectedClose) * quantity + (expectedClose - longEntry) * quantity;
        const openFees = shortNotional * feeRate(high.quote, params.feeModeOpen) + longNotional * feeRate(low.quote, params.feeModeOpen);
        const closeFees = closeLegNotional * (feeRate(high.quote, params.feeModeClose) + feeRate(low.quote, params.feeModeClose));
        const shortOpenSlippage = estimateSlippage(high.quote, "sell", params, shortEntry, quantity, shortNotional);
        const longOpenSlippage = estimateSlippage(low.quote, "buy", params, longEntry, quantity, longNotional);
        const shortCloseSlippage = estimateSlippage(high.quote, "buy", params, expectedClose, quantity, closeLegNotional);
        const longCloseSlippage = estimateSlippage(low.quote, "sell", params, expectedClose, quantity, closeLegNotional);
        const openSlippage = shortOpenSlippage.value + longOpenSlippage.value;
        const closeSlippage = shortCloseSlippage.value + longCloseSlippage.value;
        const funding = fundingCost(low.quote, high.quote, params, longNotional, shortNotional);
        const stablecoinHaircut = stablecoinHaircutCost(low.quote, high.quote, params, longNotional, shortNotional);
        const totalCost = openFees + closeFees + openSlippage + closeSlippage + funding + stablecoinHaircut;
        const netPnl = grossPnl - totalCost;
        const executableSpread = shortEntry - longEntry;
        const executableSpreadBps = executableSpread / longEntry * 10_000;
        const costSpread = totalCost / quantity;
        const costSpreadBps = costSpread / longEntry * 10_000;
        const breakEvenSpread = executableSpread - costSpread;
        const breakEvenSpreadBps = breakEvenSpread / longEntry * 10_000;
        const breakEvenShortPriceAtLongClose = expectedClose + breakEvenSpread;
        const breakEvenLongPriceAtShortClose = expectedClose - breakEvenSpread;
        const maxProfitSpread = 0;
        const maxProfitPnl = executableSpread * quantity - totalCost;
        const notes = [
          shortOpenSlippage.note,
          longOpenSlippage.note,
          shortCloseSlippage.note,
          longCloseSlippage.note
        ].filter((note): note is string => Boolean(note));

        opportunities.push({
          id: `${target}-${low.quote.venue}-${high.quote.venue}`,
          target,
          longVenue: low.quote.venue,
          shortVenue: high.quote.venue,
          longSymbol: low.quote.symbol,
          shortSymbol: high.quote.symbol,
          longEntry,
          shortEntry,
          expectedClose,
          hedgeQuantity: quantity,
          longNotional,
          shortNotional,
          totalNotional: params.notionalUsd,
          executableSpread,
          executableSpreadBps,
          grossPnl,
          totalCost,
          netPnl,
          netReturnBps: netPnl / params.notionalUsd * 10_000,
          costSpread,
          costSpreadBps,
          breakEvenSpread,
          breakEvenSpreadBps,
          breakEvenShortPriceAtLongClose,
          breakEvenLongPriceAtShortClose,
          maxProfitSpread,
          maxProfitPnl,
          profitable: netPnl > 0 && breakEvenSpread >= 0,
          costBreakdown: {
            openFees,
            closeFees,
            openSlippage,
            closeSlippage,
            funding,
            stablecoinHaircut
          },
          notes
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.netReturnBps - a.netReturnBps);
}
