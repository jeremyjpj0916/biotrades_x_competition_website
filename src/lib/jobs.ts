import { DateTime } from "luxon";
import { one, pool, query, transaction } from "./db";
import { getSeason, refreshCalendars, zone, type Season } from "./calendar";
import {
  freeSource,
  historyActions,
  historyBars,
  massiveSplits,
  officialBar,
  officialSource,
  ProviderError,
  savePrice,
} from "./market";
import { ensureBenchmarks, refreshSecurities } from "./securities";
import { finalizeSeason, rebuildStandings, seasonUniverse } from "./standings";
import { sendMail } from "./mail";
import { appUrl } from "./config";
import {
  yahooBatchSize,
  yahooChartBar,
  yahooChartSource,
  yahooDailyChart,
  yahooQuotes,
  yahooSessionBar,
  yahooSessionConfigured,
  yahooSource,
} from "./yahoo";

type Job = { id: string; year: number; date: string; attempts: number; started_at: Date };
type Target = {
  id: string;
  symbol: string;
  market_history_id: string | null;
  benchmark: boolean;
  identity_conflict: boolean;
  has_price: boolean;
};

export async function review(
  year: number,
  id: string,
  category: string,
  message: string,
  effective?: string,
) {
  await query(
    `INSERT INTO security_reviews(year,security_id,category,message,effective_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [year, id, category, message, effective ?? null],
  );
}
async function checkEligibility() {
  await query(`UPDATE security_reviews r SET resolved_at=now(),resolution='Affected pick was withdrawn or changed'
    WHERE r.category='eligibility' AND r.resolved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.season_year=r.year AND e.security_id=r.security_id)`);
  const newlyFlagged = await query<{
    year: number;
    security_id: string;
    message: string;
  }>(`INSERT INTO security_reviews(year,security_id,category,message)
    SELECT DISTINCT e.season_year,e.security_id,'eligibility','The selected security is inactive, stale or no longer eligible near the lock.'
    FROM entries e JOIN seasons y ON y.year=e.season_year JOIN securities s ON s.id=e.security_id
    WHERE y.final_revision IS NULL AND y.locks_at BETWEEN now()-interval '30 minutes' AND now()+interval '7 days'
      AND e.disqualified_reason IS NULL AND (NOT s.active OR NOT coalesce(s.eligibility_override,s.provider_eligible)
        OR s.checked_at < now()-interval '7 days')
    ON CONFLICT(year,security_id,category) DO UPDATE SET resolved_at=NULL,resolution=NULL
    WHERE security_reviews.resolution='Affected pick was withdrawn or changed' RETURNING year,security_id,message`);
  for (const flag of newlyFlagged) {
    await query(
      `INSERT INTO notifications(key,message,destination,recipient)
      SELECT 'eligibility:'||e.id,$3,'email',u.email FROM entries e JOIN profiles p ON p.id=e.profile_id
      JOIN "user" u ON u.id=p.auth_user_id WHERE e.season_year=$1 AND e.security_id=$2 AND u."emailVerified"
      ON CONFLICT DO NOTHING`,
      [
        flag.year,
        flag.security_id,
        `Your ${flag.year} BioTrades X pick needs an eligibility review. Sign in to review it. ${appUrl}/account`,
      ],
    );
  }
}
async function maintenance(name: string, interval: string, run: () => Promise<unknown>) {
  if (await one("SELECT 1 FROM worker_health WHERE name=$1 AND ran_at>now()-$2::interval", [name, interval]))
    return;
  try {
    await run();
    await query(
      `INSERT INTO worker_health(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET ran_at=now(),last_error=NULL`,
      [name],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Maintenance failed";
    console.error(name, message);
    await query(
      `INSERT INTO worker_health(name,last_error) VALUES($1,$2)
      ON CONFLICT(name) DO UPDATE SET ran_at=now(),last_error=excluded.last_error`,
      [name, message.slice(0, 350)],
    );
  }
}
async function queueWork() {
  const delay = Math.max(0, Number(process.env.MARKET_CLOSE_DELAY_MINUTES || 30));
  await query(
    `INSERT INTO sync_jobs(year,session_date)
    SELECT m.year,m.session_date FROM market_sessions m JOIN seasons y ON y.year=m.year
    WHERE y.final_revision IS NULL AND m.closes_at +
      (CASE WHEN y.data_mode='free' THEN greatest(2880,$1::integer) ELSE $1::integer END)*interval '1 minute' <= now()
    ON CONFLICT DO NOTHING`,
    [delay],
  );
  await query("DELETE FROM request_limits WHERE expires_at < now()-interval '1 day'");
}
async function claimJob() {
  return one<Job>(`UPDATE sync_jobs SET status='running',
    attempts=attempts+CASE WHEN status='running' AND started_at IS NOT NULL THEN 0 ELSE 1 END,
    started_at=CASE WHEN status='running' THEN coalesce(started_at,clock_timestamp()) ELSE clock_timestamp() END
    WHERE id=(SELECT j.id FROM sync_jobs j JOIN market_sessions m USING(year,session_date)
      WHERE (j.status IN ('pending','failed') AND j.available_at<=now() OR j.status='running')
      AND m.closes_at<=now() ORDER BY (j.status='running') DESC,j.session_date,j.year LIMIT 1)
    RETURNING id,year,session_date::text AS date,attempts,started_at`);
}
async function getTargets(date: string, ids: string[]) {
  return query<Target>(
    `SELECT s.id,coalesce(h.symbol,s.symbol) AS symbol,s.market_history_id,s.benchmark,
      (h.symbol IS NULL OR EXISTS(SELECT 1 FROM securities owner WHERE owner.active AND owner.symbol=h.symbol AND owner.id<>s.id)) AS identity_conflict,
      EXISTS(SELECT 1 FROM daily_prices d WHERE d.security_id=s.id AND d.session_date=$2) AS has_price
    FROM securities s LEFT JOIN security_symbols h ON h.security_id=s.id AND daterange(valid_from,valid_until,'[)') @> $2::date
    WHERE s.id=ANY($1::uuid[]) ORDER BY s.benchmark,s.symbol`,
    [ids, date],
  );
}

function providerBackoff(error: unknown): error is ProviderError {
  return error instanceof ProviderError && [401, 403, 429, 503].includes(error.status);
}

async function fillYahooBars(job: Job, targets: Target[], signal?: AbortSignal) {
  const missing = targets.filter((target) => !target.has_price && !target.identity_conflict);
  if (!missing.length) return;
  const session = await one<{ opens_at: Date; closes_at: Date; next_open: Date | null }>(
    `SELECT opens_at,closes_at,(SELECT min(l.opens_at) FROM market_sessions l WHERE l.session_date>m.session_date) AS next_open
    FROM market_sessions m WHERE m.year=$1 AND m.session_date=$2
    AND m.closes_at + interval '30 minutes' <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM market_sessions later
      WHERE later.session_date>m.session_date AND later.opens_at<=clock_timestamp())`,
    [job.year, job.date],
  );
  if (!session) return;

  if (!yahooSessionConfigured()) {
    const tried = new Set(
      (
        await query<{ security_id: string; symbol: string }>(
          `SELECT security_id,symbol FROM market_observations WHERE source=$1 AND observed_through=$2
        AND checked_at >= $3::timestamptz`,
          [yahooChartSource, job.date, job.started_at],
        )
      ).map(({ security_id, symbol }) => `${security_id}/${symbol}`),
    );
    const remaining = missing.filter(({ id, symbol }) => !tried.has(`${id}/${symbol}`));
    const sliceSize = 25;
    let firstError: Error | undefined;
    const window = { signal, before: session.next_open ?? undefined };
    for (const target of remaining.slice(0, sliceSize)) {
      if (signal?.aborted) return true;
      if (session.next_open && Date.now() >= session.next_open.valueOf()) return;
      try {
        const bar = yahooChartBar(await yahooDailyChart(target.symbol, window), job.date, session);
        if (bar) {
          await savePrice(target.id, target.symbol, bar, yahooChartSource);
          target.has_price = true;
          continue;
        }
      } catch (error) {
        if (signal?.aborted) return true;
        if (providerBackoff(error)) throw error;
        firstError ??= error instanceof Error ? error : new Error("Yahoo Finance synchronization failed");
      }
      await query(
        `INSERT INTO market_observations(security_id,symbol,source,observed_through) VALUES($1,$2,$3,$4)
        ON CONFLICT(security_id,symbol,source) DO UPDATE SET checked_at=clock_timestamp(), observed_through=excluded.observed_through`,
        [target.id, target.symbol, yahooChartSource, job.date],
      );
    }
    if (remaining.length > sliceSize) return true;
    if (firstError) throw firstError;
    return;
  }

  for (let offset = 0; offset < missing.length; offset += yahooBatchSize) {
    const batch = missing.slice(offset, offset + yahooBatchSize);
    const quotes = await yahooQuotes(batch.map(({ symbol }) => symbol));
    for (const target of batch) {
      const bar = yahooSessionBar(quotes.get(target.symbol), job.date, session);
      if (bar) {
        await savePrice(target.id, target.symbol, bar, yahooSource);
        target.has_price = true;
      }
    }
  }
}

async function fillFreeBars(season: Season, date: string, target: Target) {
  const fresh = await one(
    `SELECT 1 FROM market_observations WHERE security_id=$1 AND source=$2 AND symbol=$3
    AND checked_at>now()-interval '10 hours'`,
    [target.id, freeSource, target.symbol],
  );
  if (fresh) return;
  const sessions = new Set(
    (
      await query<{ date: string }>(
        `SELECT m.session_date::text AS date FROM market_sessions m JOIN security_symbols h
          ON h.security_id=$2 AND h.symbol=$3 AND daterange(h.valid_from,h.valid_until,'[)') @> m.session_date
    WHERE m.year=$1 AND m.closes_at<=now()-interval '48 hours'`,
        [season.year, target.id, target.symbol],
      )
    ).map((row) => row.date),
  );
  const known = await one<{ recent: boolean }>(`SELECT now()-$1::date<interval '100 days' AS recent`, [date]);
  const bars = await historyBars(
    target.symbol,
    known.recent ? undefined : date,
    known.recent ? undefined : date,
  );
  const newest = bars.at(-1);
  const marketId = target.market_history_id == null ? newest?.symbolId : Number(target.market_history_id);
  if (marketId != null && target.market_history_id == null) {
    await query("UPDATE securities SET market_history_id=$2 WHERE id=$1 AND market_history_id IS NULL", [
      target.id,
      marketId,
    ]);
  }
  const records = bars.filter((bar) => bar.symbolId === marketId && sessions.has(bar.date));
  await query(
    `INSERT INTO daily_prices(security_id,session_date,symbol,open,close,high,low,source)
    SELECT $1,b.date,$2,b.open,b.close,b.high,b.low,$3 FROM jsonb_to_recordset($4::jsonb)
      AS b(date date,open numeric,close numeric,high numeric,low numeric)
    ON CONFLICT(security_id,session_date) DO NOTHING`,
    [
      target.id,
      target.symbol,
      freeSource,
      JSON.stringify([...new Map(records.map((bar) => [bar.date, bar])).values()]),
    ],
  );
  if (known.recent)
    await query(
      `INSERT INTO market_observations(security_id,symbol,source) VALUES($1,$2,$3)
    ON CONFLICT(security_id,symbol,source) DO UPDATE SET checked_at=now()`,
      [target.id, target.symbol, freeSource],
    );
}

async function storeSplit(id: string, date: string, ratio: number, source: string) {
  await query(
    `INSERT INTO corporate_actions(security_id,effective_date,sequence,kind,ratio,source)
    VALUES($1,$2,-1,'split',$3,$4) ON CONFLICT DO NOTHING`,
    [id, date, ratio, source],
  );
}
async function checkFreeActions(season: Season, target: Target, date: string) {
  if (!process.env.MARKET_HISTORY_ACTIONS_KEY) return;
  const check = await one(
    `SELECT 1 FROM market_observations WHERE security_id=$1 AND symbol=$2 AND source='Corporate actions'
      AND (checked_at>now()-interval '6 days' AND $3 <> $4 OR observed_through >= $3::date)`,
    [target.id, target.symbol, date, season.last_session],
  );
  if (check) return;
  const actions = await historyActions(target.symbol, season.first_session, date);
  for (const action of actions ?? []) {
    const effective = action.ex_date || action.process_date;
    if (!effective || effective < season.first_session || effective > date) continue;
    if ((action.type === "cash_dividends" && !action.special) || action.type === "name_changes") continue;
    if (["forward_splits", "reverse_splits", "stock_dividends"].includes(action.type)) {
      const ratio = action.new_rate && action.old_rate ? action.new_rate / action.old_rate : action.rate;
      if (ratio) {
        await storeSplit(target.id, effective, ratio, `Market History action ${action.id}`);
        continue;
      }
    }
    await review(
      season.year,
      target.id,
      `action:${action.id}`,
      `${action.type.replaceAll("_", " ")} reported for ${effective}. Verify its terms before publishing.`,
      effective,
    );
  }
  await query(
    `INSERT INTO market_observations(security_id,symbol,source,observed_through) VALUES($1,$2,'Corporate actions',$3)
    ON CONFLICT(security_id,symbol,source) DO UPDATE SET checked_at=now(),
      observed_through=greatest(market_observations.observed_through,excluded.observed_through)`,
    [target.id, target.symbol, date],
  );
}
async function syncTarget(season: Season, job: Job, target: Target, yahooError?: Error) {
  if (target.identity_conflict) {
    if (!target.has_price)
      await review(
        job.year,
        target.id,
        `identity:${job.date}`,
        `Verify the symbol ownership or successor for ${job.date}.`,
        job.date,
      );
    return;
  }
  if (!target.has_price) {
    if (season.data_mode === "free") await fillFreeBars(season, job.date, target);
    else {
      const bar = await officialBar(target.symbol, job.date);
      if (bar) await savePrice(target.id, target.symbol, bar, officialSource);
      else if (yahooError) throw yahooError;
    }
  }
  await checkFreeActions(season, target, job.date);
  if (season.data_mode === "official") {
    for (const split of await massiveSplits(target.symbol, job.date)) {
      await storeSplit(
        target.id,
        split.execution_date,
        split.split_to / split.split_from,
        `Massive action ${split.id}`,
      );
    }
  }
  if (!target.benchmark) {
    const jump = await one(
      `SELECT 1 FROM daily_prices d
        JOIN market_sessions m ON m.session_date=d.session_date AND m.year=$3
        JOIN LATERAL (SELECT close FROM daily_prices p WHERE p.security_id=d.security_id AND p.session_date<d.session_date
          ORDER BY session_date DESC LIMIT 1) p ON true
        WHERE d.security_id=$1 AND d.session_date=$2 AND (d.open/p.close > 1.45 OR d.open/p.close < .55)
        AND NOT EXISTS(SELECT 1 FROM corporate_actions WHERE security_id=$1 AND effective_date=$2 AND voided_at IS NULL)`,
      [target.id, job.date, job.year],
    );
    if (jump)
      await review(
        job.year,
        target.id,
        `movement:${job.date}`,
        `Unusually large opening move on ${job.date}. Verify whether a corporate action affected the quote.`,
        job.date,
      );
  }
}

async function processJob(job: Job, signal?: AbortSignal) {
  const season = await getSeason(job.year);
  if (!season || season.final_revision) {
    await query("UPDATE sync_jobs SET status='succeeded',finished_at=now() WHERE id=$1", [job.id]);
    return;
  }
  const universe = await seasonUniverse(season);
  const targets = universe.entries.some((entry) => !entry.disqualified_reason)
    ? await getTargets(job.date, universe.allIds)
    : [];
  let yahooError: Error | undefined;
  if (season.data_mode === "official" && process.env.YAHOO_FINANCE_PUBLIC_DISPLAY_APPROVED === "true") {
    try {
      if (await fillYahooBars(job, targets, signal)) return;
    } catch (error) {
      yahooError = error instanceof Error ? error : new Error("Yahoo Finance synchronization failed");
    }
  }
  if (signal?.aborted) return;
  let providerWait = 0;
  const failures: string[] = [];
  for (const target of targets) {
    if (signal?.aborted) return;
    try {
      await syncTarget(season, job, target, yahooError);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider request failed";
      failures.push(`${target.symbol}: ${message.slice(0, 180)}`);
      if (providerBackoff(error)) {
        providerWait = error.wait || 60;
        break;
      }
    }
  }
  const result = await transaction(async (db) => {
    await db.query("SELECT year FROM seasons WHERE year=$1 FOR UPDATE", [job.year]);
    await db.query("SAVEPOINT standings_snapshot");
    const scored = await rebuildStandings(job.year, job.date, db);
    const missingBenchmarks =
      scored.count > 0 &&
      (await one(
        `SELECT 1 FROM benchmark_standings WHERE year=$1 AND session_date=$2 AND return_pct IS NULL LIMIT 1`,
        [job.year, job.date],
        db,
      ));
    if (scored.unresolved || missingBenchmarks || failures.length) {
      const detail =
        failures[0] ?? `${scored.unresolved} entries and/or benchmarks awaiting market data or review`;
      const gaps =
        job.attempts >= 4
          ? await query<{ security_id: string }>(
              `SELECT DISTINCT e.security_id FROM entries e JOIN daily_standings d ON d.entry_id=e.id AND d.session_date=$2
        WHERE e.season_year=$1 AND d.return_pct IS NULL AND e.disqualified_reason IS NULL
        AND d.status IN ('opening price pending','closing price pending')`,
              [job.year, job.date],
              db,
            )
          : [];
      await db.query("ROLLBACK TO SAVEPOINT standings_snapshot");
      if (gaps.length) {
        await db.query(
          `INSERT INTO security_reviews(year,security_id,category,message)
          SELECT $1,id,'gap:'||$2::text,'No verified value for '||$2::text FROM unnest($3::uuid[]) AS ids(id)
          ON CONFLICT DO NOTHING`,
          [job.year, job.date, gaps.map(({ security_id }) => security_id)],
        );
      }
      await db.query(
        `UPDATE sync_jobs SET status='failed',finished_at=now(),
        available_at=now()+$2*interval '1 second',last_error=$3 WHERE id=$1`,
        [job.id, Math.max(providerWait, Math.min(43200, 1800 * job.attempts)), detail],
      );
      return false;
    }
    await db.query("UPDATE sync_jobs SET status='succeeded',finished_at=now(),last_error=NULL WHERE id=$1", [
      job.id,
    ]);
    await db.query(
      `UPDATE security_reviews SET resolved_at=now(),resolution='Verified price or adjustment received'
      WHERE year=$1 AND category='gap:'||$2::text AND resolved_at IS NULL`,
      [job.year, job.date],
    );
    await db.query(
      `UPDATE seasons SET published_date=$2,last_updated_at=now()
      WHERE year=$1 AND (published_date IS NULL OR published_date <= $2)`,
      [job.year, job.date],
    );
    return true;
  });
  if (result && season.ends_at.valueOf() <= Date.now()) await finalizeSeason(job.year);
}

async function deliverNotifications() {
  if (process.env.DISCORD_WEBHOOK_URL) {
    await query(
      `INSERT INTO notifications(key,message)
      SELECT 'entry-open:'||year, year||' BioTrades X registration is open. Choose your stock: '||$1||'/join'
      FROM seasons WHERE registration_at<=now() AND locks_at>now() ON CONFLICT DO NOTHING`,
      [appUrl],
    );
    await query(
      `INSERT INTO notifications(key,message)
      SELECT 'entry-lock:'||year, year||' BioTrades X picks are locked and the season is underway: '||$1||'/competitions/'||year
      FROM seasons WHERE locks_at BETWEEN now()-interval '2 days' AND now() ON CONFLICT DO NOTHING`,
      [appUrl],
    );
  }
  const rows = await query<{ key: string; message: string; destination: string; recipient: string | null }>(
    `SELECT * FROM notifications
    WHERE sent_at IS NULL AND available_at<=now() AND ($1 OR destination='email') ORDER BY available_at LIMIT 10`,
    [Boolean(process.env.DISCORD_WEBHOOK_URL)],
  );
  for (const row of rows) {
    try {
      if (row.destination === "email" && row.recipient)
        await sendMail(row.recipient, "Review your BioTrades X pick", row.message);
      else {
        const webhook = new URL(process.env.DISCORD_WEBHOOK_URL!);
        if (
          webhook.protocol !== "https:" ||
          !["discord.com", "discordapp.com"].includes(webhook.hostname) ||
          !webhook.pathname.startsWith("/api/webhooks/")
        ) {
          throw new Error("Invalid Discord webhook");
        }
        const response = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: row.message, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
      }
      await query("UPDATE notifications SET sent_at=now(),recipient=NULL WHERE key=$1", [row.key]);
    } catch {
      await query(
        "UPDATE notifications SET attempts=attempts+1,available_at=now()+interval '1 hour' WHERE key=$1",
        [row.key],
      );
    }
  }
}

export async function workOnce(signal?: AbortSignal) {
  const lock = await pool.connect();
  try {
    const claimed = await one<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(5801247) AS acquired",
      [],
      lock,
    );
    if (!claimed.acquired) return false;
    await maintenance("calendar", "5 hours", refreshCalendars);
    await maintenance("securities", "6 hours", async () => {
      await ensureBenchmarks();
      await refreshSecurities();
    });
    await checkEligibility();
    await queueWork();
    const job = await claimJob();
    if (job) {
      try {
        await processJob(job, signal);
      } catch (error) {
        const wait = error instanceof ProviderError ? error.wait : 0;
        const message = error instanceof Error ? error.message : "Sync failed";
        console.error("Market sync", job.year, job.date, message);
        await query(
          `UPDATE sync_jobs SET status='failed',finished_at=now(),available_at=now()+$2*interval '1 second',last_error=$3 WHERE id=$1`,
          [
            job.id,
            Math.max(wait, Math.min(21600, 60 * 2 ** Math.min(8, job.attempts))),
            message.slice(0, 300),
          ],
        );
      }
    }
    if (signal?.aborted) return Boolean(job);
    const finalizing = await query<{ year: number }>(`SELECT year FROM seasons WHERE final_revision IS NULL
      AND ends_at<=now() AND published_date=last_session ORDER BY year LIMIT 4`);
    for (const { year } of finalizing) await finalizeSeason(year);
    await deliverNotifications();
    await query(
      `INSERT INTO worker_health(name) VALUES('worker') ON CONFLICT(name) DO UPDATE SET ran_at=now(),last_error=NULL`,
    );
    return Boolean(job);
  } finally {
    await lock.query("SELECT pg_advisory_unlock(5801247)").catch(() => {});
    lock.release();
  }
}
