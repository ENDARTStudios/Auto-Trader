#!/bin/sh
# docker-entrypoint.sh — Railway: o volume /data é montado root:root; o
# servidor roda como `node` (T074 non-root). O entrypoint ajusta o dono do
# volume e desce privilégios antes do exec (setpriv = util-linux, presente
# no Debian slim). Sem /data (desenvolvimento), só executa direto.
set -e

if [ -d /data ]; then
  chown -R node:node /data 2>/dev/null || true
fi

if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
  exec setpriv --reuid=node --regid=node --clear-groups "$@"
fi

exec "$@"
