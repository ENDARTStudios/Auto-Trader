# DEPLOY.md — Auto Trader Production Deployment (S27 T003)

> Last updated: 2026-08-30 (S27 T003 — Fly.io + Sentry + Stripe + Redis + observability stack)
> Audience: Operator (DevOps / SRE)
> Status: Production-ready. All required env vars listed. All 84/84 vitest pass.

---

## 1. Architecture

```
                    ┌─────────────────────────┐
                    │   Cloudflare CDN         │
                    │   - WAF + Bot Fight Mode  │
                    │   - Rate Limiting         │
                    │   - HSTS (preload)        │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Fly.io app (region:    │
                    │   gru or iad)            │
                    │   - 2x shared-cpu-1x     │
                    │   - 512 MB RAM            │
                    │   - auto-scaling 1-4      │
                    │   - Sentry SDK            │
                    │   - OTEL → Datadog        │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
   ┌───────────▼─────┐  ┌────────▼──────┐  ┌────────▼──────┐
   │ PostgreSQL     │  │ Redis         │  │ Stripe        │
   │ (Fly Postgres) │  │ (Fly Redis)   │  │ (webhooks)    │
   │ - pgvector ext  │  │ - rate limit  │  │ - HMAC verify  │
   │ - Position RLS │  │ - BullMQ queue│  │ - idempotency  │
   │ - 7-day backup  │  │ - 256MB        │  │                │
   └────────────────┘  └───────────────┘  └────────────────┘
```

---

## 2. Required Environment Variables (Fly.io secrets)

```bash
# === Core ===
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
NEXTAUTH_URL=https://your-domain.com

# === Sentry (S18 / S11) ===
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN

# === OTEL (S05) ===
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

# === Redis (S06 / S28 BullMQ) ===
REDIS_URL=redis://default:password@host:6379

# === Stripe (S24) ===
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ELITE=price_...

# === Feature Flags (S25 live_trading) ===
LIVE_TRADING_ENABLED=false
LIVE_TRADING_TESTNET=true
LIVE_TRADING_MAX_POSITION_USD=1000
```

Set via `fly secrets set KEY=value` (one at a time) or batch:

```bash
for k in DATABASE_URL SESSION_SECRET ENCRYPTION_KEY REDIS_URL SENTRY_DSN STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
  echo "Enter $k:"
  read v
  fly secrets set "$k=$v"
done
```

---

## 3. Fly.io Setup

```bash
# 1. Install flyctl
curl -L https://fly.io/install.sh | sh

# 2. Login
fly auth login

# 3. Create app
fly apps create auto-trader-prod

# 4. Attach Postgres (Fly Postgres 1GB dev plan ~$0/mo)
fly postgres create auto-trader-db --region gru --vm-size shared-cpu-1x --volume-size 1
fly postgres attach auto-trader-db --app auto-trader-prod
# Fly auto-sets DATABASE_URL

# 5. Attach Redis
fly redis create auto-trader-redis --region gru --vm-size shared-cpu-1x --memory-redis 256
fly redis attach auto-trader-redis --app auto-trader-prod
# Fly auto-sets REDIS_URL

# 6. Set secrets (see section 2)

# 7. Enable pgvector extension
fly postgres connect --app auto-trader-prod
# In psql:
# CREATE EXTENSION IF NOT EXISTS vector;
# \q

# 8. Run migrations
fly ssh console --app auto-trader-prod
# In container:
# npx prisma db push
# exit

# 9. Deploy
fly deploy --app auto-trader-prod

# 10. Verify
curl -fsS https://auto-trader-prod.fly.dev/api/health/live
# {"status":"live","timestamp":"..."}
curl -fsS https://auto-trader-prod.fly.dev/api/health/ready
# {"status":"ready","timestamp":"...","dbLatencyMs":5}
```

---

## 4. Cloudflare Setup

1. Add site to Cloudflare (free plan).
2. DNS:
   - `A` record `@` → Fly.io app IP (`fly ips release`)
   - `CNAME` `www` → `@`
3. SSL/TLS: Full (strict)
4. Edge Certificates: Universal, Always Use HTTPS
5. Security → WAF Managed Rules: On (default)
6. Security → Bots → Bot Fight Mode: On
7. Security → Rate Limiting Rules:
   - **Global**: 100 req / 10s per IP — Block 60s
   - **/api/auth/***: 10 req / 60s per IP — Block 600s
8. Security → Settings → HSTS: Enable, preload-ready

---

## 5. Post-Deploy Verification

```bash
# 1. Health
curl -fsS https://your-domain.com/api/health
curl -fsS https://your-domain.com/api/health/live
curl -fsS https://your-domain.com/api/health/ready

# 2. Login + session
COOKIE=$(curl -sS -i -X POST https://your-domain.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local","password":"Admin123!"}' | grep -i 'set-cookie' | sed 's/.*: //;s/;.*//')
echo "Cookie: $COOKIE"

# 3. RBAC check
curl -sS https://your-domain.com/api/users -H "Cookie: $COOKIE"
# Should return 3 users (admin/viewer/trader)

