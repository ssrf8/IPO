import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MARKET_CONFIGS, TARGETS } from "../shared/markets.config";
import type { MarketConfig, Target, Venue } from "../shared/types";
import { fetchJson } from "../server/utils";

type Interval = "1h" | "4h" | "1d";

interface Candle {
  time: number;
  close: number;
}

const interval = (process.env.INTERVAL ?? "1h") as Interval;
const days = Number(process.env.DAYS ?? 14);
const output = process.env.OUT ?? path.join("data", "history-spreads.csv");
const now = Date.now();
const startTime = Number(process.env.START_TIME ?? now - days * 24 * 60 * 60 * 1000);
const endTime = Number(process.env.END_TIME ?? now);

const intervalMs: Record<Interval, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

function canonicalClose(config: MarketConfig, close: number) {
  return close * config.canonicalMultiplier;
}

function bucketTime(time: number) {
  return Math.floor(time / intervalMs[interval]) * intervalMs[interval];
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function venueKey(venue: Venue) {
  return venue.toLowerCase();
}

function configuredSymbol(config: MarketConfig) {
  return config.symbol;
}

async function fetchOkxCandles(config: MarketConfig): Promise<Candle[]> {
  const url = new URL("https://www.okx.com/api/v5/market/candles");
  url.searchParams.set("instId", configuredSymbol(config));
  url.searchParams.set("bar", interval.toUpperCase());
  url.searchParams.set("limit", "300");
  const response = await fetchJson<{ code: string; data: string[][] }>(url.toString(), undefined, 20_000);
  let data = response.data;
  if (data.length === 0) {
    const historyUrl = new URL("https://www.okx.com/api/v5/market/history-candles");
    historyUrl.searchParams.set("instId", configuredSymbol(config));
    historyUrl.searchParams.set("bar", interval.toUpperCase());
    historyUrl.searchParams.set("limit", "300");
    data = (await fetchJson<{ code: string; data: string[][] }>(historyUrl.toString(), undefined, 20_000)).data;
  }
  return data
    .map((row) => ({ time: bucketTime(Number(row[0])), close: canonicalClose(config, Number(row[4])) }))
    .filter((item) => item.time >= startTime && item.time <= endTime)
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));
}

async function fetchBinanceCandles(config: MarketConfig): Promise<Candle[]> {
  const url = new URL("https://fapi.binance.com/fapi/v1/klines");
  url.searchParams.set("symbol", configuredSymbol(config));
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  url.searchParams.set("limit", "1500");
  const response = await fetchJson<Array<Array<number | string>>>(url.toString(), undefined, 20_000);
  if (!Array.isArray(response)) return [];
  return response
    .map((row) => ({ time: bucketTime(Number(row[0])), close: canonicalClose(config, Number(row[4])) }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));
}

async function fetchHyperliquidCandles(config: MarketConfig): Promise<Candle[]> {
  const response = await fetchJson<Array<{ t: number; c: string }>>(
    "https://api.hyperliquid.xyz/info",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: {
          coin: configuredSymbol(config),
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
    .map((row) => ({ time: bucketTime(row.t), close: canonicalClose(config, Number(row.c)) }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close));
}

async function fetchCandles(config: MarketConfig): Promise<Candle[]> {
  if (config.venue === "OKX") return fetchOkxCandles(config);
  if (config.venue === "Binance") return fetchBinanceCandles(config);
  return fetchHyperliquidCandles(config);
}

function spread(a: number | undefined, b: number | undefined) {
  if (a == null || b == null) return "";
  return a - b;
}

function spreadBps(a: number | undefined, b: number | undefined) {
  if (a == null || b == null || b === 0) return "";
  return (a - b) / b * 10_000;
}

function sortedTargets(): Target[] {
  return [...TARGETS];
}

async function main() {
  const rows: string[][] = [[
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
  ]];

  for (const target of sortedTargets()) {
    const configs = MARKET_CONFIGS.filter((config) => config.target === target && config.comparable);
    const byVenue = new Map<Venue, Map<number, number>>();

    for (const config of configs) {
      try {
        const candles = await fetchCandles(config);
        byVenue.set(config.venue, new Map(candles.map((candle) => [candle.time, candle.close])));
        console.log(`${target} ${config.venue}: ${candles.length} candles`);
      } catch (error) {
        console.warn(`${target} ${config.venue} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const times = [...new Set([...byVenue.values()].flatMap((series) => [...series.keys()]))].sort((a, b) => a - b);
    for (const time of times) {
      const prices = Object.fromEntries([...byVenue.entries()].map(([venue, series]) => [venueKey(venue), series.get(time)])) as Record<string, number | undefined>;
      const available = Object.entries(prices).filter((entry): entry is [string, number] => typeof entry[1] === "number");
      const max = available.reduce<[string, number] | null>((best, item) => (best == null || item[1] > best[1] ? item : best), null);
      const min = available.reduce<[string, number] | null>((best, item) => (best == null || item[1] < best[1] ? item : best), null);

      rows.push([
        new Date(time).toISOString(),
        target,
        prices.okx?.toFixed(6) ?? "",
        prices.binance?.toFixed(6) ?? "",
        prices.ventuals?.toFixed(6) ?? "",
        prices.tradexyz?.toFixed(6) ?? "",
        max?.[0] ?? "",
        min?.[0] ?? "",
        max && min ? (max[1] - min[1]).toFixed(6) : "",
        max && min ? String(spreadBps(max[1], min[1])) : "",
        String(spread(prices.okx, prices.binance)),
        String(spread(prices.okx, prices.ventuals)),
        String(spread(prices.okx, prices.tradexyz)),
        String(spread(prices.binance, prices.ventuals)),
        String(spread(prices.binance, prices.tradexyz)),
        String(spread(prices.ventuals, prices.tradexyz))
      ]);
    }
  }

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, rows.map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");
  console.log(`Wrote ${rows.length - 1} rows to ${output}`);
}

void main();
