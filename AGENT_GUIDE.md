# AGENT_GUIDE — Padrão Obrigatório para Qualquer Agente (Humano ou IA)

> **Leia este arquivo antes de abrir qualquer Issue ou PR.**
> Este guia consolida o padrão de desenvolvimento do projeto. Qualquer agente — ChatGPT, Claude, Cursor, Copilot, humano — deve seguir estas regras. PR que não segue será rejeitado.

---

## 1. Regra de Ouro

> **Toda tarefa começa como Issue, vira PR com `Closes #<id>`, passa no CI e só então mergeia.**

```
  Issue (bug/feat/security/chore)
      │
      ▼
  Branch `feat/42-slug` ou `fix/42-slug` (a partir de `main`)
      │
      ▼
  Commit(s) com Conventional Commits (`feat: ...`, `fix: ...`, `security: ...`)
      │
      ▼
  PR com `Closes #42` + checklist + evidências
      │
      ▼
  CI verde (lint + typecheck + test:ci 637 checks + coverage 80% + gitleaks + audit + build + CodeQL)
      │
      ▼
  Review (CODEOWNERS) + aprovação
      │
      ▼
  Merge em `main` → auto-deploy staging → promoção manual para prod
```

**Sem Issue, sem merge. Sem `Closes #`, sem merge. Sem CI verde, sem merge.**

---

## 2. Issues — Como Abrir

Use o template correto em `.github/ISSUE_TEMPLATE/`:

| Template | Quando usar | Labels |
|---|---|---|
| `bug_report.yml` | Correção — algo quebrou ou está errado | `bug` |
| `feature_request.yml` | Nova função — algo que não existe ainda | `enhancement` |
| `security_report.yml` | Falha de segurança — vazamento, bypass, injeção | `security` |
| `chore.yml` | Melhoria / refator / docs / deps / limpeza | `chore` |

**Checklist de toda Issue:**

- [ ] Título com prefixo `[BUG]` / `[FEAT]` / `[SECURITY]` / `[CHORE]`
- [ ] Sintoma + resultado esperado (para bug) OU problema + proposta (para feat)
- [ ] Passos para reproduzir OU critérios de aceite binários (PASS/FAIL)
- [ ] Arquivos afetados (previstos)
- [ ] Severidade / prioridade
- [ ] Sem segredo no relato (gitleaks bloqueia)

---

## 3. PRs — Como Abrir

Use `.github/pull_request_template.md` (preenchido automaticamente).

**Checklist de toda PR:**

- [ ] Branch a partir de `main` atualizada (`git fetch origin && git rebase origin/main`)
- [ ] Título com Conventional Commits: `feat: ...`, `fix: ...`, `security: ...`, `chore: ...`, `docs: ...`
- [ ] Descrição menciona `Closes #<id>` (a issue que originou a PR)
- [ ] Como testar — comandos concretos (não "funciona corretamente")
- [ ] Evidências — saída de `test:ci`, `coverage`, screenshot se UI
- [ ] Checklist de segurança preenchido (Zod, RBAC, RLS, rate limit, XSS)
- [ ] Docs atualizados se mudou contrato (`docs/*.md`, `README.md`, `SECURITY.md`)
- [ ] CI verde antes de pedir review

**Tamanho:** PR deve tocar ≤12 arquivos e ter 1 objetivo. Se precisa mexer em mais, decomponha em múltiplas issues/PRs.

---

## 4. Deploys — Como Gerenciar

| Ambiente | Trigger | O que roda | Quem promove |
|---|---|---|---|
| **CI (PR)** | Push em branch de PR | `ci.yml` (lint, typecheck, tests, SAST, audit, build) | Automático — bloqueia merge se falha |
| **Staging** | Merge em `main` | Build Docker + Trivy + DAST (ZAP) + k6 | Automático após CI verde |
| **Produção** | Promoção manual | Health check + rollback automático se falha | Operador (1 clique) |

**Nunca force-push em `main`. Nunca use `--no-verify` sem registro em `DECISOES.md`.**

---

## 5. Padrões de Código que Todo Agente Deve Respeitar

### 5.1 Segurança (não negociável)

- Valide TODA entrada na fronteira com Zod — rejeite payload não validado.
- Use `requirePermission(perm)` em TODA rota que não é pública.
- Use `withRLS(session, model, fn)` em TODA query de modelo com `ownerId`.
- Nunca exponha `DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET` em log, erro ou resposta.
- `gitleaks` deve passar antes de qualquer push (pre-commit hook).
- `npm audit --audit-level=high` deve passar em CI.

### 5.2 Motion & UI (ver `docs/MOTION.md`)

- Todo panel/rota tem **skeleton** enquanto carrega (`<Skeleton />`).
- Todo dado é **lazy-loaded** (`dynamic(() => import(...))` ou TanStack `suspense`).
- Toda entrada/saída tem **smooth animation** (Framer Motion `AnimatePresence` + `motion.div`).
- Todo progresso tem **indicador** (progress bar, spinner, shimmer) — nunca tela branca.
- Variants centralizadas em `src/lib/ui/motion.ts` — não inline.

