# SECURITY_REVIEW — Processo de Security Review

> **Versão:** 1.0 — 2026-09-23
> **Fontes:** [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) (auditoria), `SECURITY.md` (REGs de hardening), `HARDENING-ROADMAP.md`.

---

## 1. Camadas automatizadas (CI — `ci.yml` + `zap.yml`)

| Camada | Ferramenta | Gate |
|---|---|---|
| Secrets | Gitleaks | Bloqueia merge |
| Dependências | `npm audit --audit-level=high` | Bloqueia em high+ |
| SAST de imagem/FS | Trivy | **Sem** `continue-on-error` (lição T054: CVEs mascarados não são "verde") |
| DAST | OWASP ZAP (`zap.yml`) | Baseline scan em `main` |
| Hardcoded creds em testes | Review manual + `SIGNER_TEST_HOOKS` só em CI com env de teste |

## 2. Checklist de review humano (PRs sensíveis)

Para PR que toca **auth, APIs públicas, signer/vault, config de risco, webhooks/billing**:

- [ ] Autenticação: `requireSession` + `hasPermission` na rota nova/alterada ([RBAC.md](./RBAC.md)).
- [ ] Input: Zod em tudo; sem reflexão de input em resposta/redirect.
- [ ] RLS: recurso do usuário filtrado por `ownerId` (`rlsWhere`/`assertOwner`) ([RLS.md](./RLS.md)).
- [ ] Segredo: nenhum valor em código/log; env validado em `src/lib/env.ts`.
- [ ] Rate-limit: rota pública/consome-CPU tem limite ([WAF_RATE_LIMIT.md](./WAF_RATE_LIMIT.md)).
- [ ] Erro: resposta não vaza stack/detalhe interno ([ERROR_HANDLING.md](./ERROR_HANDLING.md)).
- [ ] Audit: ação sensível escreve em `AuditLog` (hash-chain).
- [ ] Frozen: diff não toca `chain|signer|audit` sem ADR.
- [ ] Dependência nova: licença OK (sem copyleft), maintenance ativa, justificada.

## 3. Fluxo de triagem de achado (CVE/vuln)

1. **Classificar:** explorável aqui? (ex.: CVE de tar em build vs CVE em rota autenticada).
2. **Contexto:** o CI registra causa raiz (ex.: T054 — "falhas" do Trivy eram `continue-on-error` com CVEs node-tar; documentar ≠ ignorar).
3. **Corrigir ou mitigar:** bump de dependência > patch > mitigação documentada com prazo.
4. **Registrar:** em `SECURITY.md` (REG) ou `DECISOES.md`;CVE não-explorável fica com justificativa visível — nunca silenciado por flag de CI.

## 4. Superfície crítica (mapa mental do revisor)

```
Internet → Caddy/TLS → headers (HSTS/CSP) → middleware (page guard)
        → /api/* (requireSession + RBAC + rate-limit + Zod)
        → Prisma (RLS ownerId) → engine (kill switches)
Signer: processo separado, Unix socket, vault H0 (nunca no Next)
```

Pentest interno de referência: [SECURITY_AUDIT.md](./SECURITY_AUDIT.md); isolamento: [signer-isolation-design.md](./signer-isolation-design.md).

## 5. Quando exigir review de segurança reforçado (2 pares)

- Qualquer mudança em `src/signer/`, `src/lib/audit/`, `src/lib/chain/` (exceção com ADR).
- Nova rota pública.
- Mudança em kill switches / envelope.
- Nova integração externa ([INTEGRATIONS.md](./INTEGRATIONS.md) §5).

---

**Relacionados:** [CODE_REVIEW.md](./CODE_REVIEW.md) · [COMPLIANCE.md](./COMPLIANCE.md) · [SECRETS.md](./SECRETS.md) · [TLS_HSTS.md](./TLS_HSTS.md)
