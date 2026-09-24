# Dockerfile — Auto Trader (multi-stage, prune dev deps) — Fase 9.1.4
# Stage 1: deps
FROM node:20-slim AS deps
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
FROM node:20-slim AS builder
# T072: same npm pin as deps stage (each FROM starts fresh).
RUN npm install -g npm@11.20.0 --no-audit --no-fund
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: runner (pruned, production)
FROM node:20-slim AS runner
# T072: same npm pin (runner uses npm prune + npm start).
RUN npm install -g npm@11.20.0 --no-audit --no-fund
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
CMD ["npm", "start"]