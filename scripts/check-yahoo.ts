import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { pool } = await import("../src/lib/db");
const { yahooQuotes } = await import("../src/lib/yahoo");

try {
  const quotes = await yahooQuotes(["SPY"]);
  if (!quotes.get("SPY")) throw new Error("Yahoo Finance did not return a valid SPY quote");
  console.info("Yahoo Finance accepted the credentials and returned a SPY quote.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Yahoo Finance check failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
