export type Venue = "OKX" | "Binance" | "Ventuals" | "TradeXYZ";

export type Target = "SPACEX" | "OPENAI" | "ANTHROPIC";

export type QuoteUnit = "VALUATION_BILLION" | "SHARE_PRICE" | "CONTRACT_UNIT";

export type QuoteStatus = "ok" | "missing" | "unavailable" | "error" | "unsupported";

export type FeeMode = "maker" | "taker";

export type SlippageMode = "manual" | "orderbook";

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface MarketQuote {
  venue: Venue;
  symbol: string;
  target: Target;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  mark: number | null;
  oracle: number | null;
  fundingRateHourly: number | null;
  fundingIntervalHours: number;
  feeMaker: number;
  feeTaker: number;
  contractMultiplier: number;
  canonicalMultiplier: number;
  quoteUnit: QuoteUnit;
  settleAsset: "USDT" | "USDC" | "USDH" | "USD";
  comparable: boolean;
  timestamp: number;
  status: QuoteStatus;
  message?: string;
  orderBook?: {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  };
}

export interface MarketConfig {
  venue: Venue;
  target: Target;
  symbol: string;
  aliases?: string[];
  quoteUnit: QuoteUnit;
  settleAsset: MarketQuote["settleAsset"];
  comparable: boolean;
  contractMultiplier: number;
  canonicalMultiplier: number;
  feeMaker: number;
  feeTaker: number;
  fundingIntervalHours: number;
  fallbackFundingHourly: number | null;
}

export interface DashboardResponse {
  generatedAt: number;
  quotes: MarketQuote[];
  sourceErrors: Array<{
    venue: Venue;
    message: string;
  }>;
}

export interface HistoricalSpreadRow {
  time: number;
  target: Target;
  prices: {
    okx?: number | null;
    binance?: number | null;
    ventuals?: number | null;
    tradexyz?: number | null;
  };
  maxVenue: string | null;
  minVenue: string | null;
  maxMinSpread: number | null;
  maxMinSpreadBps: number | null;
  spreads: {
    okxBinance: number | null;
    okxVentuals: number | null;
    okxTradexyz: number | null;
    binanceVentuals: number | null;
    binanceTradexyz: number | null;
    ventualsTradexyz: number | null;
  };
}

export interface HistoricalSpreadsResponse {
  generatedAt: number;
  interval: string;
  startTime: number;
  endTime: number;
  rows: HistoricalSpreadRow[];
  warnings: string[];
}

export interface CalculationParams {
  notionalUsd: number;
  holdingHours: number;
  feeModeOpen: FeeMode;
  feeModeClose: FeeMode;
  slippageMode: SlippageMode;
  manualSlippageBps: number;
  closingPrice?: number | null;
  stablecoinHaircutsBps: Record<string, number>;
}

export interface Opportunity {
  id: string;
  target: Target;
  longVenue: Venue;
  shortVenue: Venue;
  longSymbol: string;
  shortSymbol: string;
  longEntry: number;
  shortEntry: number;
  expectedClose: number;
  hedgeQuantity: number;
  longNotional: number;
  shortNotional: number;
  totalNotional: number;
  executableSpread: number;
  executableSpreadBps: number;
  grossPnl: number;
  totalCost: number;
  netPnl: number;
  netReturnBps: number;
  costSpread: number;
  costSpreadBps: number;
  breakEvenSpread: number;
  breakEvenSpreadBps: number;
  breakEvenShortPriceAtLongClose: number;
  breakEvenLongPriceAtShortClose: number;
  maxProfitSpread: number;
  maxProfitPnl: number;
  profitable: boolean;
  costBreakdown: {
    openFees: number;
    closeFees: number;
    openSlippage: number;
    closeSlippage: number;
    funding: number;
    stablecoinHaircut: number;
  };
  notes: string[];
}