### 5.3 Observabilidade (ver `docs/ERROR_REPORTING.md`, `docs/OBSERVABILITY.md`)

- Todo erro de UI passa por `<ErrorBoundary label="...">` (isolado por panel).
- Todo erro de API passa por `handleApiError(e, route)` (não vaza stack em prod).
- Todo erro é capturado via `captureError(err, {label})` (Sentry se DSN setado, senão Pino/AppLog).
- Logs via `logger.info/warn/error(source, msg, context)` — nunca `console.log` com dados sensíveis.

### 5.4 Testes (ver `docs/TESTING.md`)

- Novo service → teste unit Vitest em `src/lib/**/__tests__/*.test.ts` (≥80% coverage).
- Nova rota → teste de integração em `tests/integration/*.test.ts` (happy + erro + auth).
- Novo fluxo crítico → spec E2E em `e2e/*.spec.ts` (Playwright).
- Bug fix → primeiro escreva teste que reproduz o bug (falha), depois corrija (passa) — ver `SECURITY.md` REG pattern.

### 5.5 Docs

- Mudou contrato/prisma/rota? Atualize `docs/PRD.md`, `docs/UML.md`, `docs/ARCHITECTURE.md`.
- Introduziu nova defesa? Adicione `REG-XXX` em `SECURITY.md`.
- Mudou decisão arquitetural? Registre em `DECISOES.md`.

---

## 6. Comandos que Todo Agente Deve Conhecer

```bash
# Setup
cp .env.example .env && npm install && npx prisma db push && npx prisma generate

# Dev
npm run dev                    # Next.js 3000 + SSE + engine singleton

# Verificação (gate local — rode antes de push)
npm run lint
npx tsc --noEmit
npm run test:ci                # 637 checks — REG-004 gate
npx vitest run --coverage      # 80% threshold
gitleaks detect --source . --no-git -v
npm audit --audit-level=high
npm run build

# E2E
npx playwright test
npx playwright test --ui

# DB
npx prisma studio
npx prisma migrate dev --name descricao
```

---

## 7. Onde Está Cada Coisa

| Quero... | Arquivo |
|---|---|
| Entender o produto | `docs/PRD.md` |
| Ver classes/sequência | `docs/UML.md` |
| Ver permissões | `docs/RBAC.md` |
| Ver isolamento de linhas | `docs/RLS.md` |
| Ver segredos/env | `docs/SECRETS.md` + `.env.example` |
| Ver módulos/flags | `docs/ARCHITECTURE.md` |
| Ver erro/sentry/otel | `docs/ERROR_REPORTING.md` |
| Ver testes | `docs/TESTING.md` + `vitest.config.ts` + `playwright.config.ts` |
| Ver gate de deploy | `docs/SECURITY_AUDIT.md` |
| Ver WAF/rate limit | `docs/WAF_RATE_LIMIT.md` |
| Ver TLS/HSTS | `docs/TLS_HSTS.md` |
| Ver hardening | `HARDENING-ROADMAP.md` + `SECURITY.md` |
| Ver motion/skeleton | `docs/MOTION.md` + `src/lib/ui/motion.ts` |
| Ver observabilidade | `docs/OBSERVABILITY.md` |
| Ver lint/qualidade | `docs/LINT.md` |
| Ver SEO | `docs/SEO.md` |
| Próxima sprint | `SPRINT.md` |
| Decisões | `DECISOES.md` |
| Protocolo | `PROTOCOLO_MESTRE.md` + `PLANO_MESTRE.md` |

---

## 8. Anti-Padrões — O que NÃO Fazer

| Anti-padrão | Por que é proibido | O que fazer em vez |
|---|---|---|
| Commitar `.env` com segredo real | Vaza credencial no git history | Só `.env.example` com `SUA_CHAVE_AQUI` |
| PR sem Issue | Perde rastreabilidade deploy | Abra Issue primeiro, mesmo que pequena |
| "Funciona corretamente" como critério | Não verificável | Critério binário: `curl ... → 200 + {positions: [...]}` |
| `any` sem justificativa | Esconde bug de tipo | Tipar ou `unknown` + narrow |
| `dangerouslySetInnerHTML` sem DOMPurify | XSS | `DOMPurify.sanitize(html)` |
| Query Prisma sem `withRLS` em modelo com `ownerId` | IDOR | Sempre `withRLS(session, model, fn)` |
| Rota sem `requirePermission` | Bypass RBAC | Sempre guard, mesmo que `viewer` |
| Tela branca sem skeleton/progress | Péssima UX, parece que travou | Skeleton + spinner + motion |
| `console.log` com dados sensíveis | Vaza em log aggregator | `logger.info(source, msg, redact(context))` |
| Force-push em `main` | Perde history, quebra deploy | PR + merge commit |
| `--no-verify` ou `SIGNER_SKIP_PRE_PUSH_HOOK=1` em rotina | Pula gate de segurança | Só para WIP backup, com banner |
