import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL annual lifecycle", () => {
  it("accepts one private pick per account, reveals tied ranks and archives verified results and trophies", async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool, one, query, transaction } = await import("../src/lib/db");
    const { getSeason } = await import("../src/lib/calendar");
    const { rebuildStandings, finalizeSeason } = await import("../src/lib/standings");
    const {
      getBoard,
      getBenchmarks,
      getHall,
      getOverview,
      getProfileYears,
      getStats,
      getStocks,
      getStockSeries,
      getTrophies,
    } = await import("../src/lib/public-data");
    const { saveSecurity, ensureBenchmarks } = await import("../src/lib/securities");
    const { GET: exportCsv } = await import("../src/app/api/leaderboard/export/route");
    const year = (
      await one<{ year: number }>("SELECT greatest(4000,coalesce(max(year),3999)+1) AS year FROM seasons")
    ).year;
    const first = `${year}-01-03`,
      final = `${year}-12-30`;
    await query("INSERT INTO rulesets VALUES(1,'Fixture','[]') ON CONFLICT DO NOTHING");
    await query(
      `INSERT INTO seasons(year,registration_at,locks_at,ends_at,first_session,last_session,calendar_source,rules_version,data_mode)
      VALUES($1,now()-interval '1 day',now()+interval '5 minutes',now()+interval '1 day',$2,$3,'Fixture',1,'free')`,
      [year, first, final],
    );
    for (const date of [first, final])
      await query(
        "INSERT INTO market_sessions VALUES($1,$2,now()-interval '3 days',now()-interval '2 days')",
        [year, date],
      );
    const suffix = year.toString(36).toUpperCase();
    const a = await saveSecurity({
      key: `fixture:a:${year}`,
      symbol: `T${suffix}`,
      name: "Trial Company",
      exchange: "XNAS",
      instrument: "common:common",
      eligible: true,
    });
    const b = await saveSecurity({
      key: `fixture:b:${year}`,
      symbol: `L${suffix}`,
      name: "Other Biotech",
      exchange: "XNAS",
      instrument: "common:common",
      eligible: true,
    });
    const invalid = await saveSecurity({
      key: `fixture:x:${year}`,
      symbol: `Z${suffix}`,
      name: "Disallowed",
      exchange: "XNAS",
      instrument: "ETF",
      eligible: false,
    });
    const name = (n: number) => `fixture_${year}_${n}`;
    const userId = randomUUID();
    await query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
      [userId, name(1), `${name(1)}@example.test`],
    );
    const players = await Promise.all(
      [1, 2, 3].map((n) =>
        one<{ id: string }>("INSERT INTO profiles(username,auth_user_id) VALUES($1,$2) RETURNING id", [
          name(n),
          n === 1 ? userId : null,
        ]),
      ),
    );
    await expect(
      query("INSERT INTO profiles(username) VALUES($1)", [name(1).toUpperCase()]),
    ).rejects.toMatchObject({ code: "23505" });
    const pick = (profile: string, stock: typeof a) =>
      query(
        "INSERT INTO entries(season_year,profile_id,security_id,pick_symbol,company) VALUES($1,$2,$3,$4,$5)",
        [year, profile, stock.id, stock.symbol, stock.name],
      );
    await expect(pick(players[0].id, invalid)).rejects.toMatchObject({ code: "BT002" });
    await Promise.all([pick(players[0].id, a), pick(players[1].id, a), pick(players[2].id, b)]);
    await expect(pick(players[0].id, b)).rejects.toMatchObject({ code: "23505" });
    let season = (await getSeason(year))!;
    expect(season.phase).toBe("Registration open");
    expect((await getOverview(season)).unique).toBeNull();
    expect((await getBoard(season)).rows).toEqual([]);
    expect(await getProfileYears(players[0].id)).toEqual([]);
    expect(await getStocks(season)).toEqual([]);
    expect(
      (await exportCsv(new Request(`http://localhost/api/leaderboard/export?year=${year}`))).status,
    ).toBe(404);
    await query(
      "UPDATE entries SET security_id=$3,pick_symbol=$4,company=$5,updated_at=now() WHERE season_year=$1 AND profile_id=$2",
      [year, players[0].id, b.id, b.symbol, b.name],
    );
    await query(
      "UPDATE entries SET security_id=$3,pick_symbol=$4,company=$5,updated_at=now() WHERE season_year=$1 AND profile_id=$2",
      [year, players[0].id, a.id, a.symbol, a.name],
    );
    const securityLock = await pool.connect();
    try {
      await securityLock.query("BEGIN");
      await securityLock.query("SELECT id FROM securities WHERE id=$1 FOR UPDATE", [b.id]);
      await query("UPDATE seasons SET locks_at=now()+interval '350 milliseconds' WHERE year=$1", [year]);
      const action = expect(
        query(
          "UPDATE entries SET security_id=$3,pick_symbol=$4,company=$5,updated_at=now() WHERE season_year=$1 AND profile_id=$2",
          [year, players[0].id, b.id, b.symbol, b.name],
        ),
      ).rejects.toMatchObject({ code: "BT001" });
      await new Promise((resolve) => setTimeout(resolve, 460));
      await securityLock.query("ROLLBACK");
      await action;
    } finally {
      securityLock.release();
    }
    await query("UPDATE seasons SET ends_at=locks_at+interval '1 millisecond' WHERE year=$1", [year]);
    await expect(query("DELETE FROM entries WHERE season_year=$1", [year])).rejects.toMatchObject({
      code: "BT001",
    });
    await expect(
      query("UPDATE seasons SET locks_at=now()+interval '1 hour' WHERE year=$1", [year]),
    ).rejects.toThrow("Cannot reopen");
    await ensureBenchmarks();
    const benchmark = await query<{ id: string; symbol: string }>(
      "SELECT id,symbol FROM securities WHERE benchmark",
    );
    for (const stock of [a, b, ...benchmark]) {
      await query(
        "INSERT INTO daily_prices(security_id,session_date,symbol,open,close,source) VALUES($1,$2,$3,10,11,'Verified fixture')",
        [stock.id, first, stock.symbol],
      );
      await query(
        "INSERT INTO daily_prices(security_id,session_date,symbol,open,close,source) VALUES($1,$2,$3,10,$4,'Verified fixture')",
        [stock.id, final, stock.symbol, stock.id === a.id ? 15 : stock.id === b.id ? 8 : 12],
      );
    }
    await transaction(async (db) => {
      for (const date of [first, final]) {
        expect((await rebuildStandings(year, date, db)).unresolved).toBe(0);
        await db.query("INSERT INTO sync_jobs(year,session_date,status) VALUES($1,$2,'succeeded')", [
          year,
          date,
        ]);
      }
    });
    expect(await finalizeSeason(year)).toBeNull();
    await query("INSERT INTO audit_log(actor,action,target) VALUES('test','verify-action-coverage',$1)", [
      String(year),
    ]);
    expect(await finalizeSeason(year)).toEqual({ revision: 1, ranked: 3 });
    expect(await finalizeSeason(year)).toBeNull();
    season = (await getSeason(year))!;
    const board = await getBoard(season);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
    expect(board.rows[0]).toMatchObject({ returnPct: "50.00", startPrice: null, close: null });
    expect(await getStats(season)).toMatchObject({
      participants: 3,
      unique: 2,
      profitable: 2,
      losing: 1,
      pending: 0,
    });
    expect((await getBenchmarks(season)).map(({ beat }) => beat)).toEqual([2, 2, 2]);
    expect(await getStockSeries(season, a.id)).toEqual([]);
    const csv = await (
      await exportCsv(new Request(`http://localhost/api/leaderboard/export?year=${year}`))
    ).text();
    expect(csv).toContain("50.00");
    expect(csv).not.toContain("Opening price");
    expect(await getTrophies(players[0].id)).toEqual([
      { year, kind: "champion" },
      { year, kind: "elite" },
    ]);
    expect((await getHall(1)).some((row) => row.username === name(1))).toBe(true);
    await expect(query("UPDATE archives SET reason='overwrite' WHERE year=$1", [year])).rejects.toThrow(
      "immutable",
    );
    expect(await finalizeSeason(year, { actor: "test", reason: "Verify a new result revision" })).toEqual({
      revision: 2,
      ranked: 3,
    });
    expect(await getTrophies(players[0].id)).toHaveLength(2);
    await query('DELETE FROM "user" WHERE id=$1', [userId]);
    expect(
      (await getBoard((await getSeason(year))!)).rows.find((row) => row.profileId === players[0].id),
    ).toMatchObject({ removed: true, avatar: null });
    await pool.end();
  });
});
