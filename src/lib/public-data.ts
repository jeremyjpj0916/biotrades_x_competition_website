import { z } from "zod";
import { type Season, listSeasons, getSeason, selectHomeSeason } from "./calendar";
import { one, query } from "./db";
import { D } from "./scoring";

type Search = Record<string, string | string[] | undefined>;
export const stringValue = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
export const yearValue = (value: string | undefined) => (value && /^\d{4}$/.test(value) ? Number(value) : 0);
export function revealed(season: Season) {
  return !["Upcoming", "Registration open"].includes(season.phase);
}
export function marketPublication(season: Season) {
  if (!revealed(season) || !season.published_date) return null;
  return `${season.published_date}/${season.last_updated_at?.toISOString() ?? ""}/${season.final_revision ?? ""}`;
}
export type Standing = {
  entryId: string;
  profileId: string;
  username: string;
  avatar: string | null;
  removed: boolean;
  suspended: boolean;
  securityId: string;
  symbol: string;
  company: string;
  rank: number | null;
  status: string;
  startPrice: string | null;
  close: string | null;
  value: string | null;
  returnPct: string | null;
  dailyPct: string | null;
  rankChange: number | null;
};
type BoardOptions = {
  limit?: number;
  page?: number;
  search?: string;
  sort?: string;
  date?: string;
  security?: string;
  profile?: string;
};
const sortFields: Record<string, string> = {
  rank: "rank ASC NULLS LAST",
  reverse: "rank DESC NULLS LAST",
  symbol: "symbol ASC",
  participant: "lower(username) ASC",
  daily: "daily_pct DESC NULLS LAST",
  move: "rank_change DESC NULLS LAST",
  start: "start_price ASC NULLS LAST",
  price: "close_price DESC NULLS LAST",
};
const uuid = z.uuid();
const normalized = (text: string) => text.replace(/[\\%_]/g, "\\$&");
const boardSql = (season: Season, historical: boolean) =>
  season.final_revision && !historical
    ? `
  SELECT a.year,e.* FROM seasons y JOIN archives a ON a.year=y.year AND a.revision=y.final_revision
  CROSS JOIN LATERAL jsonb_to_recordset(a.snapshot->'results') AS e(
    entry_id uuid,profile_id uuid,security_id uuid,symbol text,company text,
    status text,rank integer,start_price numeric,close_price numeric,equivalent_value numeric,
    return_pct numeric,daily_pct numeric,rank_change integer)
  WHERE y.year=$1 AND y.locks_at<=now()
`
    : `
  SELECT y.year,e.id AS entry_id,e.profile_id,e.security_id,e.pick_symbol AS symbol,e.company,
    coalesce(d.status, CASE WHEN e.disqualified_reason IS NULL THEN 'price pending' ELSE 'ineligible' END) AS status,
    d.rank,d.start_price,d.close_price,d.equivalent_value,d.return_pct,d.daily_pct,d.rank_change
  FROM seasons y JOIN entries e ON e.season_year=y.year
  LEFT JOIN daily_standings d ON d.entry_id=e.id AND d.year=y.year
    AND d.session_date=coalesce($2::date,y.published_date) AND d.session_date<=y.published_date
  WHERE y.year=$1 AND y.locks_at<=now()
`;
const selectFields = `
  entry_id AS "entryId", b.profile_id AS "profileId", b.security_id AS "securityId",
  p.username, CASE WHEN p.removed OR p.suspended THEN NULL ELSE p.avatar END AS avatar, p.removed,p.suspended,
  b.symbol,b.company,b.rank,b.status,b.start_price AS "startPrice",b.close_price AS close,
  b.equivalent_value AS value,b.return_pct AS "returnPct",b.daily_pct AS "dailyPct",b.rank_change AS "rankChange"
`;
export async function availableDates(season: Season) {
  if (!revealed(season)) return [];
  return (
    await query<{ date: string }>(
      `SELECT s.session_date::text AS date FROM sync_jobs s JOIN seasons y USING(year)
    WHERE y.year=$1 AND y.locks_at<=now() AND s.session_date<=y.published_date AND EXISTS(
      SELECT 1 FROM daily_standings d WHERE d.year=s.year AND d.session_date=s.session_date)
    ORDER BY s.session_date DESC`,
      [season.year],
    )
  ).map(({ date }) => date);
}
export function boardOptions(input: Search): BoardOptions {
  return {
    page: Math.max(1, Math.min(100000, Number(stringValue(input.page)) || 1)),
    search: stringValue(input.q).trim().slice(0, 60),
    sort: stringValue(input.sort),
    date: z.iso.date().safeParse(stringValue(input.date)).data,
  };
}

