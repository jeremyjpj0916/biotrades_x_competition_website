import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { getSeason, refreshCalendars } = await import("../src/lib/calendar");
const { ensureBenchmarks, refreshSecurities } = await import("../src/lib/securities");
const { pool } = await import("../src/lib/db");
const { firstYear } = await import("../src/lib/config");

async function seed() {
  try {
    await refreshCalendars();
  } catch (error) {
    if (!(await getSeason(firstYear))) throw error;
    console.warn(
      "The bundled or previously verified season calendar is available. Calendar refresh will retry.",
    );
  }
  await ensureBenchmarks();
  if (process.argv.includes("--reference")) await refreshSecurities(true);
}
seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
