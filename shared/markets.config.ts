import type { MarketConfig, Target } from "./types";

export const TARGETS: Target[] = ["SPACEX", "OPENAI", "ANTHROPIC"];

const okxFee = { feeMaker: 0.0002, feeTaker: 0.0005 };
const binanceFee = { feeMaker: 0.0002, feeTaker: 0.0005 };
const hip3Standard = { feeMaker: 0.0003, feeTaker: 0.0009 };
const spacexShareToValuationBillion = 12.05;

export const MARKET_CONFIGS: MarketConfig[] = [
  ...TARGETS.map((target) => ({
    venue: "OKX" as const,
    target,
    symbol: `${target}-USDT-SWAP`,
    quoteUnit: "VALUATION_BILLION" as const,
    settleAsset: "USDT" as const,
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    fundingIntervalHours: 8,
    fallbackFundingHourly: 0,
    ...okxFee
  })),
  {
    venue: "Binance",
    target: "SPACEX",
    symbol: "SPCXUSDT",
    aliases: ["SPACEXUSDT"],
    quoteUnit: "SHARE_PRICE",
    settleAsset: "USDT",
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: spacexShareToValuationBillion,
    fundingIntervalHours: 8,
    fallbackFundingHourly: null,
    ...binanceFee
  },
  {
    venue: "Binance",
    target: "OPENAI",
    symbol: "OPENAIUSDT",
    quoteUnit: "VALUATION_BILLION",
    settleAsset: "USDT",
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    fundingIntervalHours: 8,
    fallbackFundingHourly: null,
    ...binanceFee
  },
  {
    venue: "Binance",
    target: "ANTHROPIC",
    symbol: "ANTHROPICUSDT",
    quoteUnit: "VALUATION_BILLION",
    settleAsset: "USDT",
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    fundingIntervalHours: 8,
    fallbackFundingHourly: null,
    ...binanceFee
  },
  ...TARGETS.map((target) => ({
    venue: "Ventuals" as const,
    target,
    symbol: `vntl:${target}`,
    aliases: [`vntl:${target}-USDH`, `vntl:p${target}`, `vntl:${target === "ANTHROPIC" ? "ANTHRO" : target}`],
    quoteUnit: "VALUATION_BILLION" as const,
    settleAsset: "USDH" as const,
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    fundingIntervalHours: 1,
    fallbackFundingHourly: null,
    ...hip3Standard
  })),
  {
    venue: "TradeXYZ",
    target: "SPACEX",
    symbol: "xyz:SPCX",
    aliases: ["xyz:SPACEX"],
    quoteUnit: "SHARE_PRICE",
    settleAsset: "USDC",
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: spacexShareToValuationBillion,
    fundingIntervalHours: 1,
    fallbackFundingHourly: null,
    ...hip3Standard
  },
  {
    venue: "TradeXYZ",
    target: "OPENAI",
    symbol: "xyz:OPENAI",
    quoteUnit: "VALUATION_BILLION",
    settleAsset: "USDC",
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    fundingIntervalHours: 1,
    fallbackFundingHourly: null,
    ...hip3Standard
  },
  {
    venue: "TradeXYZ",
    target: "ANTHROPIC",
    symbol: "xyz:ANTHROPIC",
    quoteUnit: "VALUATION_BILLION",
    settleAsset: "USDC",
    comparable: true,
    contractMultiplier: 1,
    canonicalMultiplier: 1,
    fundingIntervalHours: 1,
    fallbackFundingHourly: null,
    ...hip3Standard
  }
];
