import { MARKET_CONFIGS } from "../../shared/markets.config";
import type { MarketConfig, MarketQuote } from "../../shared/types";
import { completedQuote, emptyQuote, fetchJson, firstFinite } from "../utils";

interface BinanceTicker {
  symbol: string;
  bidPrice: string;
  askPrice: string;
  lastPrice: string;
}

interface BinancePremium {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
}

interface BinanceDepth {
  bids: string[][];
  asks: string[][];
}

const BASE_URL = process.env.BINANCE_FAPI_BASE_URL ?? "https://fapi.binance.com";

function candidateSymbols(config: MarketConfig) {
  return [config.symbol, ...(config.aliases ?? [])];
}

export async function fetchBinanceQuotes(): Promise<MarketQuote[]> {
  const configs = MARKET_CONFIGS.filter((config) => config.venue === "Binance");
  return Promise.all(configs.map(async (config) => {
    try {
      const resolved = await resolveTicker(config);
      if (!resolved) return emptyQuote(config, "missing", "Binance 未发现该盘前合约");
      const { symbol, ticker } = resolved;
      const [premium, depth] = await Promise.all([
        fetchJson<BinancePremium>(`${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`).catch(() => null),
        fetchJson<BinanceDepth>(`${BASE_URL}/fapi/v1/depth?symbol=${symbol}&limit=20`).catch(() => null)
      ]);
      const bid = firstFinite(ticker.bidPrice);
      const ask = firstFinite(ticker.askPrice);
      return completedQuote(config, {
        symbol,
        bid,
        ask,
        mid: bid != null && ask != null ? (bid + ask) / 2 : firstFinite(ticker.lastPrice),
        mark: firstFinite(premium?.markPrice),
        oracle: firstFinite(premium?.indexPrice),
        fundingRateHourly: premium?.lastFundingRate == null ? config.fallbackFundingHourly : Number(premium.lastFundingRate) / config.fundingIntervalHours,
        orderBook: depth
          ? {
              bids: depth.bids.map(([price, size]) => ({ price: Number(price), size: Number(size) })).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size)),
              asks: depth.asks.map(([price, size]) => ({ price: Number(price), size: Number(size) })).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
            }
          : undefined
      });
    } catch (error) {
      return emptyQuote(config, "error", error instanceof Error ? error.message : "Binance 合约请求失败");
    }
  }));
}

async function resolveTicker(config: MarketConfig): Promise<{ symbol: string; ticker: BinanceTicker } | null> {
  let unavailableMessage: string | null = null;
  for (const symbol of candidateSymbols(config)) {
    try {
      const ticker = await fetchJson<BinanceTicker>(`${BASE_URL}/fapi/v1/ticker/bookTicker?symbol=${symbol}`, undefined, 2_500);
      if (ticker.symbol !== symbol) continue;
      return { symbol, ticker };
    } catch (error) {
      unavailableMessage = error instanceof Error ? error.message : "Binance 请求失败";
    }
  }
  if (unavailableMessage?.includes("aborted") || unavailableMessage?.includes("fetch failed")) {
    throw new Error(`Binance API 不可用：${unavailableMessage}`);
  }
  return null;
}
