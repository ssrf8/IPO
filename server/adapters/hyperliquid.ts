import { MARKET_CONFIGS } from "../../shared/markets.config";
import type { MarketConfig, MarketQuote, Venue } from "../../shared/types";
import { completedQuote, emptyQuote, fetchJson, firstFinite } from "../utils";

const BASE_URL = "https://api.hyperliquid.xyz/info";

type DexName = "vntl" | "xyz";

function dexForVenue(venue: Venue): DexName | null {
  if (venue === "Ventuals") return "vntl";
  if (venue === "TradeXYZ") return "xyz";
  return null;
}

function candidateSymbols(config: MarketConfig) {
  return [config.symbol, ...(config.aliases ?? [])];
}

async function postInfo<T>(body: Record<string, unknown>) {
  return fetchJson<T>(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function l2Book(symbol: string) {
  try {
    const response = await postInfo<{ levels?: Array<Array<{ px: string; sz: string }>> }>({
      type: "l2Book",
      coin: symbol
    });
    return response.levels
      ? {
          bids: response.levels[0].map((level) => ({ price: Number(level.px), size: Number(level.sz) })).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size)),
          asks: response.levels[1].map((level) => ({ price: Number(level.px), size: Number(level.sz) })).filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
        }
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchDexQuotes(venue: Venue, dex: DexName): Promise<MarketQuote[]> {
  const configs = MARKET_CONFIGS.filter((config) => config.venue === venue);
  try {
    const [meta, assetContexts] = await postInfo<[
      { universe?: Array<{ name: string }> },
      Array<{
        funding?: string | null;
        markPx?: string | null;
        oraclePx?: string | null;
        midPx?: string | null;
      }>
    ]>({ type: "metaAndAssetCtxs", dex });
    const listedNames = new Set((meta.universe ?? []).map((item) => item.name));
    const contextByName = new Map<string, NonNullable<typeof assetContexts>[number]>();
    (meta.universe ?? []).forEach((asset, index) => {
      const context = assetContexts[index];
      if (context) contextByName.set(asset.name, context);
    });

    return Promise.all(configs.map(async (config) => {
      const symbol = candidateSymbols(config).find((candidate) => listedNames.has(candidate));
      if (!symbol) {
        const detail = venue === "TradeXYZ"
          ? "TradeXYZ xyz dex 未发现该合约；Ventuals vntl 合约会显示在 Ventuals 列"
          : `${venue} 未发现该合约`;
        return emptyQuote(config, "missing", detail);
      }
      const context = contextByName.get(symbol);
      const mid = firstFinite(context?.midPx, context?.markPx, context?.oraclePx);
      if (mid == null) return emptyQuote({ ...config, symbol }, "missing", `${venue} 未返回中间价`);
      const book = await l2Book(symbol);
      const bid = book?.bids[0]?.price ?? mid;
      const ask = book?.asks[0]?.price ?? mid;
      return completedQuote(config, {
        symbol,
        bid,
        ask,
        mid,
        mark: firstFinite(context?.markPx),
        oracle: firstFinite(context?.oraclePx),
        fundingRateHourly: context?.funding == null ? config.fallbackFundingHourly : Number(context.funding) / config.fundingIntervalHours,
        orderBook: book
      });
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : `${venue} 请求失败`;
    return configs.map((config) => emptyQuote(config, "unavailable", message));
  }
}

export async function fetchHyperliquidVenueQuotes(venue: Venue): Promise<MarketQuote[]> {
  const dex = dexForVenue(venue);
  if (!dex) return [];
  return fetchDexQuotes(venue, dex);
}
