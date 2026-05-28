import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectHistoricalSpreads, historicalRowsToCsv } from "../server/history";

const interval = process.env.INTERVAL ?? "1h";
const days = Number(process.env.DAYS ?? 14);
const output = process.env.OUT ?? path.join("data", "history-spreads.csv");
const now = Date.now();
const startTime = Number(process.env.START_TIME ?? now - days * 24 * 60 * 60 * 1000);
const endTime = Number(process.env.END_TIME ?? now);

async function main() {
  const result = await collectHistoricalSpreads({ interval: interval as "1h" | "4h" | "1d", days, startTime, endTime });
  result.warnings.forEach((warning) => console.warn(warning));

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, historicalRowsToCsv(result.rows), "utf8");
  console.log(`Wrote ${result.rows.length} rows to ${output}`);
}

void main();
