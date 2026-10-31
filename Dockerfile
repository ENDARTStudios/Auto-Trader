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
RUN npm prune --omit=dev && npm cache clean --force
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
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
USER node
# T074: start via node (runtime already validated) instead of `npm start`,
# whose script requires `bun`, absent from this image (pre-existing entrypoint
# bug: `sh: 1: bun: not found`). Docker-scoped only; package.json untouched.
CMD ["node", ".next/standalone/server.js"]