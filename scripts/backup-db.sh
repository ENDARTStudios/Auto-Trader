#!/usr/bin/env bash
# scripts/backup-db.sh — SQLite backup (S06)
set -euo pipefail
DB="${DATABASE_URL:-file:./prisma/dev.db}"
# Extract path from file:./prisma/dev.db or prisma/dev.db
DB_PATH=$(echo "$DB" | sed 's|file:||' | cut -d'?' -f1)
if [ ! -f "$DB_PATH" ]; then
  echo "DB not found at $DB_PATH" >&2
  exit 1
fi
mkdir -p backup
OUT="backup/backup-$(date +%F-%H%M%S).sql"
echo "Backing up $DB_PATH -> $OUT"
sqlite3 "$DB_PATH" .dump > "$OUT"
ls -lh "$OUT"
echo "Backup done"
