import { one, query, transaction, type Database } from "./db";
import { getSeason, type Season } from "./calendar";
import { competitionRanks, earnedTrophies, valuePosition, type Action, type StoredBar } from "./scoring";

export type Entry = {
  id: string;
  security_id: string;
  season_year: number;
  disqualified_reason: string | null;
};
export async function seasonUniverse(season: Season, db?: Database) {
  const entries = await query<Entry>(
    "SELECT id,security_id,season_year,disqualified_reason FROM entries WHERE season_year=$1",
    [season.year],
    db,
  );
  const benchmarks = await query<{ id: string; symbol: string }>(
    "SELECT id,symbol FROM securities WHERE benchmark AND active ORDER BY symbol",
    [],
    db,
  );
  const roots = [
    ...new Set([
      ...entries
        .filter(({ disqualified_reason }) => !disqualified_reason)
        .map(({ security_id }) => security_id),
      ...benchmarks.map(({ id }) => id),
    ]),
  ];
  const actions = await query<Action>(
    `WITH RECURSIVE tracked(id) AS (
    SELECT unnest($1::uuid[]) UNION SELECT corporate_actions.successor_id FROM corporate_actions
    JOIN tracked ON tracked.id=corporate_actions.security_id
    WHERE successor_id IS NOT NULL AND voided_at IS NULL AND effective_date BETWEEN $2 AND $3
  ) SELECT corporate_actions.*,effective_date::text FROM corporate_actions JOIN tracked ON tracked.id=security_id
  WHERE voided_at IS NULL AND effective_date BETWEEN $2 AND $3 ORDER BY corporate_actions.effective_date,sequence,corporate_actions.id`,
    [roots, season.first_session, season.last_session],
    db,
  );
  const allIds = [
    ...new Set([
      ...roots,
      ...actions.map(({ successor_id }) => successor_id).filter((id): id is string => !!id),
    ]),
  ];
  return { entries, benchmarks, roots, allIds, actions };
}

export async function rebuildStandings(year: number, date: string, db: Database) {
  const season = await getSeason(year, db);
  if (!season || date < season.first_session || date > season.last_session)
    throw new Error("Session outside season");
  const universe = await seasonUniverse(season, db);
  const dates = (
    await query<{ date: string }>(
      "SELECT session_date::text AS date FROM market_sessions WHERE year=$1 AND session_date<=$2 ORDER BY session_date",
      [year, date],
      db,
    )
  ).map((row) => row.date);
  if (dates.at(-1) !== date) throw new Error("Unknown market session");
  const priceRecords = await query<StoredBar>(
    `SELECT security_id,session_date::text,open,close FROM daily_prices
    WHERE security_id=ANY($1::uuid[]) AND session_date BETWEEN $2 AND $3
      AND (CASE WHEN $4='free' THEN source LIKE 'Market History%' OR source LIKE 'Verified %'
            ELSE source NOT LIKE 'Market History%' END)`,
    [universe.allIds, season.first_session, date, season.data_mode],
    db,
  );
  const bars = new Map(priceRecords.map((bar) => [`${bar.security_id}/${bar.session_date}`, bar]));
  const reviews = await query<{ security_id: string; category: string }>(
    `SELECT security_id,category FROM security_reviews
     WHERE year=$1 AND resolved_at IS NULL AND (category='eligibility' OR effective_date<=$2::date)`,
    [year, date],
    db,
  );
  const scores = new Map(
    universe.roots.map((id) => [
      id,
      valuePosition(id, season.first_session, date, dates, bars, universe.actions),
    ]),
  );
  for (const { security_id, category } of reviews) {
    const affected = [
      security_id,
      ...universe.actions
        .filter((action) => action.successor_id === security_id && action.effective_date <= date)
        .map((action) => action.security_id),
    ];
    for (const id of affected) {
      const score = scores.get(id);
      if (score)
        scores.set(id, {
          ...score,
          close: null,
          value: null,
          pct: null,
          previousPct: null,
          status: category === "eligibility" ? "eligibility under review" : "action under review",
        });
    }
  }
  const ranks = competitionRanks(
    scores,
    universe.entries.filter((entry) => !entry.disqualified_reason),
  );
  const previous = new Map(
    (
      await query<{ entry_id: string; rank: number | null }>(
        "SELECT entry_id,rank FROM daily_standings WHERE year=$1 AND session_date=$2",
        [year, dates.at(-2) ?? null],
        db,
      )
    ).map((record) => [record.entry_id, record.rank]),
  );
  const dataset = universe.entries.map((entry) => {
    const result = entry.disqualified_reason ? null : scores.get(entry.security_id);
    const rank = ranks.get(entry.id) ?? null;
    const prior = previous.get(entry.id);
    return {
      id: entry.id,
      start: result?.start ?? null,
      close: result?.close ?? null,
      value: result?.value ?? null,
      pct: result?.pct ?? null,
      daily: result?.previousPct ?? null,
      rank,
      movement: rank != null && prior != null ? prior - rank : null,
      status: result?.status ?? "ineligible",
    };
  });
  await db.query(
    `INSERT INTO daily_standings(year,session_date,entry_id,start_price,close_price,equivalent_value,return_pct,daily_pct,rank,rank_change,status)
    SELECT $1,$2,id,start,close,value,pct,daily,rank,movement,status
    FROM jsonb_to_recordset($3::jsonb) AS s(id uuid,start numeric,close numeric,value numeric,pct numeric,daily numeric,rank integer,movement integer,status text)
    ON CONFLICT(year,session_date,entry_id) DO UPDATE SET start_price=excluded.start_price,close_price=excluded.close_price,
    equivalent_value=excluded.equivalent_value,return_pct=excluded.return_pct,daily_pct=excluded.daily_pct,rank=excluded.rank,
    rank_change=excluded.rank_change,status=excluded.status`,
    [year, date, JSON.stringify(dataset)],
  );
  await db.query(
    `INSERT INTO benchmark_standings(year,session_date,security_id,return_pct)
    SELECT $1,$2,id,pct FROM jsonb_to_recordset($3::jsonb) AS s(id uuid,pct numeric)
    ON CONFLICT(year,session_date,security_id) DO UPDATE SET return_pct=excluded.return_pct`,
    [
      year,
      date,
      JSON.stringify(universe.benchmarks.map(({ id }) => ({ id, pct: scores.get(id)?.pct ?? null }))),
    ],
  );
  return {
    count: dataset.filter(({ status }) => status !== "ineligible").length,
    unresolved: dataset.filter(({ pct, status }) => pct == null && status !== "ineligible").length,
  };
}

