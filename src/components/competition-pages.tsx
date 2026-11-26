import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Download,
  FlaskConical,
  LockKeyhole,
  Search,
  Trophy,
  UsersRound,
} from "lucide-react";
import { type Season, listSeasons } from "@/lib/calendar";
import { dateLabel, integer, money, percent, returnClass } from "@/lib/format";
import { one } from "@/lib/db";
import {
  availableDates,
  boardOptions,
  getBenchmarks,
  getBoard,
  getOverview,
  getPerformanceSeries,
  getRankSeries,
  getStats,
  getStocks,
  getStockSeries,
  revealed,
  stringValue,
  type Standing,
} from "@/lib/public-data";
import { Avatar, Empty, PageHeading, Phase, SeasonTabs, SeasonTimeline, StandingsTable, Value } from "./ui";
import { Bars, SeriesChart } from "./charts";
import { profileFor, session } from "@/lib/session";

export type SearchParams = Record<string, string | string[] | undefined>;
const pickLink = (year: number, securityId: string) => `/competitions/${year}/stocks/${securityId}`;
const standingsUrl = (year: number) => `/competitions/${year}/leaderboard`;
function pageLink(path: string, data: SearchParams, page: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data))
    if (typeof value === "string" && value) params.set(key, value);
  params.set("page", String(page));
  return `${path}?${params}`;
}
export function MarketMethod({ season }: { season: Season }) {
  return (
    <p className="data-note">
      {season.data_mode === "free" ? (
        <>
          Returns use first and last regular-session trades, typically available after 48 hours. Raw prices
          stay private under the{" "}
          <a className="text-link" href="https://getmarkethistory.com/docs/terms">
            Market History license
          </a>
          .
        </>
      ) : (
        "Returns use verified regular-session opening and closing prices."
      )}
    </p>
  );
}
export function PrivatePicks({ season }: { season: Season }) {
  return (
    <div className="panel">
      <Empty
        icon={LockKeyhole}
        title="Picks are still private"
        text={`Picks become public at market open on ${dateLabel(season.locks_at)}.`}
        href="/join"
        action="Join competition"
      />
    </div>
  );
}
export async function CompetitionOverview({ season }: { season: Season }) {
  const [summary, board, history] = await Promise.all([
    getOverview(season),
    getBoard(season, { limit: 5 }),
    season.final_revision
      ? one<{ reason: string; published_at: Date }>(
          "SELECT reason,published_at FROM archives WHERE year=$1 AND revision=$2",
          [season.year, season.final_revision],
        )
      : null,
  ]);
  const champions =
    season.final_revision && board.rows[0]?.rank === 1 ? await getBoard(season, { limit: 20000 }) : null;
  return (
    <>
      <PageHeading
        tag="Annual competition"
        title={`${season.year} season`}
        description={`BioTrades X biotech stock-picking competition · ${season.phase}`}
      />
      <SeasonTabs year={season.year} active="Overview" />
      {history && (
        <div className="notice">
          Official results · Revision {season.final_revision} · {dateLabel(history.published_at)} ·{" "}
          {history.reason}
        </div>
      )}
      {champions && (
        <section className="panel page-panel">
          <div className="section-title">
            <Trophy />
            <h2>Season champions</h2>
          </div>
          <div className="trophy-list">
            {champions.rows
              .filter(({ rank }) => rank === 1)
              .map((row) => (
                <span className="tag" key={row.entryId}>
                  {row.removed || row.suspended ? (
                    "Anonymous"
                  ) : (
                    <Link href={`/users/${row.username}`}>{row.username}</Link>
                  )}{" "}
                  · {row.symbol} · {percent(row.returnPct)}
                </span>
              ))}
          </div>
        </section>
      )}
      <div className="metrics-grid">
        <Value label="Participants" icon={UsersRound}>
          {integer(summary.participants)}
        </Value>
        <Value label="Unique picks" icon={FlaskConical}>
          {summary.unique ?? "—"}
        </Value>
        <Value label="Average return">{percent(summary.mean)}</Value>
        <Value label="Top pick" subtitle={summary.best?.symbol}>
          {percent(summary.best?.returnPct ?? null)}
        </Value>
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Standings</h2>
            <Link className="text-link" href={standingsUrl(season.year)}>
              Full leaderboard <ArrowRight size={15} />
            </Link>
          </div>
          {board.rows.length ? (
            <StandingsTable rows={board.rows} season={season} preview />
          ) : (
            <Empty
              title="Standings are pending"
              text={
                revealed(season)
                  ? "Rankings appear when eligible picks have verified returns."
                  : "Picks will appear after the entry window closes."
              }
            />
          )}
        </section>
        <SeasonTimeline season={season} />
      </div>
      <MarketMethod season={season} />
    </>
  );
}

