#!/usr/bin/env bash
# scripts/verify-backup.sh — verify latest backup restores
set -euo pipefail
LATEST=$(ls -t backup/*.sql 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
  echo "No backup found in backup/" >&2
  exit 1
fi
echo "Verifying $LATEST"
TMP=$(mktemp -d)
sqlite3 "$TMP/verify.db" < "$LATEST"
echo "Tables:"
sqlite3 "$TMP/verify.db" "SELECT name FROM sqlite_master WHERE type='table';"
echo "Counts:"
sqlite3 "$TMP/verify.db" "SELECT 'User', count(*) FROM User UNION ALL SELECT 'Position', count(*) FROM Position UNION ALL SELECT 'FeatureFlag', count(*) FROM FeatureFlag;"
rm -rf "$TMP"
echo "Verify OK"
