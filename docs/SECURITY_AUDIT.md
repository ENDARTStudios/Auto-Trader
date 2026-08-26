# Security Audit — Gate de Deploy

> **Versão:** 1.0 — 2026-08-26
> **Princípio:** Nenhum deploy sem passar no gate. Achado crítico/alto bloqueia pipeline.
> **Quando roda:** Pre-commit (gitleaks), CI (SAST, audit, secrets), pre-deploy (DAST, manual review).

---

## 1. Pipeline de Gates

```
  Dev (local)              CI (GitHub Actions)           Pre-deploy (staging)
  ─────────────            ───────────────────           ────────────────────
  • gitleaks pre-commit    • gitleaks CI                 • OWASP ZAP (DAST)
  • eslint + security      • CodeQL (SAST)               • k6 load test
  • npm audit (local)      • npm audit --audit-level=high• Manual /redteam
  • test:ci (637 checks)   • test:ci + coverage 80%      • securityheaders.com A+
                           • Trivy image scan            • Backup restore test
                           • SBOM generation             • Health check
  ─────────────            ───────────────────           ────────────────────
        │                           │                            │
        └──────────►  CI verde? ────┴─────────► Staging verde? ──┘
                                    │                            │
                              não → BLOCK                    não → BLOCK + rollback
                              sim → merge main               sim → promote prod
```

---

## 2. Checklist por Gate

### 2.1 Pre-commit (local, `scripts/git-hooks/pre-commit`)

| Check | Comando | Falha se |
|---|---|---|
| Secrets | `gitleaks detect --source . --no-git -v` | Qualquer segredo (API key, token, private key) |
| Lint security | `npx eslint . --ext .ts,.tsx` com `eslint-plugin-security` | `detect-object-injection`, `detect-non-literal-regexp` |
| Types | `npx tsc --noEmit` | Qualquer erro TS |

### 2.2 CI (`.github/workflows/ci.yml`)

| Check | Comando / Action | Falha se |
|---|---|---|
| Gitleaks CI | `gitleaks/gitleaks-action@v2` | Segredo detectado |
| CodeQL SAST | `github/codeql-action/analyze@v3` (js) | Alert high/critical |
| Dependency audit | `npm audit --audit-level=high` | Vulnerabilidade high/critical |
| Tests | `npm run test:ci` (637 checks) | Qualquer falha |
| Coverage | `npm run test:coverage` → threshold 80% | <80% lines |
| Trivy scan | `aquasecurity/trivy-action@master` | CRITICAL na imagem |
| SBOM | `anchore/sbom-action@v0` | — (artefato) |
| Build | `npm run build` | Erro de build |

### 2.3 Pre-deploy (staging)

| Check | Comando | Falha se |
|---|---|---|
| DAST | `OWASP ZAP baseline scan` contra staging | Alert high |
| Load | `k6 run scripts/k6-load.js` (1k VUs, p95 <500ms) | p95 >500ms ou erro >1% |
| Headers | `curl -I https://staging.example.com` | Falta HSTS/CSP/X-Frame |
| Backup restore | `scripts/restore-db.sh --verify` | Restore falha |
| Health | `curl https://staging.example.com/api/health` | != 200 |

---

## 3. Auditoria Completa — 15 Dimensões

> Critério do enunciado: "Faça uma auditoria completa de segurança, analise: Autenticação, permissões, rotas, banco, inputs, secrets, uploads, webhooks, SQL injection, XSS, SSRF, APIs, criptografias, sessão, IA agent security, autorização, SAST, IaC, Code Owners, security, race condition, configurações perigosas e dependências."

| # | Dimensão | Onde auditar | O que procurar | Severidade se falhar |
|---|---|---|---|---|
| 1 | **Autenticação** | `src/lib/auth/*`, `/api/auth/*` | Weak hash, sem lockout, sem MFA, token em localStorage | 🔴 Crítico |
| 2 | **Autorização / RBAC** | `docs/RBAC.md`, `src/lib/auth/rbac.ts` | Rota sem `requirePermission`, IDOR, privilege escalation | 🔴 Crítico |
| 3 | **Rotas** | `src/app/api/**` | Rota sem validação Zod, sem rate limit, expõe internals | 🟠 Alto |
| 4 | **Banco** | `prisma/schema.prisma` | Sem RLS, sem índice, query sem limite, cascade perigosa | 🟠 Alto |
| 5 | **Inputs** | Todas as rotas POST/PUT | Sem Zod, sem sanitize, XSS via `dangerouslySetInnerHTML` | 🔴 Crítico |
| 6 | **Secrets** | `src/**`, `.env`, logs | Hardcoded key, log com secret, `.env` commitado | 🔴 Crítico |
| 7 | **Uploads** | `/api/upload` (futuro) | Sem MIME check (magic bytes), sem tamanho, sem ClamAV | 🟠 Alto |
| 8 | **Webhooks** | `/api/webhooks/*` | Sem HMAC verify, sem idempotência, sem replay guard | 🟠 Alto |
| 9 | **SQL Injection** | `src/lib/db.ts`, raw queries | String concat em SQL (Prisma já parametriza — verificar raw) | 🔴 Crítico |
| 10 | **XSS** | `src/components/**`, `src/app/**` | `dangerouslySetInnerHTML` sem DOMPurify, URL sem encode | 🟠 Alto |
| 11 | **SSRF** | `src/lib/trading/site-integrity.ts`, `price-feed.ts` | `fetch(userInputUrl)` sem allowlist, sem timeout | 🔴 Crítico |
| 12 | **APIs externas** | `token-selector`, `price-feed`, `goplus` | Sem timeout, sem retry com backoff, sem circuit breaker | 🟡 Médio |
| 13 | **Criptografia** | `wallet-crypto.ts`, `kdf.ts`, `audit-log.ts` | Hardcoded KDF iters, sem zeroize, hash sem salt | 🔴 Crítico |
| 14 | **Sessão** | `src/lib/auth/session.ts` | Cookie sem `httpOnly`/`Secure`/`SameSite`, TTL longo | 🟠 Alto |
| 15 | **IA Agent** | `src/lib/trading/ai-agent.ts` | Prompt injection (user input vira instrução LLM), tool excessivo | 🟠 Alto |
| 16 | **SAST/IaC** | `Dockerfile`, `Caddyfile`, `docker-compose.yml` | `chmod 777`, `FROM` sem pin, secrets em ENV do Dockerfile | 🟡 Médio |
| 17 | **Race condition** | `portfolio.ts`, `engine.ts` (busy guard) | Double-spend, TOCTOU em rebalance, concurrent openPosition | 🟠 Alto |
| 18 | **Configurações perigosas** | `next.config.ts`, `eslint.config.mjs` | `ignoreBuildErrors:true`, `reactStrictMode:false` sem justificativa | 🟡 Médio |
| 19 | **Dependências** | `package.json`, `bun.lock` | `npm audit` high, dep sem lock, postinstall sem review | 🟠 Alto |
| 20 | **CODEOWNERS** | `.github/CODEOWNERS` | Sem owner para `src/lib/chain/**`, `src/signer/**`, `prisma/**` | 🟡 Médio |

