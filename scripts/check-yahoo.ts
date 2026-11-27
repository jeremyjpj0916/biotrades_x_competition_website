import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { pool } = await import("../src/lib/db");
const { yahooDailyChart, yahooQuotes, yahooSessionConfigured } = await import("../src/lib/yahoo");

try {
  if (yahooSessionConfigured()) {
    const quotes = await yahooQuotes(["SPY"]);
    if (!quotes.get("SPY")) throw new Error("Yahoo Finance did not return a valid SPY quote");
    console.info("Yahoo Finance accepted the session credentials and returned a SPY quote.");
  } else {
    const chart = await yahooDailyChart("SPY");
    const candle = chart?.indicators.quote[0];
    if (!candle?.open.at(-1) || !candle.close.at(-1)) {
      throw new Error("Yahoo Finance did not return a valid SPY daily bar");
    }
    console.info("Yahoo Finance returned a SPY daily bar without credentials.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Yahoo Finance check failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
