import { DateTime } from "luxon";
import { z } from "zod";
import { setTimeout as waitFor } from "node:timers/promises";
import { one, query } from "./db";
import { zone } from "./calendar";

export type Price = {
  date: string;
  open: number | string;
  close: number | string;
  high?: number | string | null;
  low?: number | string | null;
};
export const freeSource = "Market History · regular-session bars";
export const officialSource = "Massive · daily open/close";

export class ProviderError extends Error {
  constructor(
    public status: number,
    public wait: number,
  ) {
    super(`Provider returned HTTP ${status}`);
  }
}

export type RequestWindow = { signal?: AbortSignal; before?: Date };

async function reserve(name: string, interval: number, window: RequestWindow) {
  window.signal?.throwIfAborted();
  const deadline = window.before?.valueOf() ?? Infinity;
  if (Date.now() >= deadline) return false;
  const slot = await one<{ wait: string }>(
    `INSERT INTO provider_requests VALUES($1,now()+$2*interval '1 millisecond')
    ON CONFLICT(name) DO UPDATE SET next_at=greatest(provider_requests.next_at,clock_timestamp())+$2*interval '1 millisecond'
    RETURNING greatest(0,extract(epoch FROM next_at-clock_timestamp())*1000-$2) AS wait`,
    [name, interval],
  );
  const wait = Number(slot.wait);
  if (wait > 0) {
    if (Date.now() + wait + 50 >= deadline) return false;
    await waitFor(wait + 50, undefined, { signal: window.signal });
  }
  return Date.now() < deadline;
}
export async function providerFetch(
  name: string,
  url: string,
  interval: number,
  headers: Record<string, string> = {},
  allowNotFound = false,
  window: RequestWindow = {},
): Promise<Response | undefined> {
  if (!(await reserve(name, interval, window))) return;
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: window.signal ? AbortSignal.any([window.signal, timeout]) : timeout,
    redirect: "error",
  });
  if (response.ok) return response;
  if (response.status === 404 && allowNotFound) return;
  const retryHeader = response.headers.get("retry-after");
  const wait =
    retryHeader && /^\d+$/.test(retryHeader)
      ? Number(retryHeader)
      : retryHeader
        ? Math.max(0, (Date.parse(retryHeader) - Date.now()) / 1000)
        : 0;
  if (response.status === 429 || response.status === 503) {
    await query(
      "UPDATE provider_requests SET next_at=greatest(next_at,now()+$2*interval '1 second') WHERE name=$1",
      [name, Math.max(60, wait || 0)],
    );
  }
  throw new ProviderError(response.status, wait || 0);
}

const validPrice = z.number().finite().positive();
const historyBar = z.object({
  open: validPrice,
  close: validPrice,
  high: validPrice.optional(),
  low: validPrice.optional(),
  timestamp: z.iso.datetime(),
  symbol: z.string(),
  symbol_id: z.number().int().positive(),
  is_gap: z.boolean().optional(),
});
const marketHistoryInterval = () =>
  Math.ceil(60000 / Math.max(1, Math.min(2, Number(process.env.MARKET_HISTORY_REQUESTS_PER_MINUTE) || 2)));
export async function historyBars(symbol: string, start?: string, end?: string) {
  const url = new URL(`https://getmarkethistory.com/api/v1/bars/stocks/us/${encodeURIComponent(symbol)}/1d`);
  url.searchParams.set("hours", "regular");
  if (start) url.searchParams.set("start", start);
  if (end) url.searchParams.set("end", end);
  const bars: (Price & { symbolId: number })[] = [];
  do {
    const response = await providerFetch("market_history", url.toString(), marketHistoryInterval(), {}, true);
    if (!response) return bars;
    if (response.headers.get("x-hours") !== "regular")
      throw new Error("Regular-session market bars were not confirmed");
    for (const line of (await response.text()).split("\n").filter(Boolean)) {
      const bar = historyBar.parse(JSON.parse(line));
      const date = DateTime.fromISO(bar.timestamp).setZone(zone).toISODate()!;
      if (!bar.is_gap && bar.symbol === symbol)
        bars.push({
          date,
          open: bar.open,
          close: bar.close,
          high: bar.high,
          low: bar.low,
          symbolId: bar.symbol_id,
        });
    }
    const cursor = response.headers.get("x-next-cursor");
    if (!cursor || !start) break;
    url.searchParams.set("cursor", cursor);
  } while (true);
  return bars;
}