---

## 4. Como Executar um Audit

```bash
# 1. Segredos vazados
gitleaks detect --source . -v --redact

# 2. SAST (local, sem GitHub)
npx eslint . --ext .ts,.tsx --format stylish 2>&1 | head -100

# 3. Dependências
npm audit --audit-level=high
# ou melhor:
npx better-npm-audit audit --level high

# 4. SAST CodeQL (local via CLI, ou ver GitHub Security tab)
# https://codeql.github.com/docs/codeql-cli/

# 5. Trivy (imagem)
docker build -t autotrader:scan .
trivy image --severity HIGH,CRITICAL autotrader:scan

# 6. DAST (precisa staging rodando)
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://staging.example.com -r zap-report.html

# 7. Tentar acessar o que não devia (manual — ver §5)
```

---

## 5. Testes de Acesso Indevido (Tente quebrar)

> Critério: "Tente acessar: a conta de outra pessoa, uma rota de admin, um registro que não pertence a ele, uma API sem estar autenticado."

| Teste | Comando | Esperado |
|---|---|---|
| Sem auth → rota protegida | `curl http://localhost:3000/api/positions` | 401 |
| Viewer → rota admin | `curl -H "Cookie: session=<viewer>" -X POST http://localhost:3000/api/kill-switch` | 403 |
| User A → wallet de User B | `curl -H "Cookie: session=<A>" http://localhost:3000/api/wallets/<B-wallet-id>` | 403 ou 404 (RLS) |
| IDOR — trocar ID | `curl -H "Cookie: session=<A>" http://localhost:3000/api/positions/<other-id>` | 403/404 |
| SSRF — site-audit com URL interna | `curl -X POST http://localhost:3000/api/site-audit -d '{"url":"http://169.254.169.254/"}'` | 400 (allowlist) |
| XSS — payload em campo texto | `POST /api/watchlist { "label": "<script>alert(1)</script>" }` → GET e render | Escapado (DOMPurify) |
| SQLi — injeção em query | `GET /api/history?symbol=' OR 1=1 --` | 400 (Zod) ou 0 rows (Prisma param) |

Cada teste acima deve virar um caso no `tests/integration/security.test.ts` e no `e2e/security.spec.ts`.

---

## 6. CODEOWNERS (`.github/CODEOWNERS`)

```
# .github/CODEOWNERS — SPRINT cria
# Cada PR que toca esses paths exige review do owner

/src/lib/chain/        @operator @security-reviewer
/src/signer/           @operator @security-reviewer
/prisma/               @operator @dba-reviewer
/src/lib/trading/wallet-crypto.ts  @operator @security-reviewer
/src/lib/auth/         @operator @security-reviewer
/docs/SECURITY*        @operator
/docs/CRYPTO.md        @operator
/.github/workflows/    @operator
```

---

## 7. Gate de Deploy — Checklist Final

Antes de `git push` para `main` (que auto-deploya staging):

- [ ] `npm run test:ci` verde (637 checks)
- [ ] `npm run test:coverage` ≥80%
- [ ] `gitleaks detect --no-git` limpo
- [ ] `npm audit --audit-level=high` limpo
- [ ] `npx tsc --noEmit` limpo
- [ ] `npm run build` passa
- [ ] Nenhum `TODO` / `FIXME` sem issue linkada
- [ ] `SECURITY.md` atualizado se novo REG
- [ ] `CHANGELOG.md` atualizado

Antes de promover staging → prod:

- [ ] ZAP sem high/critical
- [ ] k6 p95 <500ms
- [ ] securityheaders.com A ou A+
- [ ] Backup restore test passou
- [ ] `MANUAL_DO_OPERADOR.md` reflete mudanças
- [ ] Feature flags revisadas (nenhuma flag de risco ligada sem querer)
