import { z } from "zod";
import { ProviderError, providerFetch, type Price } from "./market";

export const yahooSource = "Yahoo Finance · regular-session quotes";
export const yahooBatchSize = 50;

const price = z.number().finite().positive();
const quote = z.object({
  symbol: z.string(),
  currency: z.literal("USD"),
  market: z.literal("us_market"),
  regularMarketTime: z.number().int().positive(),
  marketState: z.string(),
  regularMarketOpen: price.optional(),
  regularMarketPrice: price,
});
const quoteResponse = z.object({
  quoteResponse: z.object({ result: z.array(z.unknown()), error: z.null() }),
});

export async function yahooQuotes(symbols: string[]) {
  const cookie = process.env.YAHOO_FINANCE_COOKIE?.trim();
  const crumb = process.env.YAHOO_FINANCE_CRUMB?.trim();
  if (!cookie || !crumb || /[^\x20-\x7e]/.test(cookie) || /\s/.test(crumb)) {
    throw new Error("Yahoo Finance requires a matching YAHOO_FINANCE_COOKIE and YAHOO_FINANCE_CRUMB");
  }
  // Yahoo uses a hyphen for share classes that U.S. listings represent with a dot.
  const yahooSymbol = (symbol: string) => symbol.replaceAll(".", "-");
  const list = [...new Set(symbols.map(yahooSymbol))];
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.search = new URLSearchParams({ symbols: list.join(","), crumb, formatted: "false" }).toString();
  const rate = Math.min(5, Math.max(1, Number(process.env.YAHOO_FINANCE_REQUESTS_PER_MINUTE) || 5));
  try {
    const response = await providerFetch("yahoo_finance", url.toString(), Math.ceil(60000 / rate), {
      Accept: "application/json",
      Cookie: cookie,
    });
    const body = quoteResponse.parse(await response!.json());
    const bySymbol = new Map<string, z.infer<typeof quote>>();
    for (const item of body.quoteResponse.result) {
      const parsed = quote.safeParse(item);
      if (parsed.success) bySymbol.set(parsed.data.symbol, parsed.data);
    }
    return new Map(symbols.map((symbol) => [symbol, bySymbol.get(yahooSymbol(symbol))]));
  } catch (error) {
    if (error instanceof ProviderError) {
      error.message = `Yahoo Finance returned HTTP ${error.status}`;
      throw error;
    }
    // Transport errors and response bodies can contain the crumb or session data.
    throw new Error("Yahoo Finance quote request failed or returned an invalid response");
  }
}

export function yahooSessionBar(
  value: z.infer<typeof quote> | undefined,
  date: string,
  session: { opens_at: Date; closes_at: Date },
): Price | undefined {
  if (!value?.regularMarketOpen || !["POST", "POSTPOST", "CLOSED"].includes(value.marketState)) return;
  const quotedAt = value.regularMarketTime * 1000;
  // The final regular-session print can have a timestamp just after the scheduled close.
  if (quotedAt < session.opens_at.valueOf() || quotedAt > session.closes_at.valueOf() + 60000) return;
  return { date, open: value.regularMarketOpen, close: value.regularMarketPrice };
}
