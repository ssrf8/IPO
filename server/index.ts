import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DashboardResponse, MarketQuote, Venue } from "../shared/types";
import { fetchBinanceQuotes } from "./adapters/binance";
import { fetchHyperliquidVenueQuotes } from "./adapters/hyperliquid";
import { fetchOkxQuotes } from "./adapters/okx";
import { collectHistoricalSpreads } from "./history";

const app = express();
const port = Number(process.env.PORT ?? 8799);
const host = process.env.HOST ?? "127.0.0.1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "..", "dist");

app.use(cors());

async function collectQuotes(): Promise<DashboardResponse> {
  const batches = await Promise.allSettled([
    fetchOkxQuotes(),
    fetchBinanceQuotes(),
    fetchHyperliquidVenueQuotes("Ventuals"),
    fetchHyperliquidVenueQuotes("TradeXYZ")
  ]);

  const quotes: MarketQuote[] = [];
  const sourceErrors: DashboardResponse["sourceErrors"] = [];
  const venues: Venue[] = ["OKX", "Binance", "Ventuals", "TradeXYZ"];

  batches.forEach((batch, index) => {
    if (batch.status === "fulfilled") {
      quotes.push(...batch.value);
    } else {
      sourceErrors.push({
        venue: venues[index],
        message: batch.reason instanceof Error ? batch.reason.message : String(batch.reason)
      });
    }
  });

  return {
    generatedAt: Date.now(),
    quotes,
    sourceErrors
  };
}

app.get("/api/quotes", async (_req, res) => {
  try {
    res.json(await collectQuotes());
  } catch (error) {
    res.status(500).json({
      generatedAt: Date.now(),
      quotes: [],
      sourceErrors: [{ venue: "OKX", message: error instanceof Error ? error.message : "unknown error" }]
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: Date.now() });
});

app.get("/api/history-spreads", async (req, res) => {
  try {
    const days = Number(req.query.days ?? 2);
    const interval = String(req.query.interval ?? "1h") as "1h" | "4h" | "1d";
    res.json(await collectHistoricalSpreads({ days, interval }));
  } catch (error) {
    res.status(500).json({
      generatedAt: Date.now(),
      interval: String(req.query.interval ?? "1h"),
      startTime: 0,
      endTime: 0,
      rows: [],
      warnings: [error instanceof Error ? error.message : String(error)]
    });
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
