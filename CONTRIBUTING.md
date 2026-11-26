# Contributing

Use Node.js 24 and PostgreSQL. Run `npm ci`, initialize a development database, and follow the setup in [README.md](README.md).

Run `npm run format`, `npm run typecheck`, `npm test`, and `npm run build`. To run the lifecycle integration test, point `TEST_DATABASE_URL` at a disposable migrated database. Browser tests require `npx playwright install chromium` and a seeded, disposable database in `DATABASE_URL`. Keep live credentials and fictional test data out of production deployments.

Add a new SQL migration for deployed schema changes. Preserve prior seasons' rules and source terms. Verify the scoring policy and price provenance when changing market-data ingestion.

Submit changes via pull request under the existing Apache 2.0 license.
