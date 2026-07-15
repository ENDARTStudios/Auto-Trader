# memory/technical-debt.md — Débitos Técnicos

> Débitos técnicos identificados. Prioridade, impacto, ação
> recomendada. Append-only.
> Para problemas em aberto que causam bugs ver
> `known-problems.md > Em observação`.
> Para ideias não implementadas ver `future-ideas.md`.

---

## Alto impacto / alta prioridade

### TD-001 — Possível duplicação `chain/runtime.ts` vs `runtime/runtime.ts`

- **Prioridade:** Alta (antes do M6).
- **Impacto:** Manutenção confusa; mudanças em um arquivo podem
  não refletir no outro. Possível divergência de comportamento.
- **Descrição:** M5.0 criou factory em `src/lib/chain/runtime.ts`.
  Expansão M5 previa mover para `src/lib/runtime/runtime.ts`. Ambos
  parecem existir no filesystem; não foi confirmado se um é
  re-export do outro.
- **Ação recomendada:** Rodar `diff` entre os dois arquivos. Se
  idênticos ou se um é re-export, documentar em `DECISION_LOG.md`
  qual é o canônico. Se divergentes, consolidar.
- **Status:** Pendente.

### TD-002 — Live trading é stub

- **Prioridade:** Alta (bloqueia M6).
- **Impacto:** Sem integração Vault/KMS, M6 não pode começar.
- **Descrição:** `src/signer/main.ts` carrega chave privada de
  fonte stub em paper mode. Para live, precisa de Vault/KMS.
- **Ação recomendada:** Integrar HashiCorp Vault ou AWS KMS em
  `src/signer/main.ts`. Definir interface `KeyProvider` e impls
  `VaultKeyProvider`, `KmsKeyProvider`, `StubKeyProvider`.
- **Status:** Pendente (pré-requisito do M6).

### TD-003 — SQLite em produção

- **Prioridade:** Média-alta (pré-M6 recomendado).
- **Impacto:** SQLite tem locks globais; sob concorrência de
  rounds + API + SSE, pode haver `SQLITE_BUSY`.
- **Descrição:** Banco default é `prisma/dev.db` (SQLite).
- **Ação recomendada:** Avaliar migração para Postgres. Schema
  Prisma é compatível (com ajustes de tipos específicos).
  Adicionar migration Postgres + testar.
- **Status:** Pendente.

---

## Médio impacto / média prioridade

### TD-004 — Sem CI/CD

- **Prioridade:** Média.
- **Impacto:** Testes só rodam manualmente; regressões podem
  entrar se operador esquecer de rodar.
- **Descrição:** Não há GitHub Actions ou similar. Scripts de
  teste em `scripts/test-*.ts` são executados manualmente.
- **Ação recomendada:** Adicionar `.github/workflows/ci.yml`
  rodando `tsc --noEmit`, `eslint`, e `scripts/test-h0-*.ts` →
  `scripts/test-m5-*.ts` em sequência.
- **Status:** Pendente.

### TD-005 — Sem monitoramento externo

- **Prioridade:** Média.
- **Impacto:** Se runtime cair, operador só percebe acessando o
  dashboard. Sem alerta proativo.
- **Descrição:** `/api/runtime/status` existe mas é pull-based.
- **Ação recomendada:** Adicionar push-based alerting (webhook
  para Slack/Discord) quando `roundsFailed` ultrapassar threshold
  ou quando `activeLeaseOwner` mudar frequentemente (split-brain
  indicador).
- **Status:** Pendente.

### TD-006 — Falta de testes E2E de UI

- **Prioridade:** Baixa-média.
- **Impacto:** Mudanças no dashboard podem quebrar UX sem
  detecção.
- **Descrição:** `scripts/` tem testes para chain, signer, M3, M4,
  M5. Não há testes E2E para componentes de dashboard.
- **Ação recomendada:** Adicionar Playwright para smoke tests de
  cada tab do dashboard. Não precisa de cobertura exaustiva —
  apenas "renderiza sem erro, elementos principais aparecem".
- **Status:** Pendente.

---

## Baixo impacto / baixa prioridade

### TD-007 — Documentação de API inline

- **Prioridade:** Baixa.
- **Impacto:** Sem OpenAPI/Swagger, consumidores externos (se
  houver no futuro) precisam ler código.
- **Descrição:** API routes não têm schema OpenAPI documentado.
- **Ação recomendada:** Quando M6 começar, documentar endpoints
  públicos com OpenAPI. Endpoints internos (dashboard-only) podem
  ficar sem.
- **Status:** Pendente.

### TD-008 — Logs estruturados vs texto livre

- **Prioridade:** Baixa.
- **Impacto:** Busca e agregação de logs é manual.
- **Descrição:** `AppLog` model tem campos estruturados, mas
  `message` é texto livre. Mistura de formatos.
- **Ação recomendada:** Padronizar `message` como JSON
  estruturado (ex.: `{"event": "round.started", "roundId": "..."}`).
  Manter backward compat com mensagens antigas.
- **Status:** Pendente.

### TD-009 — Magic numbers em configuração

- **Prioridade:** Baixa.
- **Impacto:** Manutenção; alterar threshold requer editar código.
- **Descrição:** Alguns thresholds (ex.: P95 latência alvo,
  canary rollback threshold) estão hardcoded em scripts de teste.
- **Ação recomendada:** Mover para `Config` model no Prisma,
  editável via dashboard.
- **Status:** Pendente.

### TD-010 — Sem retry com backoff exponencial emissor de notificações

- **Prioridade:** Baixa.
- **Impacto:** Notificação perdida se webhook do destinatário
  estiver temporariamente indisponível.
- **Descrição:** `notifier.ts` envia webhook uma vez; sem retry.
- **Ação recomendada:** Adicionar fila (BullMQ ou similar) com
  retry exponencial. Mas isto adiciona dependência (Redis) — ver
  `ENGINEERING_RULES > Restrições` antes de decidir.
- **Status:** Pendente. Avaliar custo/benefício.

---

## Dívida técnica deliberada (justificada)

### TD-011 — Sem framework de teste (jest/vitest)

- **Prioridade:** Baixa (decisão deliberada).
- **Impacto:** Nenhum; pattern atual (try/catch + contador) é
  suficiente para o projeto.
- **Descrição:** Scripts de teste usam pattern simples
  `async function testX(): Promise<void>` com main runner no final.
- **Justificativa:** Framework adicionaria dependência e
  indireção. Pattern atual é explícito e fácil de debugar.
- **Ação recomendada:** Manter como está. Reavaliar se número de
  testes crescer >200.
- **Status:** Decisão mantida.

### TD-012 — Sem ORM abstraído (Prisma direto)

- **Prioridade:** Baixa (decisão deliberada).
- **Impacto:** Acoplamento direto a Prisma.
- **Descrição:** Código de produção usa `PrismaClient` diretamente,
  sem repository pattern.
- **Justificativa:** Repository pattern adicionaria indireção sem
  benefício claro neste momento. Prisma já é uma abstração.
- **Ação recomendada:** Manter como está. Se migrar de Prisma no
  futuro, avaliar repository pattern na época.
- **Status:** Decisão mantida.

---

### [Entradas futuras vêm aqui — nunca sobrescrever acima]
