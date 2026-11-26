import { DateTime } from "luxon";
import { one, query, transaction } from "./db";
import { zone } from "./calendar";
import { providerFetch } from "./market";

const secExchanges: Record<string, string> = {
  Nasdaq: "XNAS",
  NYSE: "XNYS",
  "NYSE American": "XASE",
  Cboe: "BATS",
};
const otherExchanges: Record<string, string> = { N: "XNYS", A: "XASE", Z: "BATS" };
const sicEligibility = new Set(["2833", "2834", "2835", "2836"]);
export type Security = {
  id: string;
  provider_key: string;
  symbol: string;
  name: string;
  exchange: string;
  instrument: string;
  industry: string | null;
  market_cap: string | null;
  active: boolean;
  provider_eligible: boolean;
  eligibility_override: boolean | null;
  benchmark: boolean;
  checked_at: Date;
  market_history_id: string | null;
};

export async function saveSecurity(value: {
  key: string;
  symbol: string;
  name: string;
  exchange: string;
  instrument: string;
  industry?: string;
  marketCap?: number;
  eligible: boolean;
  issuer?: string;
  benchmark?: boolean;
}) {
  const today = DateTime.now().setZone(zone).toISODate()!;
  return transaction(async (db) => {
    const old = await one<Security>(
      "SELECT * FROM securities WHERE provider_key=$1 FOR UPDATE",
      [value.key],
      db,
    );
    const displaced = await query<{ id: string }>(
      "UPDATE securities SET active=false WHERE symbol=$1 AND provider_key <> $2 AND active RETURNING id",
      [value.symbol, value.key],
      db,
    );
    if (displaced.length) {
      const ids = displaced.map(({ id }) => id);
      await db.query(
        "DELETE FROM security_symbols WHERE security_id=ANY($1::uuid[]) AND valid_until IS NULL AND valid_from=$2",
        [ids, today],
      );
      await db.query(
        "UPDATE security_symbols SET valid_until=$2 WHERE security_id=ANY($1::uuid[]) AND valid_until IS NULL AND valid_from<$2",
        [ids, today],
      );
    }
    const row = await one<Security>(
      `INSERT INTO securities(provider_key,symbol,name,exchange,instrument,industry,market_cap,active,provider_eligible,issuer_key,benchmark)
      VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10) ON CONFLICT(provider_key) DO UPDATE SET
      symbol=excluded.symbol,name=excluded.name,exchange=excluded.exchange,industry=excluded.industry,
      active=true,provider_eligible=excluded.provider_eligible,checked_at=now(),
      market_cap=coalesce(excluded.market_cap,securities.market_cap) RETURNING *`,
      [
        value.key,
        value.symbol,
        value.name,
        value.exchange,
        value.instrument,
        value.industry ?? null,
        value.marketCap ?? null,
        value.eligible,
        value.issuer ?? null,
        value.benchmark ?? false,
      ],
      db,
    );
    if (!old) {
      await db.query("INSERT INTO security_symbols(security_id,symbol,valid_from) VALUES($1,$2,$3)", [
        row.id,
        row.symbol,
        displaced.length ? today : "1900-01-01",
      ]);
    } else if (
      old.symbol !== row.symbol ||
      !(await one(
        "SELECT 1 FROM security_symbols WHERE security_id=$1 AND valid_until IS NULL",
        [row.id],
        db,
      ))
    ) {
      await db.query(
        "DELETE FROM security_symbols WHERE security_id=$1 AND valid_until IS NULL AND valid_from=$2",
        [row.id, today],
      );
      await db.query(
        "UPDATE security_symbols SET valid_until=$2 WHERE security_id=$1 AND valid_until IS NULL",
        [row.id, today],
      );
      await db.query("INSERT INTO security_symbols(security_id,symbol,valid_from) VALUES($1,$2,$3)", [
        row.id,
        row.symbol,
        today,
      ]);
    }
    return row;
  });
}

export async function ensureBenchmarks() {
  for (const [symbol, name] of [
    ["XBI", "SPDR S&P Biotech ETF"],
    ["IBB", "iShares Biotechnology ETF"],
    ["SPY", "SPDR S&P 500 ETF"],
  ]) {
    await saveSecurity({
      key: `benchmark:${symbol}`,
      symbol,
      name,
      exchange: "ARCX",
      instrument: "ETF",
      eligible: false,
      benchmark: true,
    });
  }
}

function classifyIssue(name: string) {
  const raw = name.includes(" - ") ? name.slice(name.lastIndexOf(" - ") + 3) : name;
  if (/unsponsored|preferred|warrant|notes? due|rights$|units$|debenture|exchange.traded/i.test(raw)) return;
  if (/american deposit[ao]ry|\bADSs?\b/i.test(raw)) return "ADR";
  if (/\bcommon (stock|shares?)\b|\bordinary shares?\b|\bcapital stock\b/i.test(raw)) {
    const stockClass = raw.match(/\bclass\s+([a-z0-9-]+)\b/i)?.[1]?.toLowerCase() ?? "common";
    return `common:${stockClass}`;
  }
}

