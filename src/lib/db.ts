import pg, { type PoolClient, type QueryResultRow } from "pg";

const runtime = globalThis as typeof globalThis & { competitionPool?: pg.Pool };
export const pool =
  runtime.competitionPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
  });
runtime.competitionPool = pool;
pool.on("error", (error) => console.error("PostgreSQL idle connection", error.message));

export type Database = Pick<PoolClient, "query">;
export async function query<Row extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  db: Database = pool,
) {
  return (await db.query<Row>(sql, values)).rows;
}
export async function one<Row extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  db: Database = pool,
) {
  return (await query<Row>(sql, values, db))[0];
}
export async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
