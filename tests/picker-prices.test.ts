import { expect, it, vi } from "vitest";

it.skipIf(!process.env.TEST_DATABASE_URL)(
  "only returns approved ticker prices during official registration",
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool, one } = await import("../src/lib/db");
    const { getPickerPrices } = await import("../src/lib/securities");
    const { officialSource } = await import("../src/lib/market");
    const { yahooChartSource, yahooSource } = await import("../src/lib/yahoo");
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("INSERT INTO rulesets VALUES(1,'Fixture','[]') ON CONFLICT DO NOTHING");
      const { year } = await one<{ year: number }>(
        "SELECT greatest(7000,coalesce(max(year),6999)+1) AS year FROM seasons",
        [],
        db,
      );
      await db.query(
        `INSERT INTO seasons(year,registration_at,locks_at,ends_at,first_session,last_session,calendar_source,rules_version,data_mode)
      VALUES($1,now()-interval '1 day',now()+interval '1 day',now()+interval '2 days',$2,$3,'Fixture',1,'official')`,
        [year, `${year}-01-03`, `${year}-12-30`],
      );
      const stock = await one<{ id: string }>(
        "INSERT INTO securities(provider_key,symbol,name,exchange,instrument,active,provider_eligible) VALUES('picker-test','ZPX','Picker fixture','XNAS','common:common',true,true) RETURNING id",
        [],
        db,
      );
      for (const [date, price, source] of [
        ["2026-01-01", 11, "Verified manual fixture"],
        ["2026-01-02", 12, yahooSource],
        ["2026-01-03", 13, yahooChartSource],
        ["2026-01-04", 14, officialSource],
        ["2026-01-05", 15, "Market History fixture"],
      ]) {
        await db.query(
          "INSERT INTO daily_prices(security_id,session_date,symbol,open,close,source) VALUES($1,$2,'ZPX',10,$3,$4)",
          [stock.id, date, price, source],
        );
      }
      vi.stubEnv("MASSIVE_PUBLIC_DISPLAY_APPROVED", undefined);
      vi.stubEnv("YAHOO_FINANCE_PUBLIC_DISPLAY_APPROVED", undefined);
      expect(await getPickerPrices([stock.id], db)).toEqual([{ id: stock.id, price: "11" }]);
      vi.stubEnv("YAHOO_FINANCE_PUBLIC_DISPLAY_APPROVED", "true");
      expect(await getPickerPrices([stock.id], db)).toEqual([{ id: stock.id, price: "13" }]);
      vi.stubEnv("MASSIVE_PUBLIC_DISPLAY_APPROVED", "true");
      expect(await getPickerPrices([stock.id], db)).toEqual([{ id: stock.id, price: "14" }]);
      await db.query("DELETE FROM seasons WHERE year=$1", [year]);
      expect(await getPickerPrices([stock.id], db)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  },
);
