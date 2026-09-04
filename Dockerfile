# Dockerfile — Auto Trader (multi-stage, prune dev deps) — Fase 9.1.4
# Stage 1: deps
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json bun.lock ./
RUN npm ci

# Stage 2: builder
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: runner (pruned, production)
FROM node:20-slim AS runner
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