export async function getBoard(season: Season, options: BoardOptions = {}) {
  const limit = Math.max(1, Math.min(20000, options.limit ?? 25));
  if (!revealed(season)) return { rows: [] as Standing[], total: 0, page: 1, limit };
  const params = [
    season.year,
    options.date ?? null,
    options.search ? `%${normalized(options.search)}%` : "",
    uuid.safeParse(options.security).data ?? null,
    uuid.safeParse(options.profile).data ?? null,
  ];
  const data = `WITH b AS (${boardSql(season, Boolean(options.date && options.date !== season.last_session))}),
    filtered AS (SELECT ${selectFields} FROM b JOIN profiles p ON p.id=b.profile_id
      WHERE ($3='' OR b.symbol ILIKE $3 OR b.company ILIKE $3 OR
        (NOT p.removed AND NOT p.suspended AND p.username ILIKE $3))
      AND ($4::uuid IS NULL OR b.security_id=$4) AND ($5::uuid IS NULL OR b.profile_id=$5)
      AND ($2::date IS NULL OR EXISTS(SELECT 1 FROM daily_standings d WHERE d.year=$1 AND d.session_date=$2)))
  `;
  const total = Number((await one<{ count: string }>(`${data} SELECT count(*) FROM filtered`, params)).count);
  const page = Math.max(1, Math.min(Math.ceil(total / limit), Math.floor(options.page ?? 1)));
  const sortField =
    options.sort && Object.hasOwn(sortFields, options.sort) ? sortFields[options.sort] : sortFields.rank;
  const order =
    season.data_mode === "free" && (options.sort === "start" || options.sort === "price")
      ? sortFields.rank
      : sortField;
  const rows = await query<Standing>(
    `${data} SELECT * FROM filtered ORDER BY ${order
      .replace("daily_pct", '"dailyPct"')
      .replace("rank_change", '"rankChange"')
      .replace("start_price", '"startPrice"')
      .replace("close_price", "close")},
    symbol,"entryId" LIMIT $6 OFFSET $7`,
    [...params, limit, (page - 1) * limit],
  );
  if (season.data_mode === "free") {
    for (const row of rows) {
      row.startPrice = null;
      row.close = null;
      row.value = null;
      row.returnPct = row.returnPct == null ? null : new D(row.returnPct).toFixed(2);
      row.dailyPct = row.dailyPct == null ? null : new D(row.dailyPct).toFixed(2);
    }
  }
  return { rows, total, page, limit };
}

export async function getOverview(season: Season) {
  const stat = await one<{ participants: number; unique: number | null; mean: string | null }>(
    `SELECT
    count(e.id)::integer AS participants, CASE WHEN y.locks_at<=now() THEN count(DISTINCT security_id)::integer END AS unique,
    CASE WHEN y.locks_at<=now() THEN avg(d.return_pct)::text END AS mean
    FROM seasons y LEFT JOIN entries e ON e.season_year=y.year
    LEFT JOIN daily_standings d ON d.entry_id=e.id AND d.year=y.year AND d.session_date=y.published_date
    WHERE y.year=$1 GROUP BY y.year`,
    [season.year],
  );
  const board = await getBoard(season, { limit: 1 });
  return { ...stat, best: board.rows.find((row) => row.rank === 1) ?? null };
}

export async function getRecentChampions() {
  return query<{
    year: number;
    username: string;
  }>(`SELECT t.year, CASE WHEN p.removed OR p.suspended THEN 'Anonymous' ELSE p.username END AS username
    FROM trophies t JOIN seasons s ON s.year=t.year AND s.final_revision=t.revision JOIN profiles p ON p.id=t.profile_id
    WHERE t.kind='champion' ORDER BY t.year DESC,p.username LIMIT 12`);
}
export async function seasonFrom(input: string) {
  return input ? getSeason(yearValue(input)) : selectHomeSeason(await listSeasons());
}

