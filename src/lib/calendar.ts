import { DateTime } from "luxon";
import { z } from "zod";
import { firstYear, marketMode } from "./config";
import { one, query, transaction, type Database } from "./db";
import { ruleSections, rulesVersion } from "./rules";

export const zone = "America/New_York";
export type MarketSession = { date: string; open: string; close: string };
const calendarRow = z.object({
  date: z.iso.date(),
  open: z.string().regex(/^\d\d:\d\d$/),
  close: z.string().regex(/^\d\d:\d\d$/),
});

const exchangeHolidays: Record<number, string[]> = {
  2027: ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24"],
  2028: ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25"],
};
const earlyCloses = new Set(["2027-11-26", "2028-07-03", "2028-11-24"]);
export const nyseSource = "NYSE Holidays & Trading Hours";

function exchangeSessions(year: number, holidays: string[], shortSessions: Set<string>): MarketSession[] {
  const sessions: MarketSession[] = [];
  for (
    let day = DateTime.fromObject({ year, month: 1, day: 1 }, { zone });
    day.year === year;
    day = day.plus({ days: 1 })
  ) {
    const date = day.toISODate()!;
    if (day.weekday <= 5 && !holidays.includes(date.slice(5))) {
      sessions.push({ date, open: "09:30", close: shortSessions.has(date) ? "13:00" : "16:00" });
    }
  }
  return sessions;
}
export function publishedCalendar(year: number): MarketSession[] {
  const holidays = exchangeHolidays[year];
  return holidays ? exchangeSessions(year, holidays, earlyCloses) : [];
}
const dateWords =
  /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),? (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})/i;
function plainText(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#160);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function monthDay(text: string, year: number) {
  const match = dateWords.exec(text);
  if (!match) return;
  const parsed = DateTime.fromFormat(`${match[1]} ${match[2]} ${year}`, "MMMM d yyyy", {
    zone,
    locale: "en-US",
  });
  if (parsed.isValid) return parsed.toFormat("MM-dd");
}
export function parseNyseCalendar(html: string, year: number): MarketSession[] {
  const tables = html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi);
  for (const [table] of tables) {
    const rows = Array.from(table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), ([, row]) =>
      Array.from(row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi), ([, cell]) => plainText(cell)),
    );
    if (rows[0]?.[0] !== "Holiday") continue;
    const column = rows[0].indexOf(String(year));
    if (column === -1) continue;
    const holidays = rows.slice(1).filter((row) => row.length === rows[0].length);
    if (holidays.length < 9 || holidays.length > 14) throw new Error("Unexpected NYSE holiday table");
    const dates: string[] = [];
    for (const row of holidays) {
      const date = monthDay(row[column], year);
      if (date) dates.push(date);
      else if (!/^([—–-]|&mdash;|&#8212;)/.test(row[column]))
        throw new Error("Unrecognized NYSE holiday date");
    }
    const shortened = new Set<string>();
    const notes = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), ([, line]) => plainText(line));
    for (const note of notes.filter((line) => /will close early at 1:00 p\.m\./i.test(line))) {
      for (const match of note.matchAll(new RegExp(`${dateWords.source}, (\\d{4})`, "gi"))) {
        if (Number(match[3]) === year) {
          const day = monthDay(match[0], year);
          if (day) shortened.add(`${year}-${day}`);
        }
      }
    }
    if (!shortened.size) throw new Error("NYSE early-session dates were not recognized");
    return exchangeSessions(year, dates, shortened);
  }
  return [];
}

