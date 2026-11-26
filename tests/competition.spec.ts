import { expect, test } from "@playwright/test";
import { useTurnstileFixture } from "./support/turnstile";

test("registers, manages a private stock pick, and publishes accurate competition tables", async ({
  page,
  isMobile,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_DATABASE_URL,
    "Set PLAYWRIGHT_DATABASE_URL to a disposable migrated database",
  );
  test.skip(isMobile, "The full annual scenario runs once. Mobile navigation has its own browser coverage.");
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  process.env.DATABASE_URL = process.env.PLAYWRIGHT_DATABASE_URL;

  const { one, pool, query, transaction } = await import("../src/lib/db");
  const { ensureBenchmarks, saveSecurity } = await import("../src/lib/securities");
  const { rebuildStandings, finalizeSeason } = await import("../src/lib/standings");
  const { runAdmin } = await import("../src/lib/admin");
  const year = (
    await one<{ year: number }>("SELECT greatest(4200,coalesce(max(year),4199)+1) AS year FROM seasons")
  ).year;
  const openingDay = `${year}-01-04`;
  const finalDay = `${year}-12-30`;
  const email = `browser-${year}@example.test`;
  const username = `picker_${year}`;
  const password = "Local-only-playwright-password-247!";
  const seasonUrl = `/competitions/${year}`;
  const [alpha, beta, flat, pending] = await Promise.all(
    [
      { code: "A", name: "Alpha Province Therapeutics" },
      { code: "B", name: "Beta Study Pharma" },
      { code: "C", name: "Neutral Genomics" },
      { code: "D", name: "Pending Genetics" },
    ].map(({ code, name }) =>
      saveSecurity({
        key: `browser:${year}:${code}`,
        symbol: `PX${code}${year}`,
        name,
        exchange: "XNAS",
        instrument: "common:common",
        industry: "Pharmaceutical Preparations",
        eligible: true,
      }),
    ),
  );
  await ensureBenchmarks();
  await query("INSERT INTO rulesets VALUES(1,'Fixture','[]') ON CONFLICT DO NOTHING");
  await query(
    `INSERT INTO seasons(year,registration_at,locks_at,ends_at,first_session,last_session,calendar_source,rules_version,data_mode)
    VALUES($1,now()-interval '1 day',now()+interval '1 hour',now()+interval '2 days',$2,$3,'Playwright fixture',1,'free')`,
    [year, openingDay, finalDay],
  );
  for (const date of [openingDay, finalDay])
    await query(
      `INSERT INTO market_sessions
    VALUES($1,$2,now()-interval '3 days',now()-interval '2 days')`,
      [year, date],
    );
  const participants = [
    { name: `tie_${year}`, stock: alpha },
    { name: `losing_${year}`, stock: beta },
    { name: `fixed_${year}`, stock: flat },
    { name: `pending_${year}`, stock: pending },
  ];
  for (const { name, stock } of participants) {
    const profile = await one<{ id: string }>("INSERT INTO profiles(username) VALUES($1) RETURNING id", [
      name,
    ]);
    await query(
      "INSERT INTO entries(season_year,profile_id,security_id,pick_symbol,company) VALUES($1,$2,$3,$4,$5)",
      [year, profile.id, stock.id, stock.symbol, stock.name],
    );
  }

  try {
    await useTurnstileFixture(page);
    await page.goto("/join");
    await page.getByLabel("Display name").fill("Browser Test Picker");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create your account", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
    const inbox = `http://127.0.0.1:3101/?email=${encodeURIComponent(email)}`;
    let activation = "";
    await expect
      .poll(async () => {
        const response = await fetch(inbox);
        if (response.ok) activation = ((await response.json()) as { link: string }).link;
        return Boolean(activation);
      })
      .toBe(true);
    await page.goto(activation);
    await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();

    const pick = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: `Choose your ${year} stock`, exact: true }) });
    const lookup = pick.getByRole("textbox", { name: "Search by ticker or company" });
    await lookup.fill("DOESNOTEXIST");
    await expect(pick.getByText("No verified securities match this search.")).toBeVisible();
    await expect(pick.getByRole("button", { name: "Save pick", exact: true })).toBeDisabled();
    async function selectStock(term: string, symbol: string) {
      await lookup.fill(term);
      await pick.getByRole("button", { name: new RegExp(symbol) }).click();
      await pick.getByRole("button", { name: "Save pick", exact: true }).click();
      await expect(pick.getByRole("status")).toContainText(`Your pick is saved: ${symbol}.`);
    }
    await selectStock("Alpha Province", alpha.symbol);
    await selectStock(beta.symbol, beta.symbol);
    await pick.getByRole("button", { name: "Withdraw pick" }).click();
    await expect(pick.getByRole("status")).toContainText("Your entry was withdrawn.");
    await selectStock(alpha.symbol, alpha.symbol);

    await page.goto(`/users/${username}`);
    await expect(page.getByText("No public competition results")).toBeVisible();
    await expect(page.getByText(alpha.symbol, { exact: true })).toHaveCount(0);
    await page.goto(`${seasonUrl}/leaderboard`);
    await expect(page.getByRole("heading", { name: "Picks are still private" })).toBeVisible();
    expect((await page.request.get(`/api/leaderboard/export?year=${year}`)).status()).toBe(404);

    await query(
      "UPDATE seasons SET locks_at=now()-interval '1 hour',ends_at=now()+interval '1 hour' WHERE year=$1",
      [year],
    );
    const closed = await page.request.post("/api/entries", {
      headers: { origin: "http://localhost:3100" },
      data: { year, securityId: beta.id },
    });
    expect(closed.status()).toBe(409);

    const benchmarks = await query<{ id: string; symbol: string }>(
      "SELECT id,symbol FROM securities WHERE benchmark",
    );
    const prices = [
      { stock: alpha, close: 15 },
      { stock: beta, close: 7 },
      { stock: flat, close: 10 },
      { stock: pending, close: null },
      ...benchmarks.map((stock) => ({ stock, close: 12 })),
    ];
    const writePrice = (stock: { id: string; symbol: string }, date: string, close: number) =>
      query(
        `INSERT INTO daily_prices(security_id,session_date,symbol,open,close,source)
        VALUES($1,$2,$3,10,$4,'Verified browser fixture')`,
        [stock.id, date, stock.symbol, close],
      );
    for (const { stock, close } of prices) {
      await writePrice(stock, openingDay, 10);
      if (close != null) await writePrice(stock, finalDay, close);
    }
    await transaction(async (db) => {
      await rebuildStandings(year, openingDay, db);
      await rebuildStandings(year, finalDay, db);
      await db.query("UPDATE seasons SET published_date=$2,last_updated_at=now() WHERE year=$1", [
        year,
        finalDay,
      ]);
      await db.query(
        "INSERT INTO sync_jobs(year,session_date,status) VALUES($1,$2,'succeeded'),($1,$3,'failed')",
        [year, openingDay, finalDay],
      );
    });
    await page.reload();
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(1)).toContainText("#1");
    await expect(rows.nth(2)).toContainText("#1");
    await expect(rows.nth(1)).toContainText("+50.00%");
    await expect(rows.nth(3)).toContainText("#3");
    await expect(rows.nth(3)).toContainText("0.00%");
    await expect(rows.nth(4)).toContainText("−30.00%");
    await expect(rows.nth(5)).toContainText("closing price pending");
    await expect(rows.filter({ hasText: username })).toContainText("You");
    await page.getByLabel("Standings date").selectOption(openingDay);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("0.00%");
    await page.getByLabel("Standings date").selectOption("");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("row").nth(1)).toContainText("+50.00%");
    await expect(page.getByRole("columnheader", { name: "Start price" })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Search", exact: true }).fill(beta.symbol);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("table").getByRole("row")).toHaveCount(2);
    await expect(page.getByRole("row").last()).toContainText("−30.00%");
    const csv = await (await page.request.get(`/api/leaderboard/export?year=${year}`)).text();
    expect(csv).toContain("50.00");
    expect(csv).toContain("-30.00");
    expect(csv).not.toContain("Opening price");

    await page.goto(`${seasonUrl}/analytics`);
    await expect(page.getByText("+17.50%", { exact: true }).first()).toBeVisible();
    const performance = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Participant performance", exact: true }) });
    await expect(performance.getByText("40.0%", { exact: true })).toBeVisible();
    await expect(performance.getByText("20.0%", { exact: true })).toHaveCount(3);
    await expect(
      page.getByRole("row").filter({ hasText: "XBI" }).filter({ hasText: "2 · 50.0% of ranked" }),
    ).toHaveCount(1);

    await page.goto(`${seasonUrl}/stocks/${alpha.id}`);
    await expect(page.getByRole("heading", { name: alpha.symbol, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: username, exact: true })).toBeVisible();
    await page.goto(`/users/${username}`);
    await expect(page.getByRole("heading", { name: "Current competition" })).toBeVisible();
    await expect(page.getByText("Trophies appear after final results are published.")).toBeVisible();

    await query("UPDATE seasons SET ends_at=locks_at+interval '1 second' WHERE year=$1", [year]);
    expect(await finalizeSeason(year)).toBeNull();
    await writePrice(pending, finalDay, 11);
    await query("UPDATE sync_jobs SET status='succeeded' WHERE year=$1", [year]);
    await runAdmin("playwright-fixture", {
      action: "verify-action-coverage",
      year,
      reason: "Deterministic simulated market and corporate actions",
    });
    expect(await finalizeSeason(year)).toEqual({ revision: 1, ranked: 5 });
    await page.reload();
    await expect(page.getByRole("link", { name: `Champion ${year} season` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Elite Stock Picker ${year} season` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current competition" })).toHaveCount(0);
    await page.goto(seasonUrl);
    await expect(page.getByRole("heading", { name: "Season champions" })).toBeVisible();
    await expect(page.getByRole("link", { name: username, exact: true }).first()).toBeVisible();
    await page.goto(`${seasonUrl}/analytics`);
    await expect(page.getByText("+16.00%", { exact: true }).first()).toBeVisible();
    await expect(performance.getByText("60.0%", { exact: true })).toBeVisible();
    await expect(
      performance.getByRole("listitem").filter({ hasText: "Profitable" }).locator(".chart-bar"),
    ).toHaveAttribute("style", /width:\s*60%/);

    const officialYear = year + 1;
    const officialDate = `${officialYear}-01-04`;
    await query(
      `INSERT INTO seasons(year,registration_at,locks_at,ends_at,first_session,last_session,calendar_source,rules_version,data_mode)
      VALUES($1,now()-interval '1 day',now()+interval '1 hour',now()+interval '2 days',$2,$3,'Playwright fixture',1,'official')`,
      [officialYear, officialDate, `${officialYear}-12-30`],
    );
    await query("INSERT INTO market_sessions VALUES($1,$2,now()-interval '3 days',now()-interval '2 days')", [
      officialYear,
      officialDate,
    ]);
    await query(
      `INSERT INTO entries(season_year,profile_id,security_id,pick_symbol,company)
      SELECT $1,id,$2,$3,$4 FROM profiles WHERE username=$5`,
      [officialYear, alpha.id, alpha.symbol, alpha.name, username],
    );
    await query("UPDATE seasons SET locks_at=now()-interval '1 hour' WHERE year=$1", [officialYear]);
    await query(
      `INSERT INTO daily_prices(security_id,session_date,symbol,open,close,source)
      VALUES($1,$2,$3,.125,.375,'Verified browser fixture')`,
      [alpha.id, officialDate, alpha.symbol],
    );
    await transaction(async (db) => {
      await rebuildStandings(officialYear, officialDate, db);
      await db.query("UPDATE seasons SET published_date=$2,last_updated_at=now() WHERE year=$1", [
        officialYear,
        officialDate,
      ]);
    });
    await page.goto(`/competitions/${officialYear}/leaderboard`);
    await expect(page.getByRole("columnheader", { name: "Start price" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Last close" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$0.125", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "$0.375", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "+200.00%", exact: true })).toBeVisible();
    const desktopViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    if (desktopViewport) await page.setViewportSize(desktopViewport);
    await page.getByRole("link", { name: alpha.symbol, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Closing price history" })).toBeVisible();

    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL("http://localhost:3100/");
    await page.goto("/join?mode=sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "My profile", exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await pool.end();
  }
});
