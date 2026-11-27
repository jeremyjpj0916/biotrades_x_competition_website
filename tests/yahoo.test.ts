import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, query } from "../src/lib/db";
import {
  yahooChartBar,
  yahooDailyChart,
  yahooQuotes,
  yahooSessionBar,
  yahooSessionConfigured,
} from "../src/lib/yahoo";

vi.mock("../src/lib/db", () => ({ one: vi.fn(), query: vi.fn() }));

const date = "2027-11-26";
const session = {
  opens_at: new Date(`${date}T14:30:00Z`),
  closes_at: new Date(`${date}T18:00:00Z`),
};
const completedQuote = {
  symbol: "XBI",
  currency: "USD" as const,
  market: "us_market" as const,
  marketState: "POST",
  regularMarketOpen: 90,
  regularMarketPrice: 95,
  regularMarketTime: session.closes_at.valueOf() / 1000,
  postMarketPrice: 110,
};
const fetchQuote = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.mocked(one).mockResolvedValue({ wait: "0" });
  vi.stubGlobal("fetch", fetchQuote);
  vi.stubEnv("YAHOO_FINANCE_COOKIE", "fixture=value");
  vi.stubEnv("YAHOO_FINANCE_CRUMB", "fixture+/crumb");
  vi.stubEnv("YAHOO_FINANCE_REQUESTS_PER_MINUTE", "2");
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Yahoo Finance public daily chart", () => {
  const opening = session.opens_at.valueOf() / 1000;
  const chart: NonNullable<Awaited<ReturnType<typeof yahooDailyChart>>> = {
    meta: {
      symbol: "XBI",
      currency: "USD",
      exchangeTimezoneName: "America/New_York",
      dataGranularity: "1d",
      regularMarketTime: completedQuote.regularMarketTime,
      regularMarketPrice: 95,
    },
    timestamp: [opening - 172800, opening],
    indicators: { quote: [{ open: [89, 90], close: [93, 95.000005] }] },
  };

  it("fetches a daily candle without credentials and checks its close against the regular quote", async () => {
    vi.stubEnv("YAHOO_FINANCE_COOKIE", "");
    vi.stubEnv("YAHOO_FINANCE_CRUMB", "");
    fetchQuote.mockResolvedValueOnce(Response.json({ chart: { error: null, result: [chart] } }));
    expect(yahooSessionConfigured()).toBe(false);
    const result = await yahooDailyChart("XBI");
    const [input, options] = fetchQuote.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/v8/finance/chart/XBI");
    expect(url.searchParams.get("includePrePost")).toBe("false");
    expect(url.searchParams.get("events")).toBe("splits");
    expect(url.searchParams.has("crumb")).toBe(false);
    expect(new Headers(options?.headers).has("cookie")).toBe(false);
    expect(one).toHaveBeenCalledWith(expect.any(String), ["yahoo_finance", 30000]);
    expect(yahooChartBar(result, date, session)).toEqual({ date, open: 90, close: 95 });
  });

  it("rejects stale charts, mismatched closing prices, and candles restated for later splits", () => {
    expect(yahooChartBar({ ...chart, timestamp: [opening - 172800] }, date, session)).toBeUndefined();
    expect(yahooChartBar({ ...chart, timestamp: [opening] }, date, session)).toBeUndefined();
    expect(
      yahooChartBar(
        { ...chart, meta: { ...chart.meta, regularMarketTime: opening - 172800 } },
        date,
        session,
      ),
    ).toBeUndefined();
    expect(
      yahooChartBar({ ...chart, meta: { ...chart.meta, regularMarketPrice: 190 } }, date, session),
    ).toBeUndefined();
    expect(
      yahooChartBar({ ...chart, events: { splits: { next: { date: opening + 86400 } } } }, date, session),
    ).toBeUndefined();
  });

  it("skips a chart request when its next rate slot falls after the exchange opening", async () => {
    vi.mocked(one).mockResolvedValueOnce({ wait: "60000" });
    await expect(yahooDailyChart("XBI", { before: new Date(Date.now() + 30000) })).resolves.toBeUndefined();
    expect(fetchQuote).not.toHaveBeenCalled();
  });
});

describe("Yahoo Finance session quotes", () => {
  it("uses one authenticated request for the batch and stores regular-session values for an early close", async () => {
    fetchQuote.mockResolvedValueOnce(
      Response.json({
        quoteResponse: {
          result: [completedQuote, { ...completedQuote, symbol: "BRK-A" }, { symbol: "BAD" }],
          error: null,
        },
      }),
    );
    const quotes = await yahooQuotes(["XBI", "BRK.A", "XBI", "BAD"]);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    const [input, options] = fetchQuote.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://query1.finance.yahoo.com");
    expect(url.pathname).toBe("/v7/finance/quote");
    expect(url.searchParams.get("crumb")).toBe("fixture+/crumb");
    expect(url.searchParams.get("symbols")).toBe("XBI,BRK-A,BAD");
    expect(options).toMatchObject({ headers: { Cookie: "fixture=value" }, redirect: "error" });
    expect(one).toHaveBeenCalledWith(expect.any(String), ["yahoo_finance", 30000]);
    expect(yahooSessionBar(quotes.get("XBI"), date, session)).toEqual({ date, open: 90, close: 95 });
    expect(quotes.get("BRK.A")?.symbol).toBe("BRK-A");
    expect(quotes.get("BAD")).toBeUndefined();
  });

  it("skips quotes from a different session, premarket, and an incomplete open", () => {
    for (const quote of [
      { ...completedQuote, marketState: "PRE" },
      { ...completedQuote, marketState: "REGULAR" },
      { ...completedQuote, regularMarketTime: completedQuote.regularMarketTime - 86400 },
      { ...completedQuote, regularMarketTime: completedQuote.regularMarketTime + 120 },
      { ...completedQuote, regularMarketOpen: undefined },
    ]) {
      expect(yahooSessionBar(quote, date, session)).toBeUndefined();
    }
  });

  it("requires both session credentials before using the request budget", async () => {
    vi.stubEnv("YAHOO_FINANCE_CRUMB", "");
    await expect(yahooQuotes(["XBI"])).rejects.toThrow(
      "matching YAHOO_FINANCE_COOKIE and YAHOO_FINANCE_CRUMB",
    );
    expect(one).not.toHaveBeenCalled();
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("shares Retry-After with the worker and omits secrets from provider errors", async () => {
    fetchQuote.mockResolvedValueOnce(
      new Response("fixture+/crumb", { status: 429, headers: { "Retry-After": "120" } }),
    );
    await expect(yahooQuotes(["XBI"])).rejects.toMatchObject({
      message: "Yahoo Finance returned HTTP 429",
      status: 429,
      wait: 120,
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), ["yahoo_finance", 120]);
    fetchQuote.mockRejectedValueOnce(new Error("failed fetch with fixture+/crumb"));
    await expect(yahooQuotes(["XBI"])).rejects.toThrow(
      /^Yahoo Finance quote request failed or returned an invalid response$/,
    );
  });
});
