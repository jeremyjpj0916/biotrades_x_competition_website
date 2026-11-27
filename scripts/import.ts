import { readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { z } from "zod";
nextEnv.loadEnvConfig(process.cwd());
const { pool, one, transaction } = await import("../src/lib/db");
const { saveCalendar } = await import("../src/lib/calendar");
const { audit } = await import("../src/lib/admin");
const price = z
  .union([z.number(), z.string().regex(/^\d{1,18}(\.\d{1,12})?$/)])
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0);
const source = z.string().min(8).max(300);
const schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("calendar"),
    year: z.number().int().min(1900).max(9999),
    source,
    sessions: z
      .array(z.object({ date: z.iso.date(), open: z.string(), close: z.string() }))
      .min(240)
      .max(260),
  }),
  z.object({
    type: z.literal("prices"),
    year: z.number().int().min(1900).max(9999),
    source,
    bars: z
      .array(
        z.object({
          securityId: z.uuid(),
          date: z.iso.date(),
          symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),
          open: price,
          close: price,
          high: price.optional(),
          low: price.optional(),
        }),
      )
      .min(1)
      .max(20000),
  }),
]);
try {
  const filename = process.argv[2];
  if (!filename) throw new Error("Provide a path to a verified JSON calendar or prices file.");
  const data = schema.parse(JSON.parse(await readFile(filename, "utf8")));
  if (data.type === "calendar") {
    if (data.sessions[0]?.date.slice(5, 7) !== "01" || data.sessions.at(-1)?.date.slice(5, 7) !== "12")
      throw new Error("Import a full exchange year in order.");
    await saveCalendar(data.year, data.sessions, data.source);
    await pool.query(
      "INSERT INTO audit_log(actor,action,target,details) VALUES('operator','import-calendar',$1,$2)",
      [String(data.year), JSON.stringify({ source: data.source, sessions: data.sessions.length })],
    );
  } else {
    await transaction(async (db) => {
      const season = await one<{ data_mode: string; final_revision: number | null }>(
        "SELECT data_mode,final_revision FROM seasons WHERE year=$1 FOR UPDATE",
        [data.year],
        db,
      );
      if (!season) throw new Error("Unknown competition season");
      if (season.final_revision && !process.argv.includes("--correction"))
        throw new Error("Use --correction for a separately reviewed result revision.");
      const records = await db.query(
        `WITH incoming AS (SELECT * FROM jsonb_to_recordset($2::jsonb)
        AS b("securityId" uuid,date date,symbol text,open numeric,close numeric,high numeric,low numeric))
        INSERT INTO daily_prices(security_id,session_date,symbol,open,close,high,low,source)
        SELECT b."securityId",b.date,b.symbol,b.open,b.close,b.high,b.low,$3
        FROM incoming b JOIN market_sessions m ON m.year=$1 AND m.session_date=b.date AND m.closes_at<=now()
        JOIN security_symbols s ON s.security_id=b."securityId" AND s.symbol=b.symbol AND daterange(s.valid_from,s.valid_until,'[)') @> b.date
        ON CONFLICT(security_id,session_date) DO UPDATE SET open=excluded.open,close=excluded.close,high=excluded.high,
          low=excluded.low,symbol=excluded.symbol,source=excluded.source,fetched_at=now()`,
        [data.year, JSON.stringify(data.bars), `Verified ${data.source}`],
      );
      if (records.rowCount !== data.bars.length)
        throw new Error("One or more prices do not match a past session and security symbol.");
      if (!season.final_revision)
        await db.query(
          `UPDATE sync_jobs SET status='pending', available_at=now()
        WHERE year=$1 AND session_date >= $2 AND status<>'running'`,
          [data.year, data.bars.map((bar) => bar.date).sort()[0]],
        );
      await audit(db, "operator", "import-prices", String(data.year), {
        source: data.source,
        count: data.bars.length,
        correction: Boolean(season.final_revision),
      });
    });
  }
  console.info(`Imported ${data.type} for ${data.year}.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