type MassiveTicker = {
  ticker: string;
  name: string;
  primary_exchange: string;
  type?: string;
  sic_code?: string;
  sic_description?: string;
  market_cap?: number;
  share_class_figi?: string;
  composite_figi?: string;
  active: boolean;
};
export const massiveInterval = () =>
  Math.ceil(60000 / Math.max(1, Number(process.env.MASSIVE_REQUESTS_PER_MINUTE) || 5));
export async function massiveRequest<T>(path: string) {
  if (!process.env.MASSIVE_API_KEY || process.env.MASSIVE_PUBLIC_DISPLAY_APPROVED !== "true") return;
  const url = new URL(path, "https://api.massive.com");
  if (url.origin !== "https://api.massive.com") throw new Error("Invalid market provider URL");
  const response = await providerFetch(
    "massive",
    url.toString(),
    massiveInterval(),
    { Authorization: `Bearer ${process.env.MASSIVE_API_KEY}` },
    true,
  );
  return response ? ((await response.json()) as T) : undefined;
}
export async function massiveSecurity(symbol: string, date?: string) {
  const result = await massiveRequest<{ results?: MassiveTicker }>(
    `/v3/reference/tickers/${encodeURIComponent(symbol)}${date ? `?date=${date}` : ""}`,
  );
  return result?.results;
}
export async function officialBar(symbol: string, date: string): Promise<Price | undefined> {
  const data = await massiveRequest<unknown>(
    `/v1/open-close/${encodeURIComponent(symbol)}/${date}?adjusted=false`,
  );
  if (!data) return;
  const bar = z
    .object({
      status: z.literal("OK"),
      from: z.literal(date),
      symbol: z.literal(symbol),
      open: validPrice,
      close: validPrice,
      high: validPrice.optional(),
      low: validPrice.optional(),
    })
    .parse(data);
  return { ...bar, date };
}

export async function massiveSplits(symbol: string, date: string) {
  const result = await massiveRequest<unknown>(
    `/stocks/v1/splits?ticker=${encodeURIComponent(symbol)}&execution_date=${date}&limit=10`,
  );
  if (!result) return [];
  return (
    z
      .object({
        results: z
          .array(
            z.object({
              execution_date: z.literal(date),
              split_from: validPrice,
              split_to: validPrice,
              id: z.string(),
            }),
          )
          .optional(),
      })
      .parse(result).results ?? []
  );
}

export async function savePrice(id: string, symbol: string, bar: Price, source: string) {
  await query(
    `INSERT INTO daily_prices(security_id,session_date,symbol,open,close,high,low,source)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(security_id,session_date) DO UPDATE SET open=excluded.open,close=excluded.close,
    high=excluded.high,low=excluded.low,symbol=excluded.symbol,source=excluded.source,fetched_at=now()
    WHERE daily_prices.source = excluded.source`,
    [id, bar.date, symbol, bar.open, bar.close, bar.high ?? null, bar.low ?? null, source],
  );
}

const historyAction = z.object({
  type: z.string(),
  symbol: z.string(),
  id: z.string(),
  ex_date: z.string().nullable().optional(),
  process_date: z.string().nullable().optional(),
  rate: validPrice.nullable().optional(),
  old_rate: validPrice.nullable().optional(),
  new_rate: validPrice.nullable().optional(),
  special: z.boolean().nullable().optional(),
});
export async function historyActions(symbol: string, start: string, end: string) {
  const key = process.env.MARKET_HISTORY_ACTIONS_KEY;
  if (!key) return null;
  const url = new URL("https://getmarkethistory.com/query/v1/corporate-actions");
  url.search = new URLSearchParams({ ticker: symbol, start, end }).toString();
  const response = await providerFetch("market_history_actions", url.toString(), 35000, {
    Authorization: `Bearer ${key}`,
  });
  return (await response!.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => historyAction.parse(JSON.parse(line)));
}
