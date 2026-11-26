# Market data

## Free default

The regular-session price adapter uses Market History's documented keyless endpoint. One read retrieves the latest 100 bars for a unique symbol. The worker stores bars once in PostgreSQL and uses them for every entry and benchmark. It also fills eligible missed sessions from the same response. It uses the ranged endpoint when older sessions fall outside the rolling window. One database-backed rate budget across worker restarts limits calls to two per minute and honors Retry-After. Page and ticker search requests use PostgreSQL only.

The feed reports the first and last consolidated regular-session trades, typically after 48 hours. Auction prints from the listing exchange can differ. Results include the source session date. The provider's derived-use license permits publishing returns and scores. In free seasons, the public site and CSV withhold raw dollar prices and single-stock daily price series. [Endpoint documentation](https://getmarkethistory.com/docs/api/reference) · [Publication terms](https://getmarkethistory.com/docs/terms) · [U.S. session methodology](https://getmarkethistory.com/docs/guides/historical-stock-market-data/)

SEC issuer SIC metadata and Nasdaq Trader's security directory provide keyless eligibility inputs. Set `SEC_CONTACT` to an email address you monitor for the SEC User-Agent. Refresh is single-worker, rate limited, and issuer classification is cached. The directory identifies share class, instrument, test issues and exchange. Ambiguous classes are kept separate. An operator reviews identity conflicts, an inactive pick, or a security outside the initial industry filter. [SEC fair access](https://www.sec.gov/about/developer-resources) · [Nasdaq symbol-directory fields](https://www.nasdaqtrader.com/Trader.aspx?id=SymbolDirDefs)

A Market History key is optional for a corporate-action feed. Without one, the worker reports missing values and large unexplained moves for operator review. Those checks can miss small splits and special distributions. Review issuer filings, notices and successor terms before resolving discrepancies or publishing corrections. The worker finalizes only after it has verified action coverage through the final session or an administrator has attested to that coverage from documented records. Ordinary dividends do not enter the calculation. Usage limits and costs depend on the provider plan. [Corporate actions](https://getmarkethistory.com/docs/corporate-actions) · [Market History limits](https://getmarkethistory.com/docs/limits)

## Official prices

Set `MARKET_DATA_MODE=official` before the next season opens if an authorized source can provide regular-session opening and closing prices. Change the setting before the seed or weekly calendar renewal creates the season. The market mode is fixed when entries open. The Massive integration uses its unadjusted daily open/close and split endpoints. Set `MASSIVE_PUBLIC_DISPLAY_APPROVED=true` only after confirming the agreement covers your public website, analytics and exports. Massive's individual terms limit redistribution. [Massive daily summary](https://massive.com/docs/rest/stocks/aggregates/daily-ticker-summary) · [Massive data terms](https://massive.com/terms/market_data_terms.pdf)

A verified source can also be imported without adding an API adapter. The operator must have permission to use and publish the output appropriate to that season. Each input declares its provenance.

```json
{
  "type": "prices",
  "year": 2027,
  "source": "Provider and verification reference",
  "bars": [
    { "securityId": "00000000-0000-4000-8000-000000000001", "symbol": "EXAMPLE",
      "date": "2027-01-04", "open": "12.35", "close": "12.95" }
  ]
}
```

Run `npm run data:import -- /absolute/path/to/prices.json`. Security IDs come from the admin page's security selector or PostgreSQL. Prices must match a completed session and the correct symbol period. Use `--correction` only for a separately verified correction of a finalized year.

## Market calendar

The worker reads the NYSE holiday schedule and early-close dates, in America/New_York. It will provision the next annual season from a published future calendar. A verified Alpaca calendar account can supply the same role. The initial 2027 and 2028 schedules have a bundled fallback. For an extraordinary close or if the exchange changes its format, import a complete, source-verified exchange schedule and monitor the worker's calendar status. An imported calendar is used until replaced by another import. The database prevents calendar updates from reopening a locked season. [NYSE holidays and hours](https://www.nyse.com/trade/hours-calendars) · [Alpaca calendar](https://docs.alpaca.markets/reference/getcalendar-1)

A calendar import accepts `{"type":"calendar","year":2027,"source":"Source reference","sessions":[...]}`. Each session contains the ISO date and Eastern hours such as `{"date":"2027-01-04","open":"09:30","close":"16:00"}`. Include the full year in chronological order.
