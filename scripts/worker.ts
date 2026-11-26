import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { workOnce } = await import("../src/lib/jobs");
const { pool } = await import("../src/lib/db");
const once = process.argv.includes("--once");
let active = true;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    active = false;
    wake?.();
  });
}
do {
  try {
    await workOnce();
  } catch (error) {
    console.error("Competition worker:", error);
    if (once) process.exitCode = 1;
  }
  if (!once && active)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
} while (!once && active);
await pool.end();
