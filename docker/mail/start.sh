#!/bin/sh
set -eu

domain=${MAIL_DOMAIN:?Set MAIL_DOMAIN}
hostname=${MAIL_HOSTNAME:-mail.$domain}
selector=${MAIL_DKIM_SELECTOR:-biotrades}
subnet=${MAIL_SUBMISSION_SUBNET:-172.31.95.0/28}

for name in "$domain" "$hostname"; do
    if ! printf '%s\n' "$name" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'; then
        printf 'Use a lowercase fully qualified domain or host name.\n' >&2
        exit 1
    fi
done
case "$selector" in
    ''|*[!a-z0-9-]*) printf 'Use a simple DNS label for MAIL_DKIM_SELECTOR.\n' >&2; exit 1 ;;
esac
if [ "${#selector}" -gt 63 ] || ! printf '%s\n' "$subnet" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}/(2[4-9]|30)$'; then
    printf 'Use a valid selector and a dedicated IPv4 submission subnet (/24 through /30).\n' >&2
    exit 1
fi

key_root="/var/lib/biotrades-dkim"
key_dir="$key_root/$domain"
private_key="$key_dir/$selector.private"
install -d -m 750 -o root -g opendkim "$key_root" "$key_dir"
if [ ! -s "$private_key" ]; then
    (
        umask 077
        scratch=$(mktemp -d "$key_dir/.new-key.XXXXXX")
        trap 'rm -rf "$scratch"' EXIT HUP INT TERM
        opendkim-genkey -b 2048 -s "$selector" -d "$domain" -D "$scratch"
        mv "$scratch/$selector.txt" "$key_dir/$selector.txt"
        mv "$scratch/$selector.private" "$private_key"
    )
fi
chown opendkim:opendkim "$private_key"
chmod 600 "$private_key"
install -d -m 750 -o opendkim -g opendkim /run/opendkim

printf '%s\n' '127.0.0.1' "$subnet" > /etc/opendkim-internal
cat > /etc/opendkim.conf <<CONFIG
Mode s
Canonicalization relaxed/relaxed
Socket inet:8891@127.0.0.1
PidFile /run/opendkim/opendkim.pid
UserID opendkim
InternalHosts /etc/opendkim-internal
OversignHeaders From
Domain $domain
Selector $selector
KeyFile $private_key
CONFIG

printf '%s\n' "$domain" > /etc/mailname
printf 'no-reply@%s OK\n' "$domain" > /etc/postfix/allowed-senders
postmap hash:/etc/postfix/allowed-senders
postconf -e \
    "myhostname = $hostname" \
    "mydomain = $domain" \
    "myorigin = $domain" \
    "mynetworks = 127.0.0.0/8, $subnet" \
    'inet_interfaces = all' \
    'inet_protocols = ipv4' \
    'mydestination =' \
    'relay_domains =' \
    'relayhost =' \
    'smtpd_client_restrictions = permit_mynetworks, reject' \
    'smtpd_relay_restrictions = permit_mynetworks, reject' \
    'smtpd_sender_restrictions = check_sender_access hash:/etc/postfix/allowed-senders, reject' \
    'smtpd_tls_security_level = none' \
    'smtpd_sasl_auth_enable = no' \
    'smtp_tls_security_level = encrypt' \
    'smtp_tls_mandatory_protocols = >=TLSv1.2' \
    'smtp_tls_loglevel = 1' \
    'smtpd_milters = inet:127.0.0.1:8891' \
    'milter_default_action = tempfail' \
    'maillog_file = /dev/stdout'
postconf -M 'postlog/unix-dgram=postlog unix-dgram n - n - 1 postlogd'
postconf -F 'smtp/inet/chroot=n' 'smtp/unix/chroot=n' 'relay/unix/chroot=n'

opendkim -x /etc/opendkim.conf
postfix check
printf 'Outbound mail is configured for %s. Public DKIM record: %s/%s.txt\n' "$domain" "$key_dir" "$selector"
exec postfix start-fg
