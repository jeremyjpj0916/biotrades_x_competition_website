# BioTrades X

An annual stock-picking competition for the BioTrades Discord and X communities. Participants choose one eligible biotech or pharmaceutical stock and follow the season on the public leaderboard. The inaugural season is 2027, with registration opening December 1, 2026 Eastern Time.

## Run locally

Use Node.js 24 and PostgreSQL 16 or 17. A default installation starts with real season dates and an empty leaderboard.

```sh
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

Open [localhost:3000](http://localhost:3000). Set `DATABASE_URL` to your PostgreSQL instance before migrating. Run `npm run worker` in a second process to refresh the calendar and process market jobs. Set `SEC_CONTACT` and run `npm run db:seed -- --reference` to populate the full reference catalog for ticker search. Development email links appear in the dev server log when SMTP is unset.

For Docker Compose, copy `.env.example` to `.env`, set `BETTER_AUTH_SECRET` using `openssl rand -hex 32`, and run `docker compose up --build -d`. PostgreSQL, the web app, the worker, schema initialization, and backups run on the same host. Turnstile uses its published test keys on Node development loopback. The Docker web image runs in production mode and requires your own Turnstile keys for registration and sign-in.

## Operating costs

The default scoring feed is keyless and free to fetch. Public pages publish derived returns, typically about two days after the session. A PostgreSQL-backed request budget and shared cache keep provider traffic independent of participant count. A small, always-on machine can run the site, worker, database and outbound mail together. Direct mail uses Postfix on your own host and requires a domain, suitable DNS records, and outbound TCP port 25. [Market data and licensing](docs/MARKET_DATA.md) · [Direct outbound email](docs/OPERATIONS.md#direct-outbound-email)

## Documentation

- [Architecture and database](docs/ARCHITECTURE.md)
- [Deployment, operations and restoration](docs/OPERATIONS.md)
- [HTTP API](docs/API.md)
- [Implementation checklist](docs/IMPLEMENTATION.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

The application is distributed under the [Apache 2.0 license](LICENSE).
