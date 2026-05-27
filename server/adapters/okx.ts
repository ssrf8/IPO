import { MARKET_CONFIGS } from "../../shared/markets.config";
import type { MarketQuote } from "../../shared/types";
import { completedQuote, emptyQuote, fetchJson, firstFinite, parseLevel } from "../utils";

interface OkxResponse<T> {
  code: string;
  msg: string;
  data: T[];
}

interface OkxTicker {
  instId: string;
  bidPx: string;
  askPx: string;
  last: string;
  markPx?: string;
  ts: string;
}

interface OkxFunding {
  fundingRate?: string;
  nextFundingRate?: string;
  settFundingRate?: string;
  fundingTime?: string;
}

interface OkxBook {
  bids: string[][];
  asks: string[][];
}

interface OkxMarkPrice {
  instId: string;
  markPx: string;
  ts: string;
}

const BASE_URL = "https://www.okx.com";

export async function fetchOkxQuotes(): Promise<MarketQuote[]> {
  const configs = MARKET_CONFIGS.filter((config) => config.venue === "OKX");
  const results = await Promise.all(configs.map(async (config) => {
    try {
      const [tickerRes, fundingRes, markRes, bookRes] = await Promise.all([
        fetchJson<OkxResponse<OkxTicker>>(`${BASE_URL}/api/v5/market/ticker?instId=${config.symbol}`),
        fetchJson<OkxResponse<OkxFunding>>(`${BASE_URL}/api/v5/public/funding-rate?instId=${config.symbol}`).catch(() => null),
        fetchJson<OkxResponse<OkxMarkPrice>>(`${BASE_URL}/api/v5/public/mark-price?instType=SWAP&instId=${config.symbol}`).catch(() => null),
        fetchJson<OkxResponse<OkxBook>>(`${BASE_URL}/api/v5/market/books?instId=${config.symbol}&sz=20`).catch(() => null)
      ]);
      const ticker = tickerRes.data[0];
      if (!ticker) return emptyQuote(config, "missing", "OKX 未返回该合约行情");
      const bid = firstFinite(ticker.bidPx);
      const ask = firstFinite(ticker.askPx);
      const mid = bid != null && ask != null ? (bid + ask) / 2 : firstFinite(ticker.last);
      const fundingRaw = firstFinite(
        fundingRes?.data?.[0]?.fundingRate,
        fundingRes?.data?.[0]?.nextFundingRate,
        fundingRes?.data?.[0]?.settFundingRate
      );
      const fundingRateHourly = fundingRaw == null ? config.fallbackFundingHourly : fundingRaw / config.fundingIntervalHours;
      const book = bookRes?.data?.[0];
      return completedQuote(config, {
        bid,
        ask,
        mid,
        mark: firstFinite(markRes?.data?.[0]?.markPx, ticker.markPx, ticker.last),
        fundingRateHourly,
        orderBook: book
          ? {
              bids: book.bids.map(parseLevel).filter((level): level is NonNullable<typeof level> => Boolean(level)),
              asks: book.asks.map(parseLevel).filter((level): level is NonNullable<typeof level> => Boolean(level))
            }
          : undefined
      });
    } catch (error) {
      return emptyQuote(config, "error", error instanceof Error ? error.message : "OKX 请求失败");
    }
  }));
  return results;
}
