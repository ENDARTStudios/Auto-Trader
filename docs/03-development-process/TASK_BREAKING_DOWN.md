# TASK_BREAKING_DOWN — Como Quebrar Tarefas

> **Versão:** 1.0 — 2026-09-23
> **Padrão do repo:** sprint numerada (SXX) com tarefas T001…T00N, cada uma com validação executável. Exemplos reais: `SPRINT.md` (S01–S32), `DECISOES.md` (#22–#25).

---

## 1. Regras de quebra

1. **Uma tarefa = um resultado validável por comando.** Se não dá para escrever a linha "Validação: …", ainda está grande.
2. **Tarefa toca no máximo 1 módulo + seus testes.** Dois módulos = duas tarefas (ou uma com justificativa).
3. **Ordem de dependência explícita** (T002 depende de T001? diga).
4. **Arquivos frozen primeiro no plano:** se a quebra exigir tocar `chain|signer|audit` ou H0–M4, pare — precisa de ADR ([RULES.md](./RULES.md) §3).
5. **Docs são tarefa:** mudança de comportamento documentado inclui item "atualizar `docs/X.md`".

## 2. Template de sprint (use este formato)

```markdown
# SXX — <tema>

> **Objetivo:** <1 linha>
> **Depende de:** <SXX ou "nada">

## Tarefas
- T001 <ação concreta> — arquivos: <paths> — validação: <comando + resultado esperado>
- T002 <ação> — depende T001 — validação: <comando>

## Critério de pronto da sprint
- <gate global: lint 0, test:ci verde, build 45 rotas...>

## Riscos
- <o que pode quebrar; arquivos frozen afetados?>
```

## 3. Exemplo real condensado (S02 — Auth Foundation)

```
T001 schema User/Session/AuditLog + ownerId → validação: npx prisma db push ✅
T002 password.ts + session.ts + rbac.ts        → validação: tsc limpo
T003 rls.ts (rlsWhere/assertOwner)             → validação: testes unitários
T005 rotas /api/auth/* + rate-limit 5/60s      → validação: curl 401/200
T006 seed-auth + proteger 5 rotas críticas     → validação: viewer POST kill-switch = 403
T008 tests/auth.test.ts 8/8 + test-auth-rbac 11/11 → validação: vitest verde
```

Cada linha tem comando executável — é isso que torna a sprint auditável depois (e é o formato do histórico em `DECISOES.md`).

## 4. Dimensionamento

| Sinal | Ação |
|---|---|
| Tarefa > 120min estimados | Quebrar em 2+ |
| Tarefa não mexe em comportamento (só docs/refactor) | OK menor, mas valide build/tests |
| Tarefa mexe em auth/risco/engine | + teste dedicado obrigatório |
| Tarefa mexe em UI | + e2e ou ajuste de spec existente |

## 5. Fluxo completo

Issue ([TASKS.md](./TASKS.md)) → quebra em sprint → PR por tarefa ou sprint pequena → CI → review ([CODE_REVIEW.md](./CODE_REVIEW.md)) → merge → registro em `SPRINT.md` + `DECISOES.md` se houve decisão.

---

**Relacionados:** [TASKS.md](./TASKS.md) · [DEVELOPMENT.md](./DEVELOPMENT.md) · [../SPRINT.md](../SPRINT.md)
