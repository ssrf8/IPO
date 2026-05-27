import type { MarketConfig, MarketQuote, OrderBookLevel, QuoteStatus } from "../shared/types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json() as T;
  } catch (error) {
    const method = init?.method?.toUpperCase() ?? "GET";
    if (method === "GET") return fallbackGetJson<T>(url, timeoutMs, error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fallbackGetJson<T>(url: string, timeoutMs: number, originalError: unknown): Promise<T> {
  try {
    const curlCommand = process.platform === "win32" ? "curl.exe" : "curl";
    const { stdout } = await execFileAsync(
      curlCommand,
      ["-sS", "--max-time", String(Math.max(2, Math.ceil(timeoutMs / 1000))), url],
      {
        timeout: timeoutMs + 5_000,
        maxBuffer: 10 * 1024 * 1024
      }
    );
    return JSON.parse(stdout) as T;
  } catch {
    throw originalError;
  }
}

export function emptyQuote(config: MarketConfig, status: QuoteStatus, message?: string): MarketQuote {
  return {
    venue: config.venue,
    symbol: config.symbol,
    target: config.target,
    bid: null,
    ask: null,
    mid: null,
    mark: null,
    oracle: null,
    fundingRateHourly: config.fallbackFundingHourly,
    fundingIntervalHours: config.fundingIntervalHours,
    feeMaker: config.feeMaker,
    feeTaker: config.feeTaker,
    contractMultiplier: config.contractMultiplier,
    canonicalMultiplier: config.canonicalMultiplier,
    quoteUnit: config.quoteUnit,
    settleAsset: config.settleAsset,
    comparable: config.comparable,
    timestamp: Date.now(),
    status,
    message
  };
}

export function completedQuote(
  config: MarketConfig,
  values: Partial<Pick<MarketQuote, "bid" | "ask" | "mid" | "mark" | "oracle" | "fundingRateHourly" | "orderBook" | "symbol">>
): MarketQuote {
  return {
    ...emptyQuote(config, "ok"),
    ...values,
    fundingRateHourly: values.fundingRateHourly ?? config.fallbackFundingHourly,
    timestamp: Date.now()
  };
}

export function parseLevel(raw: unknown[]): OrderBookLevel | null {
  const price = Number(raw[0]);
  const size = Number(raw[1]);
  if (!Number.isFinite(price) || !Number.isFinite(size)) return null;
  return { price, size };
}

export function firstFinite(...values: Array<unknown>) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}
