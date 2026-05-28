import { MARKET_CONFIGS, TARGETS } from "../shared/markets.config";
import type { HistoricalSpreadRow, MarketConfig, Target, Venue } from "../shared/types";
import { fetchJson } from "./utils";

type Interval = "1h" | "4h" | "1d";

interface Candle {
  time: number;
  close: number;
}

export interface HistoryOptions {
  interval?: Interval;
  days?: number;
  startTime?: number;
  endTime?: number;
}

const intervalMs: Record<Interval, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

function canonicalClose(config: MarketConfig, close: number) {
  return close * config.canonicalMultiplier;
}

function bucketTime(time: number, interval: Interval) {
  return Math.floor(time / intervalMs[interval]) * intervalMs[interval];
}

function venueKey(venue: Venue) {
  return venue.toLowerCase();
}

function spread(a: number | undefined, b: number | undefined) {
  if (a == null || b == null) return null;
  return a - b;
}

function spreadBps(a: number | undefined, b: number | undefined) {
  if (a == null || b == null || b === 0) return null;
  return (a - b) / b * 10_000;
}

async function fetchOkxCandles(config: MarketConfig, interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
  const url = new URL("https://www.okx.com/api/v5/market/candles");
  url.searchParams.set("instId", config.symbol);
  url.searchParams.set("bar", interval.toUpperCase());
  url.searchParams.set("limit", "300");
  const response = await fetchJson<{ code: string; data: string[][] }>(url.toString(), undefined, 20_000);
  let data = response.data;
  if (data.length === 0) {
    const historyUrl = new URL("https://www.okx.com/api/v5/market/history-candles");
    historyUrl.searchParams.set("instId", config.symbol);
    historyUrl.searchParams.set("bar", interval.toUpperCase());
    historyUrl.searchParams.set("limit", "300");
    data = (await fetchJson<{ code: string; data: string[][] }>(historyUrl.toString(), undefined, 20_000)).data;
  }
  return data
    .map((row) => ({ time: bucketTime(Number(row[0]), interval), close: canonicalClose(config, Number(row[4])) }))
    .filter((item) => item.time >= startTime && item.time <= endTime)
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));
}

async function fetchBinanceCandles(config: MarketConfig, interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", config.symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  url.searchParams.set("limit", "1500");
  const response = await fetchJson<Array<Array<number | string>>>(url.toString(), undefined, 20_000);
  if (!Array.isArray(response)) return [];
  return response
    .map((row) => ({ time: bucketTime(Number(row[0]), interval), close: canonicalClose(config, Number(row[4])) }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));
}

async function fetchHyperliquidCandles(config: MarketConfig, interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
  const response = await fetchJson<Array<{ t: number; c: string }>>(
    "https://api.hyperliquid.xyz/info",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: config.symbol,
          interval,
          startTime,
          endTime
        }
      })
    },
    20_000
  );
  if (!Array.isArray(response)) return [];
  return response
    .map((row) => ({ time: bucketTime(row.t, interval), close: canonicalClose(config, Number(row.c)) }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));
}

async function fetchCandles(config: MarketConfig, interval: Interval, startTime: number, endTime: number): Promise<Candle[]> {
  if (config.venue === "OKX") return fetchOkxCandles(config, interval, startTime, endTime);
  if (config.venue === "Binance") return fetchBinanceCandles(config, interval, startTime, endTime);
  return fetchHyperliquidCandles(config, interval, startTime, endTime);
}

function sortedTargets(): Target[] {
  return [...TARGETS];
}

export async function collectHistoricalSpreads(options: HistoryOptions = {}) {
  const interval = options.interval ?? "1h";
  const days = options.days ?? 2;
  const endTime = options.endTime ?? Date.now();
  const startTime = options.startTime ?? endTime - days * 24 * 60 * 60 * 1000;
  const rows: HistoricalSpreadRow[] = [];
  const warnings: string[] = [];

  for (const target of sortedTargets()) {
    const configs = MARKET_CONFIGS.filter((config) => config.target === target && config.comparable);
    const byVenue = new Map<Venue, Map<number, number>>();

    for (const config of configs) {
      try {
        const candles = await fetchCandles(config, interval, startTime, endTime);
        byVenue.set(config.venue, new Map(candles.map((candle) => [candle.time, candle.close])));
      } catch (error) {
        warnings.push(`${target} ${config.venue}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const times = [...new Set([...byVenue.values()].flatMap((series) => [...series.keys()]))].sort((a, b) => a - b);
    for (const time of times) {
      const prices = Object.fromEntries([...byVenue.entries()].map(([venue, series]) => [venueKey(venue), series.get(time) ?? null])) as HistoricalSpreadRow["prices"];
      const available = Object.entries(prices).filter((entry): entry is [string, number] => typeof entry[1] === "number");
      const max = available.reduce<[string, number] | null>((best, item) => (best == null || item[1] > best[1] ? item : best), null);
      const min = available.reduce<[string, number] | null>((best, item) => (best == null || item[1] < best[1] ? item : best), null);

      rows.push({
        time,
        target,
        prices,
        maxVenue: max?.[0] ?? null,
        minVenue: min?.[0] ?? null,
        maxMinSpread: max && min ? max[1] - min[1] : null,
        maxMinSpreadBps: max && min ? spreadBps(max[1], min[1]) : null,
        spreads: {
          okxBinance: spread(prices.okx ?? undefined, prices.binance ?? undefined),
          okxVentuals: spread(prices.okx ?? undefined, prices.ventuals ?? undefined),
          okxTradexyz: spread(prices.okx ?? undefined, prices.tradexyz ?? undefined),
          binanceVentuals: spread(prices.binance ?? undefined, prices.ventuals ?? undefined),
          binanceTradexyz: spread(prices.binance ?? undefined, prices.tradexyz ?? undefined),
          ventualsTradexyz: spread(prices.ventuals ?? undefined, prices.tradexyz ?? undefined)
        }
      });
    }
  }

  return {
    generatedAt: Date.now(),
    interval,
    startTime,
    endTime,
    rows,
    warnings
  };
}

export function historicalRowsToCsv(rows: HistoricalSpreadRow[]) {
  const headers = [
    "time",
    "target",
    "okx",
    "binance",
    "ventuals",
    "tradexyz",
    "maxVenue",
    "minVenue",
    "maxMinSpread",
    "maxMinSpreadBps",
    "okx_binance_spread",
    "okx_ventuals_spread",
    "okx_tradexyz_spread",
    "binance_ventuals_spread",
    "binance_tradexyz_spread",
    "ventuals_tradexyz_spread"
  ];

  const csvRows = rows.map((row) => [
    new Date(row.time).toISOString(),
    row.target,
    row.prices.okx,
    row.prices.binance,
    row.prices.ventuals,
    row.prices.tradexyz,
    row.maxVenue,
    row.minVenue,
    row.maxMinSpread,
    row.maxMinSpreadBps,
    row.spreads.okxBinance,
    row.spreads.okxVentuals,
    row.spreads.okxTradexyz,
    row.spreads.binanceVentuals,
    row.spreads.binanceTradexyz,
    row.spreads.ventualsTradexyz
  ]);

  return [headers, ...csvRows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