export type Season = {
  year: number;
  registration_at: Date;
  locks_at: Date;
  ends_at: Date;
  first_session: string;
  last_session: string;
  calendar_source: string;
  rules_version: number;
  data_mode: "free" | "official";
  final_revision: number | null;
  finalized_at: Date | null;
  published_date: string | null;
  last_updated_at: Date | null;
  phase: "Upcoming" | "Registration open" | "Picks locked" | "Active" | "Finalizing" | "Completed";
};
const seasonSelect = `SELECT seasons.*, first_session::text, last_session::text, published_date::text,
  CASE WHEN final_revision IS NOT NULL THEN 'Completed'
       WHEN now() < registration_at THEN 'Upcoming'
       WHEN now() < locks_at THEN 'Registration open'
       WHEN now() >= ends_at THEN 'Finalizing'
       WHEN published_date IS NULL THEN 'Picks locked'
       ELSE 'Active' END AS phase FROM seasons`;

export async function getSeason(year: number, db?: Database) {
  return one<Season>(`${seasonSelect} WHERE year=$1`, [year], db);
}
export async function listSeasons() {
  return query<Season>(`${seasonSelect} ORDER BY year DESC`);
}
export function fallbackSeason(
  year = Math.max(firstYear, DateTime.now().setZone(zone).year),
): Season | undefined {
  const sessions = publishedCalendar(year);
  if (!sessions.length) return;
  const first = sessions[0],
    last = sessions[sessions.length - 1];
  return {
    year,
    phase: "Upcoming",
    first_session: first.date,
    last_session: last.date,
    locks_at: sessionTime(first.date, first.open),
    ends_at: sessionTime(last.date, last.close),
    registration_at: sessionTime(`${year - 1}-12-01`, "00:00"),
    calendar_source: nyseSource,
    rules_version: rulesVersion,
    data_mode: marketMode,
    final_revision: null,
    finalized_at: null,
    published_date: null,
    last_updated_at: null,
  };
}

function sessionTime(date: string, time: string) {
  const value = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!value.isValid) throw new Error("Invalid exchange-calendar timestamp");
  return value.toJSDate();
}
export async function saveCalendar(year: number, rows: MarketSession[], source: string) {
  const sessions = z
    .array(calendarRow)
    .min(1)
    .parse(rows)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = new Set(sessions.map(({ date }) => date));
  if (
    dates.size !== sessions.length ||
    sessions.some(({ date, open, close }) => !date.startsWith(`${year}-`) || open >= close)
  ) {
    throw new Error("Calendar has duplicate dates, a session outside its year, or reversed hours");
  }
  const first = sessions[0],
    last = sessions[sessions.length - 1];
  return transaction(async (db) => {
    await db.query(`INSERT INTO rulesets VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [
      rulesVersion,
      "Annual stock competition",
      JSON.stringify(ruleSections),
    ]);
    await db.query(
      `INSERT INTO seasons(year,registration_at,locks_at,ends_at,first_session,last_session,calendar_source,rules_version,data_mode)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [
        year,
        sessionTime(`${year - 1}-12-01`, "00:00"),
        sessionTime(first.date, first.open),
        sessionTime(last.date, last.close),
        first.date,
        last.date,
        source,
        rulesVersion,
        marketMode,
      ],
    );
    const existing = await one<Season & { locked: boolean }>(
      `SELECT *,first_session::text,published_date::text,locks_at <= clock_timestamp() AS locked FROM seasons WHERE year=$1 FOR UPDATE`,
      [year],
      db,
    );
    if (existing.final_revision) return;
    const replaceUnscoredOpening =
      existing.locked &&
      existing.published_date === null &&
      first.date > existing.first_session &&
      !dates.has(existing.first_session);
    const calendarEntries = sessions.map(({ date, open, close }) => ({
      date,
      opens: sessionTime(date, open),
      closes: sessionTime(date, close),
    }));
    await db.query(
      `INSERT INTO market_sessions(year,session_date,opens_at,closes_at)
      SELECT $1, date, opens, closes FROM jsonb_to_recordset($2::jsonb) AS data(date date, opens timestamptz, closes timestamptz)
      ON CONFLICT(year,session_date) DO UPDATE SET opens_at=excluded.opens_at,closes_at=excluded.closes_at
      WHERE market_sessions.opens_at > clock_timestamp()`,
      [year, JSON.stringify(calendarEntries)],
    );
    await db.query(
      `DELETE FROM market_sessions WHERE year=$1 AND (opens_at > clock_timestamp() OR ($3 AND session_date=$4))
      AND NOT (session_date=ANY($2::date[]))`,
      [year, [...dates], replaceUnscoredOpening, existing.first_session],
    );
    await db.query(
      `UPDATE seasons SET
      locks_at=CASE WHEN $8 THEN locks_at ELSE $2 END,
      ends_at=$3,
      first_session=CASE WHEN $8 AND NOT $9 THEN first_session ELSE $4 END,
      last_session=$5, calendar_source=$6,
      data_mode=CASE WHEN registration_at>clock_timestamp() THEN $10 ELSE data_mode END
      WHERE year=$1 AND (last_session::text > $7 OR ends_at > clock_timestamp() OR last_session=$5)`,
      [
        year,
        sessionTime(first.date, first.open),
        sessionTime(last.date, last.close),
        first.date,
        last.date,
        source,
        DateTime.now().setZone(zone).toISODate(),
        existing.locked,
        replaceUnscoredOpening,
        marketMode,
      ],
    );
  });
}