export async function Leaderboard({ season, search }: { season: Season; search: SearchParams }) {
  const dates = await availableDates(season);
  const options = boardOptions(search);
  if (!dates.includes(options.date ?? "")) options.date = undefined;
  const [board, seasons, auth] = await Promise.all([
    getBoard(season, options),
    listSeasons(),
    session().catch(() => null),
  ]);
  const viewer = auth ? await profileFor(auth.user.id) : undefined;
  const query = new URLSearchParams({ year: String(season.year) });
  if (options.date) query.set("date", options.date);
  if (options.search) query.set("q", options.search);
  const path = standingsUrl(season.year);
  return (
    <>
      <PageHeading
        tag={`${season.year} competition`}
        title="Leaderboard"
        description="Rankings by percentage return, with equal ranks for tied picks."
      />
      <SeasonTabs year={season.year} active="Leaderboard" />
      <div className="toolbar">
        <form className="toolbar-left" action="/leaderboard">
          <label className="field">
            Season
            <select name="year" defaultValue={season.year}>
              {seasons.map(({ year }) => (
                <option key={year}>{year}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Search
            <input
              name="q"
              defaultValue={options.search}
              placeholder="Name, ticker, company"
              maxLength={60}
            />
          </label>
          {dates.length > 1 && (
            <label className="field">
              Standings date
              <select name="date" defaultValue={options.date ?? ""}>
                <option value="">Latest</option>
                {dates.map((date) => (
                  <option value={date} key={date}>
                    {dateLabel(date)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Sort by
            <select name="sort" defaultValue={options.sort || "rank"}>
              <option value="rank">Highest return</option>
              <option value="reverse">Lowest return</option>
              <option value="participant">Participant</option>
              <option value="symbol">Ticker</option>
              <option value="daily">Daily change</option>
              <option value="move">Rank change</option>
              {season.data_mode === "official" && (
                <>
                  <option value="start">Start price</option>
                  <option value="price">Last close</option>
                </>
              )}
            </select>
          </label>
          <button className="button" type="submit">
            <Search size={15} /> Apply
          </button>
        </form>
        {revealed(season) && (
          <a className="button" href={`/api/leaderboard/export?${query}`}>
            <Download size={16} /> Export CSV
          </a>
        )}
      </div>
      {!revealed(season) ? (
        <PrivatePicks season={season} />
      ) : (
        <section className="panel">
          <div className="panel-heading">
            <div className="section-title">
              <h2>
                {board.total} {board.total === 1 ? "entry" : "entries"}
              </h2>
              <Phase phase={season.phase} />
            </div>
            <span className="muted">
              {season.published_date
                ? `Data through ${dateLabel(options.date ?? season.published_date)}`
                : "No market update yet"}
            </span>
          </div>
          {board.rows.length ? (
            <StandingsTable rows={board.rows} season={season} viewer={viewer?.id} />
          ) : (
            <Empty
              title={options.search ? "No matching entries" : "No revealed entries"}
              text="Standings will appear as participants enter and the season begins."
            />
          )}
          {board.total > board.limit && (
            <div className="pagination">
              {board.page > 1 ? (
                <Link href={pageLink(path, search, board.page - 1)} className="button">
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span>
                Page {board.page} of {Math.ceil(board.total / board.limit)}
              </span>
              {board.page * board.limit < board.total ? (
                <Link href={pageLink(path, search, board.page + 1)} className="button">
                  Next
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </section>
      )}
      {season.last_updated_at && (
        <p className="data-note">
          <CalendarDays size={15} />
          Last standings update {dateLabel(season.last_updated_at)}
        </p>
      )}
      <MarketMethod season={season} />
    </>
  );
}
const share = (count: number, total: number) => (total ? `${((100 * count) / total).toFixed(1)}%` : "—");
const perf = (value: string | null) => <span className={returnClass(value)}>{percent(value)}</span>;
export async function Analytics({ season }: { season: Season }) {
  const [stats, stocks, benchmarks, series, rankSeries] = await Promise.all([
    getStats(season),
    getStocks(season),
    getBenchmarks(season),
    getPerformanceSeries(season),
    getRankSeries(season),
  ]);
  const ordered = stocks
    .filter(({ returnPct }) => returnPct != null)
    .sort((a, b) => Number(b.returnPct) - Number(a.returnPct));
  return (
    <>
      <PageHeading
        tag={`${season.year} competition`}
        title="Season analytics"
        description="Returns, crowd favorites, and how the field compares with biotech and market benchmarks."
      />
      <SeasonTabs year={season.year} active="Analytics" />
      {!stats ? (
        <PrivatePicks season={season} />
      ) : (
        <>
          <div className="metrics-grid">
            <Value label="Participants" subtitle={`${stats.unique} unique picks`}>
              {stats.participants}
            </Value>
            <Value label="Average participant return">{perf(stats.mean)}</Value>
            <Value label="Median participant return">{perf(stats.median)}</Value>
            <Value label="Awaiting a verified return">{stats.pending}</Value>
          </div>
          <div className="dashboard-grid">
            <section className="panel page-panel">
              <h2>Participant performance</h2>
              <p className="muted">Share of all entries</p>
              <Bars
                maximum={stats.participants}
                data={[
                  {
                    label: "Profitable",
                    value: stats.profitable,
                    text: share(stats.profitable, stats.participants),
                    kind: "gains",
                  },
                  {
                    label: "Losing",
                    value: stats.losing,
                    text: share(stats.losing, stats.participants),
                    kind: "losses",
                  },
                  {
                    label: "Unchanged",
                    value: stats.unchanged,
                    text: share(stats.unchanged, stats.participants),
                  },
                  { label: "Pending", value: stats.pending, text: share(stats.pending, stats.participants) },
                ]}
              />
            </section>
            <section className="panel page-panel">
              <h2>Biggest movers</h2>
              <p className="muted">Unique stocks</p>
              <ul className="chart-list">
                {[ordered[0], ordered.at(-1)].map((stock, index) => (
                  <li key={index}>
                    <span>{index === 0 ? "Highest" : "Lowest"}</span>
                    {stock ? (
                      <Link className="ticker" href={pickLink(season.year, stock.securityId)}>
                        {stock.symbol}
                      </Link>
                    ) : (
                      <span>—</span>
                    )}
                    {perf(stock?.returnPct ?? null)}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <section className="panel page-panel">
            <h2>Competition and benchmarks</h2>
            <p className="muted">Participant-weighted return and the return of each benchmark</p>
            <SeriesChart
              points={series}
              series={[
                ["average", "Competition"],
                ["xbi", "XBI"],
                ["ibb", "IBB"],
                ["spy", "SPY"],
              ]}
              title="Competition returns compared with benchmarks"
            />
            {benchmarks.length > 0 && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Benchmark</th>
                      <th>Return</th>
                      <th>Participants ahead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarks.map((row) => (
                      <tr key={row.symbol}>
                        <td>{row.symbol}</td>
                        <td>{perf(row.returnPct)}</td>
                        <td>
                          {row.returnPct === null
                            ? "—"
                            : `${row.beat} · ${share(row.beat, stats.ranked)} of ranked`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="how-grid">
            <section className="panel page-panel">
              <h2>Return thresholds</h2>
              <p className="muted">Participant counts</p>
              <Bars
                data={[
                  ...([50, 100, 200, 500, 1000] as const).map((n) => ({
                    label: `Above +${n}%`,
                    value: stats[`over${n}`],
                    text: String(stats[`over${n}`]),
                    kind: "gains",
                  })),
                  ...([50, 75, 90] as const).map((n) => ({
                    label: `Below −${n}%`,
                    value: stats[`below${n}`],
                    text: String(stats[`below${n}`]),
                    kind: "losses",
                  })),
                ]}
              />
            </section>
            <section className="panel page-panel">
              <h2>Most selected</h2>
              <p className="muted">Share of participants</p>
              {stocks.length ? (
                <Bars
                  maximum={stats.participants}
                  data={stocks.slice(0, 8).map((stock) => ({
                    label: stock.symbol,
                    value: stock.picks,
                    text: share(stock.picks, stats.participants),
                  }))}
                />
              ) : (
                <p className="muted">No selections to compare.</p>
              )}
            </section>
            <section className="panel page-panel">
              <h2>Security status</h2>
              <p className="muted">Unique stock counts</p>
              <Bars
                data={["acquired", "halted", "bankrupt", "delisted"].map((key) => ({
                  label: key,
                  value: Number(stats[key as keyof typeof stats]),
                  text: String(stats[key as keyof typeof stats]),
                }))}
              />
            </section>
          </div>
          {ordered.length > 0 && (
            <div className="how-grid">
              <section className="panel page-panel">
                <h2>Top-performing stocks</h2>
                <Bars
                  data={ordered.slice(0, 5).map((stock) => ({
                    label: stock.symbol,
                    value: Number(stock.returnPct),
                    text: percent(stock.returnPct),
                    kind: "gains",
                  }))}
                />
              </section>
              <section className="panel page-panel">
                <h2>Lowest-return stocks</h2>
                <Bars
                  data={ordered
                    .slice(-5)
                    .reverse()
                    .map((stock) => ({
                      label: stock.symbol,
                      value: Number(stock.returnPct),
                      text: percent(stock.returnPct),
                      kind: "losses",
                    }))}
                />
              </section>
              <section className="panel page-panel">
                <h2>Biotech subsectors</h2>
                <Bars
                  data={Object.entries(
                    stocks.reduce<Record<string, number>>((acc, stock) => {
                      if (stock.industry) acc[stock.industry] = (acc[stock.industry] ?? 0) + 1;
                      return acc;
                    }, {}),
                  )
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8)
                    .map(([label, value]) => ({ label, value, text: String(value) }))}
                />
              </section>
            </div>
          )}
          <section className="panel page-panel">
            <h2>Leaderboard movement</h2>
            <p className="muted">Average number of places moved per session</p>
            <SeriesChart
              points={rankSeries}
              series={[["average", "Average places moved"]]}
              title="Average historical rank movement"
              valueLabel={(n) => Number(n).toFixed(2)}
            />
          </section>
          <MarketMethod season={season} />
        </>
      )}
    </>
  );
}
export async function Stocks({ season }: { season: Season }) {
  const stocks = await getStocks(season);
  const selections = stocks.reduce((a, b) => a + b.picks, 0);
  return (
    <>
      <PageHeading
        tag={`${season.year} competition`}
        title="Stock picks"
        description="Explore the securities selected this season and see how many participants backed each one."
      />
      <SeasonTabs year={season.year} active="Stocks" />
      {!revealed(season) ? (
        <PrivatePicks season={season} />
      ) : stocks.length ? (
        <section className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Company</th>
                  <th>Entries</th>
                  <th>Share of entries</th>
                  <th>Return</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((stock) => (
                  <tr key={stock.securityId}>
                    <td>
                      <Link className="ticker" href={pickLink(season.year, stock.securityId)}>
                        {stock.symbol}
                      </Link>
                    </td>
                    <td>{stock.company}</td>
                    <td>{stock.picks}</td>
                    <td>{share(stock.picks, selections)}</td>
                    <td>{perf(stock.returnPct)}</td>
                    <td className="capitalized">{stock.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="panel">
          <Empty
            title="No stock picks to display"
            text="Eligible entries are listed here after picks lock."
          />
        </div>
      )}
      <MarketMethod season={season} />
    </>
  );
}
export async function StockDetails({ season, security }: { season: Season; security: string }) {
  const [board, prices, stockHistory] = await Promise.all([
    getBoard(season, { security, limit: 1000 }),
    getStockSeries(season, security),
    one<{ years: number[] }>(
      `SELECT array_agg(DISTINCT e.season_year ORDER BY e.season_year DESC) AS years FROM entries e
      JOIN seasons s ON s.year=e.season_year AND s.locks_at<=now() WHERE e.security_id=$1`,
      [security],
    ),
  ]);
  const stock = board.rows[0];
  if (!stock) return null;
  return (
    <>
      <PageHeading tag={`${season.year} stock pick`} title={stock.symbol} description={stock.company} />
      <SeasonTabs year={season.year} active="Stocks" />
      <div className="metrics-grid">
        <Value label="Participants">{board.total}</Value>
        <Value label="Season return">{perf(stock.returnPct)}</Value>
        {season.data_mode === "official" && (
          <>
            <Value label="Opening price">{money(stock.startPrice)}</Value>
            <Value label={season.final_revision ? "Final position value" : "Last close"}>
              {money(season.final_revision ? stock.value : stock.close)}
            </Value>
          </>
        )}
        {season.data_mode === "free" && (
          <Value label="Status">
            <span className="capitalized">{stock.status}</span>
          </Value>
        )}
      </div>
      {season.data_mode === "official" && (
        <section className="panel page-panel">
          <h2>Closing price history</h2>
          <SeriesChart
            points={prices}
            series={[["close", "Daily close"]]}
            title={`${stock.symbol} closing prices`}
            valueLabel={money}
          />
        </section>
      )}
      <section className="panel page-panel">
        <h2>Participants</h2>
        <div className="trophy-list">
          {board.rows.map((row) => (
            <span key={row.entryId} className="row-user">
              <Avatar
                username={row.removed || row.suspended ? "Anonymous" : row.username}
                avatar={row.avatar}
              />
              {row.removed || row.suspended ? (
                "Anonymous"
              ) : (
                <Link className="text-link" href={`/users/${row.username}`}>
                  {row.username}
                </Link>
              )}
            </span>
          ))}
        </div>
      </section>
      <section className="panel page-panel">
        <h2>Competition appearances</h2>
        <div className="trophy-list">
          {stockHistory?.years?.map((year) => (
            <Link href={pickLink(year, security)} className="tag" key={year}>
              {year} season
            </Link>
          ))}
        </div>
      </section>
      <MarketMethod season={season} />
    </>
  );
}
export function TrophyLink({ year, kind }: { year: number; kind: string }) {
  const labels: Record<string, string> = {
    champion: "Champion",
    silver: "Silver",
    bronze: "Bronze",
    elite: "Elite Stock Picker",
  };
  return (
    <Link href={`/competitions/${year}`} className="panel trophy">
      <Trophy size={20} />
      <strong>{labels[kind] ?? kind}</strong>
      <span>{year} season</span>
    </Link>
  );
}
