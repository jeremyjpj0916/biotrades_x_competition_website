#!/bin/sh
set -eu

image=biotrades-mailer:test
mailer=biotrades-mailer-$$
submission=$mailer-submission
other=$mailer-other
domain=biotrades.example.test

cleanup() {
    status=$?
    if [ "$status" != 0 ]; then docker logs "$mailer" >&2 || true; fi
    docker rm -fv "$mailer" >/dev/null 2>&1 || true
    docker network rm "$submission" "$other" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -t "$image" docker/mail
docker pull python:3.13-alpine
docker network create --internal --subnet 172.31.95.0/28 "$submission"
docker network create --internal "$other"
docker run -d --name "$mailer" --network "$submission" -e MAIL_DOMAIN="$domain" "$image"
docker network connect "$other" "$mailer"

for attempt in $(seq 1 30); do
    health=$(docker inspect --format '{{.State.Health.Status}}' "$mailer")
    if [ "$health" = healthy ]; then break; fi
    sleep 1
done
test "$health" = healthy
test -z "$(docker exec "$mailer" postconf -h relayhost)"
test "$(docker exec "$mailer" postconf -h smtp_tls_security_level)" = encrypt

# Keep messages in the queue so the test can inspect the signed payload.
docker exec "$mailer" postconf -e 'defer_transports = smtp'
docker exec "$mailer" postfix reload

docker run --rm -i --network "$submission" python:3.13-alpine python - "$mailer" "$domain" <<'PY'
import smtplib
import sys
from email.message import EmailMessage

host, domain = sys.argv[1:]
with smtplib.SMTP(host, 25, timeout=10) as smtp:
    smtp.ehlo()
    smtp.mail(f"spoofed@{domain}")
    assert smtp.rcpt("test@example.test")[0] >= 500, "unauthorized sender was accepted"
    smtp.rset()
    message = EmailMessage()
    message["From"] = f"BioTrades X <no-reply@{domain}>"
    message["To"] = "test@example.test"
    message["Subject"] = "Direct mail test"
    message.set_content("Queued account message fixture.")
    assert smtp.send_message(message) == {}
PY

docker run --rm -i --network "$other" python:3.13-alpine python - "$mailer" "$domain" <<'PY'
import smtplib
import sys

host, domain = sys.argv[1:]
try:
    with smtplib.SMTP(host, 25, timeout=10) as smtp:
        smtp.sendmail(f"no-reply@{domain}", "test@example.test", "Subject: Private relay test\n\nFixture")
except smtplib.SMTPRecipientsRefused as error:
    assert error.recipients["test@example.test"][0] >= 500, error
except smtplib.SMTPResponseException as error:
    assert error.smtp_code >= 500, error
else:
    raise AssertionError("SMTP relay accepted a client outside the submission network")
PY

queue=$(docker exec "$mailer" postqueue -j)
queue_id=$(printf '%s' "$queue" | python3 -c 'import json, sys; print(json.load(sys.stdin)["queue_id"])')
message=$(docker exec "$mailer" postcat -q "$queue_id")
printf '%s\n' "$message" | grep -F 'DKIM-Signature:'
printf '%s\n' "$message" | grep -F "d=$domain;"
printf '%s\n' "$message" | grep -F 'Queued account message fixture.'