export async function finalizeSeason(year: number, correction?: { actor: string; reason: string }) {
  return transaction(async (db) => {
    const season = await one<Season & { can_finalize: boolean }>(
      "SELECT *, last_session::text, ends_at<=clock_timestamp() AS can_finalize FROM seasons WHERE year=$1 FOR UPDATE",
      [year],
      db,
    );
    if (
      !season?.can_finalize ||
      (season.final_revision != null && !correction) ||
      (season.final_revision == null && correction)
    )
      return null;
    if (await one("SELECT 1 FROM security_reviews WHERE year=$1 AND resolved_at IS NULL", [year], db))
      return null;
    const needsActionVerification = await one(
      `SELECT 1 FROM entries e WHERE e.season_year=$1
      AND e.disqualified_reason IS NULL AND NOT EXISTS (
        SELECT 1 FROM market_observations o WHERE o.security_id=e.security_id
          AND o.source='Corporate actions' AND o.observed_through >= $2::date
      ) LIMIT 1`,
      [year, season.last_session],
      db,
    );
    if (
      needsActionVerification &&
      !(await one(
        `SELECT 1 FROM audit_log
      WHERE action='verify-action-coverage' AND target=$1 LIMIT 1`,
        [String(year)],
        db,
      ))
    )
      return null;
    const outstanding = await one(
      `SELECT 1 FROM market_sessions m LEFT JOIN sync_jobs j ON j.year=m.year AND j.session_date=m.session_date
      WHERE m.year=$1 AND j.status IS DISTINCT FROM 'succeeded' LIMIT 1`,
      [year],
      db,
    );
    if (outstanding) return null;
    const scored = await rebuildStandings(year, season.last_session, db);
    const benchmarksMissing =
      scored.count > 0 &&
      (await one(
        `SELECT 1 FROM benchmark_standings WHERE year=$1 AND session_date=$2 AND return_pct IS NULL LIMIT 1`,
        [year, season.last_session],
        db,
      ));
    if (scored.unresolved || outstanding || benchmarksMissing) return null;
    const results = await query<{ profile_id: string; rank: number | null }>(
      `SELECT e.profile_id,d.entry_id,d.rank,d.status,e.security_id,
      e.pick_symbol AS symbol,e.company,d.start_price::text,d.close_price::text,d.equivalent_value::text,
      d.return_pct::text,d.daily_pct::text,d.rank_change
      FROM daily_standings d JOIN entries e ON e.id=d.entry_id WHERE d.year=$1 AND d.session_date=$2
      ORDER BY d.rank NULLS LAST,e.id`,
      [year, season.last_session],
      db,
    );
    const benchmarks = await query(
      `SELECT s.symbol,b.return_pct::text FROM benchmark_standings b JOIN securities s ON s.id=b.security_id
      WHERE b.year=$1 AND b.session_date=$2 ORDER BY s.symbol`,
      [year, season.last_session],
      db,
    );
    const revision = (season.final_revision ?? 0) + 1;
    const reason = correction?.reason ?? "Official year-end standings";
    await db.query("INSERT INTO archives(year,revision,snapshot,reason) VALUES($1,$2,$3,$4)", [
      year,
      revision,
      JSON.stringify({ results, benchmarks }),
      reason,
    ]);
    const ranked = results.filter(({ rank }) => rank != null);
    const trophies = ranked.flatMap(({ profile_id, rank }) =>
      earnedTrophies(rank!, ranked.length).map((kind) => ({ profile_id, kind })),
    );
    await db.query(
      `INSERT INTO trophies SELECT $1,$2,profile_id,kind FROM jsonb_to_recordset($3::jsonb) AS t(profile_id uuid,kind text)`,
      [year, revision, JSON.stringify(trophies)],
    );
    await db.query(
      "UPDATE seasons SET final_revision=$2,finalized_at=now(),published_date=last_session,last_updated_at=now() WHERE year=$1",
      [year, revision],
    );
    await db.query("INSERT INTO audit_log(actor,action,target,details) VALUES($1,$2,$3,$4)", [
      correction?.actor ?? "market-worker",
      correction ? "correct-publication" : "finalize-season",
      String(year),
      JSON.stringify({ revision, reason }),
    ]);
    if (!correction)
      await db.query("INSERT INTO notifications(key,message) VALUES($1,$2) ON CONFLICT DO NOTHING", [
        `finalized:${year}`,
        `${year} BioTrades X standings are official. Congratulations to the winners and trophy recipients!`,
      ]);
    return { revision, ranked: ranked.length };
  });
}
