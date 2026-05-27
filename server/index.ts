import cors from "cors";
import express from "express";
import type { DashboardResponse, MarketQuote, Venue } from "../shared/types";
import { fetchBinanceQuotes } from "./adapters/binance";
import { fetchHyperliquidVenueQuotes } from "./adapters/hyperliquid";
import { fetchOkxQuotes } from "./adapters/okx";

const app = express();
const port = Number(process.env.PORT ?? 8799);

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

app.listen(port, "127.0.0.1", () => {
  console.log(`API server listening on http://127.0.0.1:${port}`);
});