export type Stats = {
  participants: number;
  unique: number;
  ranked: number;
  profitable: number;
  losing: number;
  unchanged: number;
  pending: number;
  mean: string | null;
  median: string | null;
  over50: number;
  over100: number;
  over200: number;
  over500: number;
  over1000: number;
  below50: number;
  below75: number;
  below90: number;
  acquired: number;
  halted: number;
  bankrupt: number;
  delisted: number;
};
export type StockPick = {
  securityId: string;
  symbol: string;
  company: string;
  picks: number;
  returnPct: string | null;
  status: string;
  marketCap: string | null;
  industry: string | null;
};
export async function getStocks(season: Season) {
  if (!revealed(season)) return [];
  return query<StockPick>(
    `WITH b AS (${boardSql(season, false)})
    SELECT b.security_id AS "securityId", b.symbol, b.company, count(*)::int AS picks,
      round(max(return_pct),2)::text AS "returnPct",min(status) AS status,s.market_cap AS "marketCap",s.industry
    FROM b JOIN securities s ON s.id=b.security_id WHERE $2::date IS NULL
    GROUP BY b.security_id,b.symbol,b.company,s.market_cap,s.industry ORDER BY picks DESC,b.symbol`,
    [season.year, null],
  );
}
export async function getStats(season: Season) {
  if (!revealed(season)) return null;
  return one<Stats>(
    `WITH b AS (${boardSql(season, false)})
    SELECT count(*)::int AS participants, count(DISTINCT security_id)::int AS unique, count(return_pct)::int AS ranked,
    (count(*) FILTER (WHERE return_pct>0))::int AS profitable,(count(*) FILTER(WHERE return_pct<0))::int AS losing,
    (count(*) FILTER (WHERE return_pct=0))::int AS unchanged,(count(*) FILTER (WHERE return_pct IS NULL))::int AS pending,
    avg(return_pct)::text AS mean, percentile_cont(.5) WITHIN GROUP(ORDER BY return_pct)::text AS median,
    ${[50, 100, 200, 500, 1000].map((n) => `(count(*) FILTER(WHERE return_pct>${n}))::int AS over${n}`).join(",")},
    ${[50, 75, 90].map((n) => `(count(*) FILTER(WHERE return_pct<-${n}))::int AS below${n}`).join(",")},
    ${["acquired", "halted", "bankrupt", "delisted"].map((status) => `count(DISTINCT security_id) FILTER(WHERE status='${status}')::int AS ${status}`).join(",")}
    FROM b WHERE $2::date IS NULL`,
    [season.year, null],
  );
}
export async function getBenchmarks(season: Season) {
  if (!revealed(season)) return [];
  const source = season.final_revision
    ? `SELECT x.symbol,x.return_pct FROM seasons y JOIN archives a ON a.year=y.year AND a.revision=y.final_revision
       CROSS JOIN LATERAL jsonb_to_recordset(a.snapshot->'benchmarks') AS x(symbol text,return_pct numeric) WHERE y.year=$1`
    : `SELECT s.symbol,k.return_pct FROM seasons y JOIN benchmark_standings k ON k.year=y.year AND k.session_date=y.published_date
       JOIN securities s ON s.id=k.security_id WHERE y.year=$1`;
  return query<{ symbol: string; returnPct: string | null; beat: number }>(
    `WITH b AS (${boardSql(season, false)}), benchmark AS (${source})
    SELECT a.symbol,a.return_pct AS "returnPct", (SELECT count(*)::int FROM b WHERE b.return_pct>a.return_pct AND $2::date IS NULL) AS beat
    FROM benchmark a ORDER BY a.symbol`,
    [season.year, null],
  );
}
export async function getPerformanceSeries(season: Season) {
  if (!revealed(season)) return [];
  return query<{
    date: string;
    average: string | null;
    xbi: string | null;
    ibb: string | null;
    spy: string | null;
  }>(
    `WITH averages AS (
    SELECT d.session_date,avg(d.return_pct) AS avg FROM daily_standings d
    WHERE d.year=$1 GROUP BY d.session_date
    ) SELECT a.session_date::text AS date,round(a.avg,2)::text AS average,
      round(max(b.return_pct) FILTER(WHERE s.symbol='XBI'),2)::text AS xbi,
      round(max(b.return_pct) FILTER(WHERE s.symbol='IBB'),2)::text AS ibb,
      round(max(b.return_pct) FILTER(WHERE s.symbol='SPY'),2)::text AS spy
    FROM averages a JOIN seasons y ON y.year=$1 AND y.locks_at<=now() AND a.session_date<=y.published_date
    LEFT JOIN benchmark_standings b ON b.year=y.year AND b.session_date=a.session_date
    LEFT JOIN securities s ON s.id=b.security_id GROUP BY a.session_date,a.avg ORDER BY a.session_date`,
    [season.year],
  );
}
export async function getStockSeries(season: Season, security: string) {
  if (!revealed(season) || season.data_mode !== "official") return [];
  return query<{ date: string; close: string }>(
    `SELECT d.session_date::text AS date,d.close FROM daily_prices d
    JOIN seasons s ON s.year=$1 AND s.locks_at<=now() WHERE d.security_id=$2 AND d.session_date BETWEEN s.first_session AND s.published_date
    AND d.source NOT LIKE 'Market History%' AND EXISTS (
      SELECT 1 FROM daily_standings p WHERE p.year=s.year AND p.session_date=d.session_date
    ) ORDER BY d.session_date`,
    [season.year, security],
  );
}
export async function getRankSeries(season: Season) {
  if (!revealed(season)) return [];
  return query<{ date: string; average: string | null }>(
    `SELECT d.session_date::text AS date,round(avg(abs(d.rank_change)),2)::text AS average
    FROM daily_standings d JOIN seasons s ON s.year=d.year AND s.locks_at<=now()
    WHERE d.year=$1 AND d.session_date<=s.published_date GROUP BY d.session_date ORDER BY d.session_date`,
    [season.year],
  );
}
export async function getProfile(username: string) {
  return one<{
    id: string;
    username: string;
    display_name: string | null;
    avatar: string | null;
    bio: string | null;
    x_handle: string | null;
    discord_handle: string | null;
    joined_at: Date;
  }>(
    `SELECT id,username,display_name,avatar,bio,x_handle,discord_handle,joined_at FROM profiles
      WHERE lower(username)=lower($1) AND NOT suspended AND NOT removed`,
    [username],
  );
}
export async function getProfileYears(id: string) {
  const seasons = await query<{ year: number }>(
    `SELECT e.season_year AS year FROM entries e JOIN seasons s ON s.year=e.season_year
    WHERE e.profile_id=$1 AND s.locks_at<=now() ORDER BY year DESC`,
    [id],
  );
  return Promise.all(
    seasons.map(async ({ year }) => {
      const season = (await getSeason(year))!;
      const [board, overview] = await Promise.all([
        getBoard(season, { profile: id, limit: 1 }),
        getOverview(season),
      ]);
      return { season, standing: board.rows[0], participants: overview.participants };
    }),
  );
}
export async function getTrophies(id: string) {
  return query<{ year: number; kind: string }>(
    `SELECT t.year,t.kind FROM trophies t JOIN seasons s ON s.year=t.year AND s.final_revision=t.revision
    WHERE t.profile_id=$1 ORDER BY t.year DESC,t.kind`,
    [id],
  );
}
export async function getHall(minimum: number) {
  type Hall = {
    username: string;
    count: number;
    wins: number;
    elite: number;
    best: string;
    average: string;
    profitable: number;
    streak: number;
  };
  return query<Hall>(
    `WITH ranked AS (
    SELECT y.year, r.profile_id,r.rank,r.return_pct,y.final_revision,
      y.year-row_number() OVER(PARTITION BY r.profile_id ORDER BY y.year)::int AS group_id
    FROM seasons y JOIN archives a ON a.year=y.year AND a.revision=y.final_revision
    CROSS JOIN LATERAL jsonb_to_recordset(a.snapshot->'results') AS r(profile_id uuid,rank int,return_pct numeric)
    WHERE r.rank IS NOT NULL
    ), streaks AS (SELECT profile_id,max(n)::int AS streak FROM (SELECT profile_id,count(*) AS n FROM ranked GROUP BY profile_id,group_id) s GROUP BY profile_id)
    SELECT p.username,count(*)::int AS count, (count(*) FILTER(WHERE r.rank=1))::int AS wins,
      (count(t.kind))::int AS elite, max(r.return_pct) AS best,avg(r.return_pct) AS average,
      (count(*) FILTER(WHERE r.return_pct>0))::int AS profitable,max(s.streak)::int AS streak
    FROM ranked r JOIN profiles p ON p.id=r.profile_id JOIN streaks s ON s.profile_id=r.profile_id
    LEFT JOIN trophies t ON t.profile_id=r.profile_id AND t.year=r.year AND t.revision=r.final_revision AND t.kind='elite'
    WHERE NOT p.suspended AND NOT p.removed GROUP BY p.username HAVING count(*)>=$1
    ORDER BY wins DESC,elite DESC,best DESC LIMIT 1000`,
    [minimum],
  );
}