export async function refreshCalendars() {
  const current = DateTime.now().setZone(zone).year;
  const maxYear = Math.max(current + 1, firstYear);
  let exchangeHtml: string | undefined;
  for (let year = Math.max(firstYear, current - 1); year <= maxYear; year++) {
    const existing = await getSeason(year);
    if (
      existing?.final_revision ||
      (existing && ![nyseSource, "Alpaca US equities calendar"].includes(existing.calendar_source))
    )
      continue;
    const known = publishedCalendar(year);
    if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY) {
      try {
        const response = await fetch(
          `https://paper-api.alpaca.markets/v2/calendar?start=${year}-01-01&end=${year}-12-31`,
          {
            headers: {
              "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID,
              "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY,
            },
            signal: AbortSignal.timeout(20000),
          },
        );
        if (!response.ok) throw new Error(`Calendar provider returned HTTP ${response.status}`);
        const rows = z
          .array(calendarRow)
          .min(240)
          .max(260)
          .parse(await response.json());
        if (rows[0].date.slice(5, 7) !== "01" || rows[rows.length - 1].date.slice(5, 7) !== "12")
          throw new Error("Incomplete annual market calendar");
        await saveCalendar(year, rows, "Alpaca US equities calendar");
        continue;
      } catch (error) {
        if (!existing && known.length) await saveCalendar(year, known, nyseSource);
        throw error;
      }
    }
    try {
      if (exchangeHtml === undefined) {
        const response = await fetch("https://www.nyse.com/trade/hours-calendars", {
          signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) throw new Error(`NYSE calendar returned HTTP ${response.status}`);
        exchangeHtml = await response.text();
      }
      const sessions = parseNyseCalendar(exchangeHtml, year);
      if (sessions.length) await saveCalendar(year, sessions, nyseSource);
      else if (!existing && known.length) await saveCalendar(year, known, nyseSource);
      else if (!existing && (year <= current || DateTime.now().setZone(zone).month >= 11))
        throw new Error(`No verified trading calendar for ${year}`);
    } catch (error) {
      if (!existing && known.length) await saveCalendar(year, known, nyseSource);
      throw error;
    }
  }
}

export function selectHomeSeason(seasons: Season[], current = DateTime.now().setZone(zone).year) {
  return (
    seasons.find(({ year }) => year === current) ??
    seasons.filter(({ year }) => year > current).at(-1) ??
    seasons[0]
  );
}

export function selectEntrySeason(seasons: Season[], overview?: Season) {
  return (
    seasons.find(({ phase }) => phase === "Registration open") ??
    seasons.filter(({ phase }) => phase === "Upcoming").at(-1) ??
    overview
  );
}
