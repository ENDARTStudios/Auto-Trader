

---

## [Conteudo mesclado de SECURITY_AUDIT.md — reorganizacao docs 2026-09-27]

# Security Audit â€” Gate de Deploy

> **VersÃ£o:** 1.0 â€” 2026-08-26
> **PrincÃ­pio:** Nenhum deploy sem passar no gate. Achado crÃ­tico/alto bloqueia pipeline.
> **Quando roda:** Pre-commit (gitleaks), CI (SAST, audit, secrets), pre-deploy (DAST, manual review).

---

## 1. Pipeline de Gates

```
  Dev (local)              CI (GitHub Actions)           Pre-deploy (staging)
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€            â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€           â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  â€¢ gitleaks pre-commit    â€¢ gitleaks CI                 â€¢ OWASP ZAP (DAST)
  â€¢ eslint + security      â€¢ CodeQL (SAST)               â€¢ k6 load test
  â€¢ npm audit (local)      â€¢ npm audit --audit-level=highâ€¢ Manual /redteam
  â€¢ test:ci (637 checks)   â€¢ test:ci + coverage 80%      â€¢ securityheaders.com A+
                           â€¢ Trivy image scan            â€¢ Backup restore test
                           â€¢ SBOM generation             â€¢ Health check
  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€            â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€           â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        â”‚                           â”‚                            â”‚
        â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º  CI verde? â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º Staging verde? â”€â”€â”˜
                                    â”‚                            â”‚
                              nÃ£o â†’ BLOCK                    nÃ£o â†’ BLOCK + rollback
                              sim â†’ merge main               sim â†’ promote prod
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
| Coverage | `npm run test:coverage` â†’ threshold 80% | <80% lines |
| Trivy scan | `aquasecurity/trivy-action@master` | CRITICAL na imagem |
| SBOM | `anchore/sbom-action@v0` | â€” (artefato) |
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

## 3. Auditoria Completa â€” 15 DimensÃµes

> CritÃ©rio do enunciado: "FaÃ§a uma auditoria completa de seguranÃ§a, analise: AutenticaÃ§Ã£o, permissÃµes, rotas, banco, inputs, secrets, uploads, webhooks, SQL injection, XSS, SSRF, APIs, criptografias, sessÃ£o, IA agent security, autorizaÃ§Ã£o, SAST, IaC, Code Owners, security, race condition, configuraÃ§Ãµes perigosas e dependÃªncias."

| # | DimensÃ£o | Onde auditar | O que procurar | Severidade se falhar |
|---|---|---|---|---|
| 1 | **AutenticaÃ§Ã£o** | `src/lib/auth/*`, `/api/auth/*` | Weak hash, sem lockout, sem MFA, token em localStorage | ðŸ”´ CrÃ­tico |
| 2 | **AutorizaÃ§Ã£o / RBAC** | `docs/RBAC.md`, `src/lib/auth/rbac.ts` | Rota sem `requirePermission`, IDOR, privilege escalation | ðŸ”´ CrÃ­tico |
| 3 | **Rotas** | `src/app/api/**` | Rota sem validaÃ§Ã£o Zod, sem rate limit, expÃµe internals | ðŸŸ  Alto |
| 4 | **Banco** | `prisma/schema.prisma` | Sem RLS, sem Ã­ndice, query sem limite, cascade perigosa | ðŸŸ  Alto |
| 5 | **Inputs** | Todas as rotas POST/PUT | Sem Zod, sem sanitize, XSS via `dangerouslySetInnerHTML` | ðŸ”´ CrÃ­tico |
| 6 | **Secrets** | `src/**`, `.env`, logs | Hardcoded key, log com secret, `.env` commitado | ðŸ”´ CrÃ­tico |
| 7 | **Uploads** | `/api/upload` (futuro) | Sem MIME check (magic bytes), sem tamanho, sem ClamAV | ðŸŸ  Alto |
| 8 | **Webhooks** | `/api/webhooks/*` | Sem HMAC verify, sem idempotÃªncia, sem replay guard | ðŸŸ  Alto |
| 9 | **SQL Injection** | `src/lib/db.ts`, raw queries | String concat em SQL (Prisma jÃ¡ parametriza â€” verificar raw) | ðŸ”´ CrÃ­tico |
| 10 | **XSS** | `src/components/**`, `src/app/**` | `dangerouslySetInnerHTML` sem DOMPurify, URL sem encode | ðŸŸ  Alto |
| 11 | **SSRF** | `src/lib/trading/site-integrity.ts`, `price-feed.ts` | `fetch(userInputUrl)` sem allowlist, sem timeout | ðŸ”´ CrÃ­tico |
| 12 | **APIs externas** | `token-selector`, `price-feed`, `goplus` | Sem timeout, sem retry com backoff, sem circuit breaker | ðŸŸ¡ MÃ©dio |
| 13 | **Criptografia** | `wallet-crypto.ts`, `kdf.ts`, `audit-log.ts` | Hardcoded KDF iters, sem zeroize, hash sem salt | ðŸ”´ CrÃ­tico |
| 14 | **SessÃ£o** | `src/lib/auth/session.ts` | Cookie sem `httpOnly`/`Secure`/`SameSite`, TTL longo | ðŸŸ  Alto |
| 15 | **IA Agent** | `src/lib/trading/ai-agent.ts` | Prompt injection (user input vira instruÃ§Ã£o LLM), tool excessivo | ðŸŸ  Alto |
| 16 | **SAST/IaC** | `Dockerfile`, `Caddyfile`, `docker-compose.yml` | `chmod 777`, `FROM` sem pin, secrets em ENV do Dockerfile | ðŸŸ¡ MÃ©dio |
| 17 | **Race condition** | `portfolio.ts`, `engine.ts` (busy guard) | Double-spend, TOCTOU em rebalance, concurrent openPosition | ðŸŸ  Alto |
| 18 | **ConfiguraÃ§Ãµes perigosas** | `next.config.ts`, `eslint.config.mjs` | `ignoreBuildErrors:true`, `reactStrictMode:false` sem justificativa | ðŸŸ¡ MÃ©dio |
| 19 | **DependÃªncias** | `package.json`, `bun.lock` | `npm audit` high, dep sem lock, postinstall sem review | ðŸŸ  Alto |
| 20 | **CODEOWNERS** | `.github/CODEOWNERS` | Sem owner para `src/lib/chain/**`, `src/signer/**`, `prisma/**` | ðŸŸ¡ MÃ©dio |

---

## 4. Como Executar um Audit

```bash
# 1. Segredos vazados
gitleaks detect --source . -v --redact

# 2. SAST (local, sem GitHub)
npx eslint . --ext .ts,.tsx --format stylish 2>&1 | head -100

# 3. DependÃªncias
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

# 7. Tentar acessar o que nÃ£o devia (manual â€” ver Â§5)
```

---

## 5. Testes de Acesso Indevido (Tente quebrar)

> CritÃ©rio: "Tente acessar: a conta de outra pessoa, uma rota de admin, um registro que nÃ£o pertence a ele, uma API sem estar autenticado."

| Teste | Comando | Esperado |
|---|---|---|
| Sem auth â†’ rota protegida | `curl http://localhost:3000/api/positions` | 401 |
| Viewer â†’ rota admin | `curl -H "Cookie: session=<viewer>" -X POST http://localhost:3000/api/kill-switch` | 403 |
| User A â†’ wallet de User B | `curl -H "Cookie: session=<A>" http://localhost:3000/api/wallets/<B-wallet-id>` | 403 ou 404 (RLS) |
| IDOR â€” trocar ID | `curl -H "Cookie: session=<A>" http://localhost:3000/api/positions/<other-id>` | 403/404 |
| SSRF â€” site-audit com URL interna | `curl -X POST http://localhost:3000/api/site-audit -d '{"url":"http://169.254.169.254/"}'` | 400 (allowlist) |
| XSS â€” payload em campo texto | `POST /api/watchlist { "label": "<script>alert(1)</script>" }` â†’ GET e render | Escapado (DOMPurify) |
| SQLi â€” injeÃ§Ã£o em query | `GET /api/history?symbol=' OR 1=1 --` | 400 (Zod) ou 0 rows (Prisma param) |

Cada teste acima deve virar um caso no `tests/integration/security.test.ts` e no `e2e/security.spec.ts`.

---

## 6. CODEOWNERS (`.github/CODEOWNERS`)

```
# .github/CODEOWNERS â€” SPRINT cria
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

## 7. Gate de Deploy â€” Checklist Final

Antes de `git push` para `main` (que auto-deploya staging):

- [ ] `npm run test:ci` verde (637 checks)
- [ ] `npm run test:coverage` â‰¥80%
- [ ] `gitleaks detect --no-git` limpo
- [ ] `npm audit --audit-level=high` limpo
- [ ] `npx tsc --noEmit` limpo
- [ ] `npm run build` passa
- [ ] Nenhum `TODO` / `FIXME` sem issue linkada
- [ ] `SECURITY.md` atualizado se novo REG
- [ ] `CHANGELOG.md` atualizado

Antes de promover staging â†’ prod:

- [ ] ZAP sem high/critical
- [ ] k6 p95 <500ms
- [ ] securityheaders.com A ou A+
- [ ] Backup restore test passou
- [ ] `MANUAL_DO_OPERADOR.md` reflete mudanÃ§as
- [ ] Feature flags revisadas (nenhuma flag de risco ligada sem querer)



---

## [Conteudo mesclado de SECURITY_REVIEW.md — reorganizacao docs 2026-09-27]

# SECURITY_REVIEW â€” Processo de Security Review

> **VersÃ£o:** 1.0 â€” 2026-09-23
> **Fontes:** [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) (auditoria), `SECURITY.md` (REGs de hardening), `HARDENING-ROADMAP.md`.

---

## 1. Camadas automatizadas (CI â€” `ci.yml` + `zap.yml`)

| Camada | Ferramenta | Gate |
|---|---|---|
| Secrets | Gitleaks | Bloqueia merge |
| DependÃªncias | `npm audit --audit-level=high` | Bloqueia em high+ |
| SAST de imagem/FS | Trivy | **Sem** `continue-on-error` (liÃ§Ã£o T054: CVEs mascarados nÃ£o sÃ£o "verde") |
| DAST | OWASP ZAP (`zap.yml`) | Baseline scan em `main` |
| Hardcoded creds em testes | Review manual + `SIGNER_TEST_HOOKS` sÃ³ em CI com env de teste |

## 2. Checklist de review humano (PRs sensÃ­veis)

Para PR que toca **auth, APIs pÃºblicas, signer/vault, config de risco, webhooks/billing**:

- [ ] AutenticaÃ§Ã£o: `requireSession` + `hasPermission` na rota nova/alterada ([RBAC.md](./RBAC.md)).
- [ ] Input: Zod em tudo; sem reflexÃ£o de input em resposta/redirect.
- [ ] RLS: recurso do usuÃ¡rio filtrado por `ownerId` (`rlsWhere`/`assertOwner`) ([RLS.md](./RLS.md)).
- [ ] Segredo: nenhum valor em cÃ³digo/log; env validado em `src/lib/env.ts`.
- [ ] Rate-limit: rota pÃºblica/consome-CPU tem limite ([WAF_RATE_LIMIT.md](./WAF_RATE_LIMIT.md)).
- [ ] Erro: resposta nÃ£o vaza stack/detalhe interno ([ERROR_HANDLING.md](./ERROR_HANDLING.md)).
- [ ] Audit: aÃ§Ã£o sensÃ­vel escreve em `AuditLog` (hash-chain).
- [ ] Frozen: diff nÃ£o toca `chain|signer|audit` sem ADR.
- [ ] DependÃªncia nova: licenÃ§a OK (sem copyleft), maintenance ativa, justificada.

## 3. Fluxo de triagem de achado (CVE/vuln)

1. **Classificar:** explorÃ¡vel aqui? (ex.: CVE de tar em build vs CVE em rota autenticada).
2. **Contexto:** o CI registra causa raiz (ex.: T054 â€” "falhas" do Trivy eram `continue-on-error` com CVEs node-tar; documentar â‰  ignorar).
3. **Corrigir ou mitigar:** bump de dependÃªncia > patch > mitigaÃ§Ã£o documentada com prazo.
4. **Registrar:** em `SECURITY.md` (REG) ou `DECISOES.md`;CVE nÃ£o-explorÃ¡vel fica com justificativa visÃ­vel â€” nunca silenciado por flag de CI.

## 4. SuperfÃ­cie crÃ­tica (mapa mental do revisor)

```
Internet â†’ Caddy/TLS â†’ headers (HSTS/CSP) â†’ middleware (page guard)
        â†’ /api/* (requireSession + RBAC + rate-limit + Zod)
        â†’ Prisma (RLS ownerId) â†’ engine (kill switches)
Signer: processo separado, Unix socket, vault H0 (nunca no Next)
```

Pentest interno de referÃªncia: [SECURITY_AUDIT.md](./SECURITY_AUDIT.md); isolamento: [signer-isolation-design.md](./signer-isolation-design.md).

## 5. Quando exigir review de seguranÃ§a reforÃ§ado (2 pares)

- Qualquer mudanÃ§a em `src/signer/`, `src/lib/audit/`, `src/lib/chain/` (exceÃ§Ã£o com ADR).
- Nova rota pÃºblica.
- MudanÃ§a em kill switches / envelope.
- Nova integraÃ§Ã£o externa ([INTEGRATIONS.md](./INTEGRATIONS.md) Â§5).

---

**Relacionados:** [CODE_REVIEW.md](./CODE_REVIEW.md) Â· [COMPLIANCE.md](./COMPLIANCE.md) Â· [SECRETS.md](./SECRETS.md) Â· [TLS_HSTS.md](./TLS_HSTS.md)

