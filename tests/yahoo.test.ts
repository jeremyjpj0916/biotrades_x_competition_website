import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { one, query } from "../src/lib/db";
import { yahooQuotes, yahooSessionBar } from "../src/lib/yahoo";

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
