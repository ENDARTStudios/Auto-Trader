# DEVELOPMENT — Fluxo de Desenvolvimento

> **Versão:** 1.0 — 2026-09-23
> **Padrão:** Issues → PRs → CI (detalhe em `AGENT_GUIDE.md`). Nada direto em `main`.

---

## 1. Ciclo (toda mudança segue isto)

```
Issue → branch feat/fix → commits convencionais → validação local
     → push (pre-push gate: test:ci) → PR → CI verde → review → merge squash
```

1. **Issue** descreve problema + critério de pronto (origem: [TASKS.md](./TASKS.md)).
2. **Branch** a partir de `main` — `feat/<tema>` ou `fix/<tema>`.
3. **Commits** — Conventional Commits (commitlint bloqueia fora do padrão).
4. **Validação local obrigatória:**
   ```bash
   npm run lint && npx tsc --noEmit
   npm run test:run          # vitest
   npm run test:ci           # gate completo (o mesmo do pre-push)
   ```
5. **Push** — o hook de pre-push roda `test:ci` (REG-004). Se falhou, o push não saiu.
6. **PR** — descrição com problema/solução/validação (formato ADR; exemplo nas entradas de `DECISOES.md`).
7. **CI** — lint, typecheck, gitleaks, npm audit, `test:ci` 637 checks, coverage, Trivy, ZAP; e2e se label `e2e` ou main.
8. **Review** ([CODE_REVIEW.md](./CODE_REVIEW.md)) → **merge squash**.

## 2. Regras do dia a dia

- **Frozen:** `git diff --name-only | grep -E 'chain|signer|audit'` vazio antes de push ([RULES.md](./RULES.md) §3).
- **Envelope:** nunca escrever por código em `config/risk_config.json`, `state/mode.json`, `config/dag_edges.json` ([RULES.md](./RULES.md) §2).
- **Contexto:** use `graft ask "<pergunta>" --source` antes de abrir arquivos (mais barato e exato).
- **Docs:** comportamento mudou → doc em `docs/` atualizado no mesmo PR.
- **Linux:** signer/tests usam Unix sockets — WSL2/Docker no Windows ([SETUP.md](./SETUP.md)).

## 3. Estado e feature flags

- Flags em `FeatureFlag` (Prisma) + `/api/feature-flags` (GET `dashboard:read`, POST `flags:manage`); seed com `scripts/seed-flags.ts`.
- Feature nova parcialmente pronta entra atrás de flag — não em branch de longa vida.

## 4. Depuração

- `dev.log` / `server.log` (tee nos scripts npm) — log padrão de dev.
- `logs/crash.log.prior-*` — crashes anteriores; `src/lib/crash-logger.ts` grava os novos.
- Engine: `logs/episodes.jsonl` (decisões), `AppLog` no DB.
- Sentry/OTel ativos conforme env ([OBSERVABILITY.md](./OBSERVABILITY.md)).

## 5. Definition of Done (resumo)

Lint 0 · typecheck limpo · `test:ci` verde · cobertura não regride · zero frozen · docs atualizados · decisão registrada (se houve escolha) · CI verde.

---

**Relacionados:** [CODE_REVIEW.md](./CODE_REVIEW.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md) · [QA_TESTING.md](./QA_TESTING.md) · [../AGENT_GUIDE.md](../AGENT_GUIDE.md)
