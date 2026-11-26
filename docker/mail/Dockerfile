FROM debian:bookworm-slim
RUN set -eux; \
    apt-get update; \
    printf '%s\n' 'postfix postfix/main_mailer_type select Internet Site' \
      'postfix postfix/mailname string localhost.localdomain' | debconf-set-selections; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates postfix opendkim opendkim-tools; \
    rm -rf /var/lib/apt/lists/*
COPY start.sh /usr/local/bin/biotrades-mail
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD postfix status >/dev/null 2>&1 && kill -0 "$(cat /run/opendkim/opendkim.pid)"
ENTRYPOINT ["/usr/local/bin/biotrades-mail"]
