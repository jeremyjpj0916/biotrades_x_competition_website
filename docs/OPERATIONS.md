# Operations

## Launch

Use a pre-existing always-on host or a server that can sustain PostgreSQL, a web process, and the background worker. The Compose HTTPS profile uses Caddy for certificate provisioning. Set `SITE_ADDRESS` to your DNS name and `APP_URL` to the matching HTTPS URL. Route ports 80 and 443 to that host. Caddy overwrites the forwarding IP header. When using a different ingress, supply one trusted client address in `X-Forwarded-For` and keep direct web access private.

Set strong unique secrets in `.env`. `CONTAINER_DATABASE_URL` must match `POSTGRES_PASSWORD`. Generate `BETTER_AUTH_SECRET` with `openssl rand -hex 32`. Store `.env` with restricted permissions and outside backup shares.

- Create a free Cloudflare Turnstile widget scoped to your public hostname and set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Email registration, sign-in, OAuth initiation, and recovery require a valid challenge. [Cloudflare setup](https://developers.cloudflare.com/turnstile/get-started/)
- Set `SMTP_URL` and `MAIL_FROM` for verification, recovery, deletion and eligibility notices. Verify an actual receipt before announcing the site.
- Set `ADMIN_EMAILS` to the comma-separated verified addresses of administrators. The admin page uses email verification and server-side authorization.
- Set `SEC_CONTACT` to an address you monitor. After first boot run `docker compose run --rm worker npm run db:seed -- --reference` to warm the listing catalog. A first import can take tens of minutes with conservative SEC pacing.
- Set Discord and X OAuth keys only for providers you plan to offer. Register callbacks `APP_URL/api/auth/callback/discord` and `APP_URL/api/auth/callback/twitter`. Discord and X community URLs and the Discord webhook are optional.

```sh
docker compose --profile https up --build -d
docker compose logs -f worker
```

Check `/api/ready` and the admin dashboard. The worker creates future seasons from exchange calendars. It arms daily jobs when a session's data should be ready, shares a provider budget, and recovers unfinished work on restart. Under constrained API budgets a large universe can take hours. Old gaps or unverified actions appear in the admin review list. Validate any alerts through your operational monitoring system.

## Administration

The admin dashboard supports profile suspension, listing eligibility overrides, open reviews, action evidence, retries and corrections. Record source evidence in every corporate-action change. Supply successor IDs and confirmed ratios for stock and mixed acquisitions. A missing date must be verified, imported, or resolved by an appropriate corporate action. For a finalized season, apply the correction to its inputs, then publish a separate audited revision. Earlier revision payloads and trophy awards remain stored.

## Backups

The backup service writes a custom-format PostgreSQL dump and checks the table of contents before making it available. It retains 14 days of local backups. Use a host path with restrictive permissions, copy encrypted backups off the host, and monitor backup age. For a recovery drill, restore to a new isolated database using `pg_restore --exit-on-error`, run migrations, and verify the archive and account totals before switching the application. Keep the previous database available until the switch is verified.
