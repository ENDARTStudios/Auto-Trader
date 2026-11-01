#!/bin/sh
# pg_dump diário com rotação de 7 dias — roda como serviço always-on no Railway.
# Variáveis: DATABASE_URL (referência ao service Postgres), BACKUP_DIR, RETENTION_DAYS.
set -u
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
INTERVAL="${BACKUP_INTERVAL_SEC:-86400}"
mkdir -p "$BACKUP_DIR"

log() { echo "[backup] $(date -u +%F_%T) $*"; }

log "serviço de backup iniciado (intervalo ${INTERVAL}s, retenção ${RETENTION_DAYS}d)"
while true; do
  FILE="$BACKUP_DIR/autotrader-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump --format=custom --file="$FILE" "$DATABASE_URL"; then
    SIZE=$(du -h "$FILE" | cut -f1)
    log "dump OK: $FILE ($SIZE)"
  else
    log "ERRO: pg_dump falhou (exit $?)"
    rm -f "$FILE"
  fi
  # rotação
  find "$BACKUP_DIR" -name "autotrader-*.dump" -mtime "+$RETENTION_DAYS" -delete 2>/dev/null
  log "backups retidos: $(ls "$BACKUP_DIR" 2>/dev/null | wc -l)"
  sleep "$INTERVAL"
done