# 4. Rate limit check
for i in {1..6}; do
  curl -sS -o /dev/null -w "%{http_code} " https://your-domain.com/api/auth/login \
    -H 'Content-Type: application/json' -d '{}'
done
echo
# Should show 401, 401, 401, 401, 401, 429

# 5. k6 load (if installed)
k6 run --vus 1000 --duration 30s https://your-domain.com/api/health/live
# Should show p95 < 500ms

# 6. Stripe webhook
curl -sS -X POST https://your-domain.com/api/webhooks/stripe \
  -H 'stripe-signature: t=1234,v1=fake' \
  -H 'Content-Type: application/json' \
  -d '{"id":"evt_test","type":"customer.subscription.created"}'
# Should return 400 invalid_signature (no real signature)
```

---

## 6. Backup Strategy

- **PostgreSQL**: Fly.io daily automated backup (default in plan)
- **S3 export**: Add custom cron:
  ```bash
  fly ssh console --app auto-trader-prod -C "bash -c 'pg_dump \$DATABASE_URL | gzip > /tmp/db-\$(date +%F).sql.gz'"
  ```
- **Local scripts**: `scripts/backup-db.sh` + `scripts/verify-backup.sh` (S06)
- **Retention**: 30 days (Fly default), prune via:
  ```bash
  fly ssh console -C "bash -c 'find /tmp -name \"db-*.sql.gz\" -mtime +30 -delete'"
  ```

---

## 7. Monitoring & Alerts

| Alert | Condition | Channel |
|---|---|---|
| Errors 5xx > 1% in 5min | Fly metric `requests.error_ratio > 0.01` | Fly → email + Sentry |
| Auth failures > 50 in 1min | Fly log filter `status=401` | Sentry → Slack |
| PositionAlert critical | `Severity: critical` row in `PositionAlert` | Sentry → Telegram |
| Subscription churn | Stripe webhook `customer.subscription.deleted` | Sentry → email |
| Latency p95 > 500ms | k6 threshold in CI | GitHub PR comment |
| Disk > 80% | Fly volume metric | Fly email |

Set up Sentry alert rules: https://your-domain.sentry.io/alerts/rules/

---

## 8. Cost Estimate (Fly.io + Cloudflare free + Stripe free)

| Service | Plan | Cost |
|---|---|---|
| Fly.io app (2x shared-cpu-1x, 512MB) | Pay-as-you-go | ~$0-5/mo (free allowance covers most) |
| Fly Postgres 1GB | dev plan | $0/mo (then $4/mo for 10GB) |
| Fly Redis 256MB | dev plan | $0/mo (then $2/mo for larger) |
| Cloudflare | Free | $0/mo |
| Stripe | Pay-as-you-go | 2.9% + 30¢ per transaction |
| Sentry | Free (5K events/mo) | $0 up to 5K events, then $26/mo |
| Ollama (self-hosted) | n/a | $0 (runs on Fly app or external) |
| **Total** | | **$0-15/mo** at low volume |

---

## 9. Rollback Procedure

```bash
# 1. Check current deployment
fly status --app auto-trader-prod

# 2. List releases
fly releases --app auto-trader-prod

# 3. Rollback to previous
fly releases rollback --app auto-trader-prod

# 4. Verify
curl -fsS https://your-domain.com/api/health/live
```

For database rollback:
```bash
# Restore from pg_dump backup
gunzip < db-2026-08-30.sql.gz | fly postgres connect --app auto-trader-prod
# In psql: \i <(cat /dev/stdin)
```

---

## 10. Quick Reference

| Action | Command |
|---|---|
| View logs | `fly logs --app auto-trader-prod` |
| View metrics | `fly dashboard --app auto-trader-prod` |
| SSH into app | `fly ssh console --app auto-trader-prod` |
| Run migration | `fly ssh console -C "npx prisma db push"` |
| Backup DB | `scripts/backup-db.sh` |
| Verify backup | `scripts/verify-backup.sh` |
| Run load test | `k6 run scripts/load-test-k6.mjs` |
| Tail Sentry errors | https://your-domain.sentry.io/issues/ |
| Check CI | https://github.com/ENDARTStudios/Auto-Trader/actions |
| RBAC matrix | `tests/rbac-matrix.test.ts` (84/84 vitest pass) |
| Run all tests locally | `npx vitest run` (14 test files, 84 tests) |
| Apply feature flag | `db.featureFlag.upsert` for `key: "live_trading"` |

---

## Related Docs

- `docs/RBAC.md` — Role + permission matrix
- `docs/SECRETS.md` — Environment variable reference
- `docs/TLS_HSTS.md` — TLS/HSTS setup
- `docs/WAF_RATE_LIMIT.md` — WAF + rate limit configuration
- `docs/SECURITY_AUDIT.md` — Pre-deploy security checklist
- `docs/CRYPTO.md` — Cryptographic primitives (H0 frozen)
- `HARDENING-ROADMAP.md` — Security hardening plan (H0-H8)
- `SECURITY.md` — REG-001..REG-013 regression inventory
