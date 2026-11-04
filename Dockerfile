# Dockerfile — Auto Trader (multi-stage, prune dev deps) — Fase 9.1.4
# Stage 1: deps
# T079 Phase C2: base pinned by digest (was floating node:20-slim).
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS deps
# T072 S34-Phase C diagnostic: node:20-slim ships npm 10 (tar 6.2.1, CVE
# HIGH/CRITICAL, unfixable in 6.x). Pin npm 11.20.0 (tar 7.5.22). Node runtime
# stays 20; no app dependency changes.
RUN npm install -g npm@11.20.0 --no-audit --no-fund
# node-gyp needs Python for optional native builds (tree-sitter via @nanonets/graft)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json bun.lock ./
# postinstall needs this file present (no-ops without .git)
COPY scripts/install-git-hooks.mjs scripts/
RUN npm ci

# Stage 2: builder
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder
# T072: same npm pin as deps stage (each FROM starts fresh).
RUN npm install -g npm@11.20.0 --no-audit --no-fund
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: runner (pruned, production)
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runner
# T072: same npm pin (runner uses npm prune + npm start).
RUN npm install -g npm@11.20.0 --no-audit --no-fund
# T079 Phase C2: remediate 9 fixable OS CVEs (libcap2×1, libgnutls30×5,
# libpcre2-8-0×3) via targeted base update. Scoped to fixable set only —
# no broad upgrade, no runtime change.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libcap2 libgnutls30 libpcre2-8-0 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/bun.lock ./
RUN npm prune --omit=dev --ignore-scripts && npm cache clean --force
# Round 3 — SIGNER: "npm run build" roda next build + scripts/build-signer.mjs,
# que gera .next/standalone/signer.js E copia para .next/standalone/node_modules
# a closure de runtime (ethers/@prisma/*) que o bundle usa (packages:'external').
# O artefato é self-contained no COPY .next abaixo — não depende de node_modules
# do runner. O supervisor (src/lib/signer-supervisor.ts) só spawna com
# SIGNER_SPAWN=1; desligado por padrão. Socket Unix 0600 em /tmp.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# /tmp precisa ser gravável pelo usuário node: o signer cria
# /tmp/auto-trader-signer-<pid>.sock (chmod 0600 pelo próprio signer) e grava o
# audit log em /tmp/auto-trader-signer-<pid>.audit.jsonl. Recomendado montar
# tmpfs em runtime (ex.: --tmpfs /tmp) para não tocar o rootfs read-only; o
# perfil padrão do /tmp (1777) já permite a escrita do usuário node.
RUN mkdir -p /tmp && chmod 1777 /tmp
EXPOSE 3000
# T080 hardening compensatório: non-root por padrão (node, uid 1000 do base
# image). Arquivos ficam root-owned e legíveis (least privilege — o app não
# escreve em /app); escritas vão para tmpfs em runtime (--tmpfs /tmp).
# Telemetria desativada: evita escrita em /home/node sob rootfs read-only.
ENV NEXT_TELEMETRY_DISABLED=1
# T080: sem isto, docker injeta HOSTNAME=<container-id> e o standalone do Next
# binda só no IP do eth0 (healthcheck intra-container em localhost falha com
# ECONNREFUSED). Bind padrão 0.0.0.0 = comportamento normal de container.
ENV HOSTNAME=0.0.0.0
# Railway: o volume /data é montado root:root e o app precisa escrever o
# SQLite nele. O entrypoint roda como root, chown no /data e DESCE para
# node (setpriv) antes do exec — non-root preservado em runtime (T074/T080).
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
USER node
# T074 (atualizado): `npm start` agora é "node .next/standalone/server.js"
# (sem bun/tee — ver package.json), então start local e container usam o mesmo
# caminho. CMD explícito mantém o contrato do ENTRYPOINT intacto.
CMD ["node", ".next/standalone/server.js"]

# Healthcheck REAL de prontidão: /api/health/ready devolve 200 só quando o
# Postgres responde (503 caso contrário). /api/health/live (200 sem DB) fica
# para liveness — usar readiness aqui evita marcar "healthy" um app que não
# consegue falar com o banco. --start-period cobre o boot do standalone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"