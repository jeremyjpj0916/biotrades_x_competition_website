# Operations

## Launch

Use a pre-existing always-on host or a server that can sustain PostgreSQL, a web process, and the background worker. The Compose HTTPS profile uses Caddy for certificate provisioning. Set `SITE_ADDRESS` to your DNS name and `APP_URL` to the matching HTTPS URL. Route ports 80 and 443 to that host. Caddy overwrites the forwarding IP header. When using a different ingress, supply one trusted client address in `X-Forwarded-For` and keep direct web access private.

Set strong unique secrets in `.env`. `CONTAINER_DATABASE_URL` must match `POSTGRES_PASSWORD`. Generate `BETTER_AUTH_SECRET` with `openssl rand -hex 32`. Store `.env` with restricted permissions and outside backup shares.

- Create a free Cloudflare Turnstile widget scoped to your public hostname and set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`. Email registration, sign-in, OAuth initiation, and recovery require a valid challenge. [Cloudflare setup](https://developers.cloudflare.com/turnstile/get-started/)
- Set up [direct outbound email](#direct-outbound-email) for verification, recovery, deletion and eligibility notices. Verify an actual receipt before announcing the site.
- Set `ADMIN_EMAILS` to the comma-separated verified addresses of administrators. The admin page uses email verification and server-side authorization.
- Set `SEC_CONTACT` to an address you monitor. After first boot run `docker compose run --rm worker npm run db:seed -- --reference` to warm the listing catalog. A first import can take tens of minutes with conservative SEC pacing.
- Set Discord and X OAuth keys only for providers you plan to offer. Register callbacks `APP_URL/api/auth/callback/discord` and `APP_URL/api/auth/callback/twitter`. Discord and X community URLs and the Discord webhook are optional.

Check `/api/ready` and the admin dashboard. The worker creates future seasons from exchange calendars. It arms daily jobs when a session's data should be ready, shares a provider budget, and recovers unfinished work on restart. Under constrained API budgets a large universe can take hours. Old gaps or unverified actions appear in the admin review list. Validate any alerts through your operational monitoring system.

## Direct outbound email

The Compose mail service runs Postfix and OpenDKIM on the same host as the site. The web process and worker submit through a private Docker network. Postfix queues messages, signs them with the site's domain key, and connects directly to the recipient's mail server over SMTP with STARTTLS. Queued mail and DKIM keys persist in named Docker volumes. The mail service has no published port. You can leave your existing inbound MX records in place.

1. Use a host with a stable public IPv4 address, outbound TCP port 25, and control of its reverse DNS. Set `MAIL_DOMAIN=example.org` and `MAIL_HOSTNAME=mail.example.org` in `.env` using your domain and mail hostname. The site sends from `no-reply@example.org` in this example.
2. Point the mail hostname's `A` record to the sending IP and have the IP operator point its reverse `PTR` record back to that hostname. Authorize that address in your domain's existing SPF record. If this is the only sender, an example SPF value is `v=spf1 ip4:203.0.113.10 -all`. Publish a DMARC TXT record at `_dmarc.example.org`. An initial monitoring policy such as `v=DMARC1; p=none` can be used to confirm alignment before setting an enforcement policy. [Gmail sender guidelines](https://support.google.com/mail/answer/81126?hl=en-GB)
3. Start the site and mail service, then read the generated public DKIM record. Publish its TXT value under `biotrades._domainkey.example.org`. If you set `MAIL_DKIM_SELECTOR`, replace `biotrades` in both the file path and record name.

```sh
docker compose -f compose.yaml -f compose.mail.yaml --profile https up --build -d
docker compose -f compose.yaml -f compose.mail.yaml exec mailer \
  cat /var/lib/biotrades-dkim/example.org/biotrades.txt
```

4. After DNS propagates, register and request a password reset using an outside mailbox you control. Confirm both messages arrive and check the received headers for SPF, DKIM, and DMARC results. Check `docker compose -f compose.yaml -f compose.mail.yaml logs mailer` and `docker compose -f compose.yaml -f compose.mail.yaml exec mailer postqueue -p` for deferred deliveries. Postfix retries temporary failures, including recipient servers where the required STARTTLS connection is unavailable. Restrict access to the queue and the DKIM key volume.

If you already operate an SMTP server, set `SMTP_URL` and `MAIL_FROM` in `.env` and start the base stack with `docker compose --profile https up --build -d`. Use `docker compose logs -f worker` to inspect worker activity, including reference imports and market refreshes. Include `-f compose.yaml -f compose.mail.yaml` in Compose commands when using the bundled mail service.

## Administration

The admin dashboard supports profile suspension, listing eligibility overrides, open reviews, action evidence, retries and corrections. Record source evidence in every corporate-action change. Supply successor IDs and confirmed ratios for stock and mixed acquisitions. A missing date must be verified, imported, or resolved by an appropriate corporate action. For a finalized season, apply the correction to its inputs, then publish a separate audited revision. Earlier revision payloads and trophy awards remain stored.

## Backups

The backup service writes a custom-format PostgreSQL dump and checks the table of contents before making it available. It retains 14 days of local backups. Use a host path with restrictive permissions, copy encrypted backups off the host, and monitor backup age. For a recovery drill, restore to a new isolated database using `pg_restore --exit-on-error`, run migrations, and verify the archive and account totals before switching the application. Keep the previous database available until the switch is verified.