async function venueDirectory() {
  const result = new Map<string, { instrument: string; exchange: string }>();
  for (const file of ["nasdaqlisted", "otherlisted"]) {
    const response = await providerFetch(
      "nasdaq_directory",
      `https://www.nasdaqtrader.com/dynamic/SymDir/${file}.txt`,
      1000,
    );
    const listing = (await response!.text()).split(/\r?\n/);
    if (listing.length < 500 || !listing.some((line) => line.startsWith("File Creation Time:")))
      throw new Error("Incomplete exchange directory");
    for (const line of listing.slice(1)) {
      const fields = line.split("|");
      if (fields.length < 8 || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(fields[0])) continue;
      const nasdaq = file === "nasdaqlisted";
      const exchange = nasdaq ? "XNAS" : otherExchanges[fields[2]];
      const etf = fields[nasdaq ? 6 : 4];
      const test = fields[nasdaq ? 3 : 6];
      const instrument = classifyIssue(fields[1]);
      if (exchange && etf === "N" && test === "N" && instrument)
        result.set(fields[0], { exchange, instrument });
    }
  }
  return result;
}

type SecIssuer = { sic: string | null; sicDescription?: string };
const cleanName = (value: string) =>
  value.length > 3 && value === value.toUpperCase()
    ? value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    : value;

export async function refreshSecurities(complete = false) {
  const contact = process.env.SEC_CONTACT;
  if (!contact) return;
  const headers = { "User-Agent": `BioTradesX (${contact})`, Accept: "application/json" };
  const response = await providerFetch(
    "sec",
    "https://www.sec.gov/files/company_tickers_exchange.json",
    650,
    headers,
  );
  const listing = (await response!.json()) as { fields: string[]; data: [number, string, string, string][] };
  if (listing.fields.join(",") !== "cik,name,ticker,exchange" || listing.data.length < 1000)
    throw new Error("Incomplete SEC exchange reference");
  const venue = await venueDirectory();
  const candidates = listing.data.filter(
    ([, , symbol, exchange]) => venue.get(symbol)?.exchange === secExchanges[exchange] && venue.has(symbol),
  );
  const eligibleCandidates = candidates.sort(
    (a, b) =>
      Number(/bio|pharma|therapeut|oncolog|genet|medicine/i.test(b[1])) -
      Number(/bio|pharma|therapeut|oncolog|genet|medicine/i.test(a[1])),
  );
  const known = new Map(
    (
      await query<{ cik: string; industry_code: string | null; industry: string | null; fresh: boolean }>(
        "SELECT *, checked_at >= now()-interval '30 days' AS fresh FROM issuer_reference",
      )
    ).map((row) => [row.cik, row]),
  );
  const ambiguous = new Set<string>();
  const identities = new Set<string>();
  for (const [issuer, , symbol] of eligibleCandidates) {
    const key = `sec:${issuer}:${venue.get(symbol)!.instrument}`;
    if (identities.has(key)) ambiguous.add(key);
    identities.add(key);
  }
  let lookups = 0;
  const existing = await query<Security & { issuer_key: string | null }>(
    "SELECT * FROM securities WHERE issuer_key IS NOT NULL AND active",
  );
  const previousKeys = new Set(existing.map((security) => security.provider_key));
  for (const [issuer, rawName, symbol] of eligibleCandidates) {
    const cik = String(issuer);
    const market = venue.get(symbol)!;
    const base = `sec:${cik}:${market.instrument}`;
    const key = ambiguous.has(base) ? `${base}:${symbol}` : base;
    let reference = known.get(cik);
    if (!reference?.fresh && (complete || lookups < 120 || previousKeys.has(key))) {
      const result = await providerFetch(
        "sec",
        `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`,
        650,
        headers,
        true,
      );
      if (!result) continue;
      const data = (await result.json()) as SecIssuer;
      reference = { cik, fresh: true, industry_code: data.sic, industry: data.sicDescription ?? null };
      known.set(cik, reference);
      lookups++;
      await query(
        `INSERT INTO issuer_reference(cik,industry_code,industry) VALUES($1,$2,$3)
        ON CONFLICT(cik) DO UPDATE SET industry_code=excluded.industry_code,industry=excluded.industry,checked_at=now()`,
        [cik, reference.industry_code, reference.industry],
      );
    }
    if (!reference || (!sicEligibility.has(reference.industry_code ?? "") && !previousKeys.has(key)))
      continue;
    await saveSecurity({
      key,
      issuer: cik,
      symbol,
      name: cleanName(rawName),
      exchange: market.exchange,
      instrument: market.instrument,
      industry: reference.industry ?? undefined,
      eligible: sicEligibility.has(reference.industry_code ?? ""),
    });
  }
  const candidateSymbols = new Set(eligibleCandidates.map(([, , ticker]) => ticker));
  for (const security of existing) {
    if (!candidateSymbols.has(security.symbol)) {
      await query("UPDATE securities SET active=false,checked_at=now() WHERE id=$1 AND symbol=$2", [
        security.id,
        security.symbol,
      ]);
    }
  }
}

export async function searchSecurities(value: string) {
  const term = value.replace(/[\\%_]/g, "\\$&");
  return query<
    Pick<Security, "id" | "symbol" | "name" | "exchange" | "industry" | "market_cap"> & { eligible: boolean }
  >(
    `SELECT id,symbol,name,exchange,industry,market_cap,
       (active AND NOT benchmark AND coalesce(eligibility_override,provider_eligible)
        AND checked_at > now()-interval '7 days') AS eligible
     FROM securities
     WHERE NOT benchmark AND (symbol ILIKE $1 OR name ILIKE $2)
     ORDER BY (upper(symbol)=upper($3)) DESC, active DESC, provider_eligible DESC, symbol LIMIT 15`,
    [`${term}%`, `%${term}%`, value],
  );
}
