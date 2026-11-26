# BioTrades X implementation checklist

- [x] Foundation: Next.js, PostgreSQL migrations, verified accounts, password visibility, Turnstile, Docker and CI.
- [x] Competition: annual exchange-calendar provisioning, private picks, security validation and database deadline enforcement.
- [x] Scoring: keyless market-data worker, backfills, corporate-action valuation, exact-decimal rankings and revisioned finalization.
- [x] Public site: season overview, leaderboards, stock pages, rules, profiles, archives, analytics, Hall of Fame and CSV.
- [x] Operations: administrative review, retries, audit logs, backups and deployment documentation.
- [x] Verification: deterministic season lifecycle, authentication checks, desktop and mobile development preview, and production build.
- [ ] Public rollout: configure a host, verified outbound email, live Turnstile keys and the SEC contact. Configure OAuth providers and Discord notifications if desired.
- [ ] Optional official-price mode: obtain permission to display and export raw data from your source before switching a future season to official prices.

The free default tracks derived returns from first and last regular-session trades with a roughly two-day delay. Corporate actions with unavailable or ambiguous terms require operator review.
