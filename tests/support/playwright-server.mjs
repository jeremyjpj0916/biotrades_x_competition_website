import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { openTestMailbox } from "./mailbox.mjs";

const repository = fileURLToPath(new URL("../..", import.meta.url));
nextEnv.loadEnvConfig(repository, true);
const database = process.env.PLAYWRIGHT_DATABASE_URL || process.env.DATABASE_URL;
if (!database) throw new Error("Point browser tests at a migrated, disposable database.");

const dist = ".next-e2e";
const env = {
  ...process.env,
  DATABASE_URL: database,
  APP_URL: "http://localhost:3100",
  BETTER_AUTH_SECRET: "disposable-browser-test-secret-for-localhost",
  SMTP_URL: "smtp://127.0.0.1:3102/?ignoreTLS=true",
  MAIL_FROM: "BioTrades X <sender@example.test>",
  TURNSTILE_SITE_KEY: "browser-fixture-site-key",
  TURNSTILE_SECRET_KEY: "browser-fixture-siteverify-secret",
  NEXT_DIST_DIR: dist,
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_ENV: "production",
};
const build = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  cwd: repository,
  env,
  stdio: "inherit",
});
const [buildStatus] = await once(build, "exit");
if (buildStatus !== 0) process.exit(buildStatus || 1);

const output = join(repository, dist);
const standalone = join(output, "standalone");
await mkdir(join(standalone, dist), { recursive: true });
await Promise.all([
  cp(join(output, "static"), join(standalone, dist, "static"), { recursive: true }),
  cp(join(repository, "public"), join(standalone, "public"), { recursive: true }),
]);
const closeMailbox = await openTestMailbox();
const server = spawn(process.execPath, [join(standalone, "server.js")], {
  cwd: standalone,
  env: {
    ...env,
    HOSTNAME: "127.0.0.1",
    PORT: "3100",
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--import="${new URL("./siteverify.mjs", import.meta.url).href}"`,
    ]
      .filter(Boolean)
      .join(" "),
  },
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.kill(signal));
server.on("error", (error) => {
  console.error(error);
  closeMailbox();
  process.exitCode = 1;
});
server.on("exit", (code) => {
  closeMailbox();
  process.exitCode = code ?? 0;
});
