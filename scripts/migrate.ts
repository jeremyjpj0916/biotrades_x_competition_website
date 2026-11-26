import nextEnv from "@next/env";
import { readFile, readdir } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
nextEnv.loadEnvConfig(process.cwd());
const { auth } = await import("../src/lib/auth");
const { pool } = await import("../src/lib/db");

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(3130127)");
    const authSchema = await getMigrations(auth.options);
    if (authSchema.toBeCreated.length || authSchema.toBeAdded.length) await authSchema.runMigrations();
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (await readdir("db")).filter((name) => name.endsWith(".sql")).sort()) {
      if ((await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [file])).rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(`db/${file}`, "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(3130127)");
    client.release();
  }
}
migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
