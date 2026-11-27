#!/bin/sh
set -eu
umask 077
while :; do
  timestamp=$(date -u +%Y-%m-%dT%H%M%SZ)
  archive="/backups/biotrades-${timestamp}.dump"
  if pg_dump --format=custom --file="${archive}.tmp" && pg_restore --list "${archive}.tmp" >/dev/null; then
    mv "${archive}.tmp" "$archive"
    find /backups -type f -name 'biotrades-*.dump' -mtime +14 -delete
    printf '%s\n' "PostgreSQL backup verified: $timestamp"
    sleep 86400
  else
    rm -f "${archive}.tmp"
    printf '%s\n' "PostgreSQL backup failed: $timestamp" >&2
    sleep 900
  fi
done
