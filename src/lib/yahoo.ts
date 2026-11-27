import { z } from "zod";
import { ProviderError, providerFetch, type Price, type RequestWindow } from "./market";

export const yahooSource = "Yahoo Finance · regular-session quotes";
export const yahooChartSource = "Yahoo Finance · daily chart";
export const yahooBatchSize = 50;

type SessionWindow = { opens_at: Date; closes_at: Date };
const price = z.number().finite().positive();
const timestamp = z.number().int().positive();
const quote = z.object({
  symbol: z.string(),
  currency: z.literal("USD"),
  market: z.literal("us_market"),
  regularMarketTime: timestamp,
  marketState: z.string(),
  regularMarketOpen: price.optional(),
  regularMarketPrice: price,
});
const quoteResponse = z.object({
  quoteResponse: z.object({ result: z.array(z.unknown()), error: z.null() }),
});
const dailyChart = z.object({
  meta: z.object({
    symbol: z.string(),
    currency: z.literal("USD"),
    exchangeTimezoneName: z.literal("America/New_York"),
    dataGranularity: z.literal("1d"),
    regularMarketTime: timestamp,
    regularMarketPrice: price,
  }),
  timestamp: z.array(timestamp).min(1),
  indicators: z.object({
    quote: z.tuple([z.object({ open: z.array(price.nullable()), close: z.array(price.nullable()) })]),
  }),
  events: z.object({ splits: z.record(z.string(), z.object({ date: timestamp })).optional() }).optional(),
});
const chartResponse = z.object({ chart: z.object({ result: z.tuple([dailyChart]), error: z.null() }) });

// Yahoo uses a hyphen for share classes that U.S. listings represent with a dot.
const yahooSymbol = (symbol: string) => symbol.replaceAll(".", "-");

export function yahooSessionConfigured() {
  return Boolean(process.env.YAHOO_FINANCE_COOKIE?.trim() || process.env.YAHOO_FINANCE_CRUMB?.trim());
}

async function yahooRequest<T>(
  url: URL,
  schema: z.ZodType<T>,
  headers: Record<string, string> = {},
  allowNotFound = false,
  window?: RequestWindow,
) {
  const rate = Math.min(5, Math.max(1, Number(process.env.YAHOO_FINANCE_REQUESTS_PER_MINUTE) || 5));
  try {
    const response = await providerFetch(
      "yahoo_finance",
      url.toString(),
      Math.ceil(60000 / rate),
      { Accept: "application/json", ...headers },
      allowNotFound,
      window,
    );
    return response ? schema.parse(await response.json()) : undefined;
  } catch (error) {
    if (error instanceof ProviderError) {
      error.message = `Yahoo Finance returned HTTP ${error.status}`;
      throw error;
    }
    // Transport errors and response bodies can contain the crumb or session data.
    throw new Error("Yahoo Finance quote request failed or returned an invalid response");
  }
}

export async function yahooQuotes(symbols: string[]) {
  const cookie = process.env.YAHOO_FINANCE_COOKIE?.trim();
  const crumb = process.env.YAHOO_FINANCE_CRUMB?.trim();
  if (!cookie || !crumb || /[^\x20-\x7e]/.test(cookie) || /\s/.test(crumb)) {
    throw new Error("Yahoo Finance requires a matching YAHOO_FINANCE_COOKIE and YAHOO_FINANCE_CRUMB");
  }
  const list = [...new Set(symbols.map(yahooSymbol))];
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.search = new URLSearchParams({ symbols: list.join(","), crumb, formatted: "false" }).toString();
  const body = await yahooRequest(url, quoteResponse, { Cookie: cookie });
  const bySymbol = new Map<string, z.infer<typeof quote>>();
  for (const item of body?.quoteResponse.result ?? []) {
    const parsed = quote.safeParse(item);
    if (parsed.success) bySymbol.set(parsed.data.symbol, parsed.data);
  }
  return new Map(symbols.map((symbol) => [symbol, bySymbol.get(yahooSymbol(symbol))]));
}

export function yahooSessionBar(
  value: z.infer<typeof quote> | undefined,
  date: string,
  session: SessionWindow,
): Price | undefined {
  if (!value?.regularMarketOpen || !["POST", "POSTPOST", "CLOSED"].includes(value.marketState)) return;
  if (!inSession(value.regularMarketTime, session)) return;
  return { date, open: value.regularMarketOpen, close: value.regularMarketPrice };
}

function inSession(quotedAt: number, session: SessionWindow) {
  // The final regular-session print can have a timestamp just after the scheduled close.
  return (
    quotedAt * 1000 >= session.opens_at.valueOf() && quotedAt * 1000 <= session.closes_at.valueOf() + 60000
  );
}

export async function yahooDailyChart(symbol: string, window?: RequestWindow) {
  const ticker = yahooSymbol(symbol);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.search = new URLSearchParams({
    range: "5d",
    interval: "1d",
    includePrePost: "false",
    events: "splits",
  }).toString();
  const payload = await yahooRequest(url, chartResponse, {}, true, window);
  const chart = payload?.chart.result[0];
  return chart?.meta.symbol === ticker ? chart : undefined;
}

export function yahooChartBar(
  chart: Awaited<ReturnType<typeof yahooDailyChart>>,
  date: string,
  session: SessionWindow,
): Price | undefined {
  if (!chart || !inSession(chart.meta.regularMarketTime, session)) return;
  const quotedOpen = chart.timestamp.at(-1)!;
  const { open, close } = chart.indicators.quote[0];
  if (
    quotedOpen * 1000 !== session.opens_at.valueOf() ||
    open.length !== chart.timestamp.length ||
    close.length !== chart.timestamp.length
  )
    return;
  if (Object.values(chart.events?.splits ?? {}).some((split) => split.date > quotedOpen)) return;

  const lastOpen = open.at(-1);
  const lastClose = close.at(-1);
  const quotedClose = chart.meta.regularMarketPrice;
  // Daily candle values can be rounded floats. Check against the current unadjusted regular quote.
  if (!lastOpen || !lastClose || Math.abs(lastClose / quotedClose - 1) > 0.000001) return;
  return { date, open: lastOpen, close: quotedClose };
}
