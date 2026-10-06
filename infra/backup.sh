#!/usr/bin/env sh
# Nightly logical backup of the ArenaOS database, checked and pruned. Cron example (02:30 UTC):
#   30 2 * * * BACKUP_DATABASE_URL=... BACKUP_COPY_CMD='aws s3 cp' /srv/arena/infra/backup.sh >> /var/log/arena-backup.log 2>&1
#
# BACKUP_DATABASE_URL  a superuser (or BYPASSRLS) connection: tenant tables are FORCE ROW LEVEL SECURITY,
#                      so any other role would dump nothing (pg_dump refuses rather than dump partial data).
# BACKUP_DIR           where dumps go (default /var/backups/arena)
# BACKUP_KEEP_DAYS     local retention (default 14)
# BACKUP_COPY_CMD      optional: run as `$BACKUP_COPY_CMD <file> <BACKUP_COPY_TO>/<name>` to copy it off the server
# BACKUP_COPY_TO       destination for the copy, e.g. s3://my-bucket/arena
#
# A dump loses up to a day of data. Point-in-time recovery (WAL archiving) is the real safety net:
# see docs/23-production.md.
set -eu
: "${BACKUP_DATABASE_URL:?set BACKUP_DATABASE_URL}"
dir="${BACKUP_DIR:-/var/backups/arena}"
keep="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$dir"

name="arena-$(date -u +%Y%m%dT%H%M%SZ).dump"
tmp="$dir/.$name.partial"
trap 'rm -f "$tmp"' EXIT

# Custom format keeps owners and grants (the definer functions must stay owned by arena_definer).
pg_dump --format=custom --dbname="$BACKUP_DATABASE_URL" --file="$tmp"
# A dump that can't be listed can't be restored: fail loudly instead of keeping it.
tables=$(pg_restore --list "$tmp" | grep -c " TABLE public " || true)
[ "$tables" -gt 0 ] || { echo "backup check failed: no tables in $name" >&2; exit 1; }
mv "$tmp" "$dir/$name"
echo "$(date -u +%FT%TZ) backup ok: $dir/$name ($tables tables, $(du -h "$dir/$name" | cut -f1))"

if [ -n "${BACKUP_COPY_CMD:-}" ]; then
  : "${BACKUP_COPY_TO:?set BACKUP_COPY_TO with BACKUP_COPY_CMD}"
  $BACKUP_COPY_CMD "$dir/$name" "${BACKUP_COPY_TO%/}/$name"
  echo "copied to ${BACKUP_COPY_TO%/}/$name"
fi

find "$dir" -name 'arena-*.dump' -mtime +"$keep" -exec rm -f {} +
