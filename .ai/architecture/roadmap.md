# `architecture/roadmap.md` — Roadmap Técnico Canônico

> **STATE: ACTIVE** — Roadmap — fases concluídas são append-only; futuras podem mudar.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Fonte canônica do roadmap de hardening. Para detalhes de attack
> vectors cobertos por cada fase, veja `HARDENING-ROADMAP.md` na
> raiz do projeto. Para estado atual, veja `PROJECT_STATE.md`.

---

## Estado atual (snapshot)

**Fase ativa:** Pós-M5. Aguardando início do próximo milestone
(Live Trading com canaryPct ramp 1% → 5% → 10% → 25% → 100% com
rollback automático via `setCanaryPct`).

**Stack:** Next.js 16 + TypeScript + Tailwind + shadcn/ui + Prisma ORM.
**Banco:** SQLite via Prisma (`prisma/schema.prisma`).
**Modo padrão:** Paper trading (live trading é stub; requer Vault/KMS).

---

## Fases concluídas (H0 → M5)

| Fase  | Status       | Descrição                                              | ADR/DEC    |
| ----- | ------------ | ------------------------------------------------------ | ---------- |
| H0    | ✅ Concluído | Crypto foundation: KDF, audit hash-chain, key rotation | DEC-001    |
| H1    | ✅ Concluído | RPC/Sim/Approval/MEV (4 sub-fases)                     | —          |
| H2    | ✅ Concluído | Contract/Liquidity/TokenAuthority/SellSim              | —          |
| H2.6  | ✅ Concluído | Pipeline (composição gate → signer)                    | —          |
| M3.1  | ✅ Concluído | SignerAdapter                                          | DEC-002    |
| M3.2  | ✅ Concluído | Signer RPC (processo isolado)                          | DEC-002    |
| M3.3  | ✅ Concluído | Broadcaster                                            | DEC-005    |
| M4    | ✅ Concluído | Writer Lease (fencing tokens Kleppmann)                | DEC-003    |
| M5    | ✅ Concluído | Production Validation (6 sub-fases + finalização M5.7) | DEC-004    |

### Sub-fases M5 (todas concluídas)

> **PRINCÍPIO (DEC-004):** observabilidade antes de chaos/shadow/
> canary/long-duration. Todos os harnesses consomem o MESMO Registry.

| Sub-fase        | Critério de aceitação                                    | Status      |
| --------------- | -------------------------------------------------------- | ----------- |
| M5.0            | `buildRuntime()` compõe stack completa sem erros de tipo | ✅          |
| M5.1 Dry Run    | 1000 ops, lease invariants preservadas, memória estável | ✅ (26/26)  |
| M5.5 Observability | Registry único, `/api/runtime/status` retorna JSON válido | ✅       |
| M5.4 Chaos      | ChaosInjector classes independentes com `before/after/cleanup`, 0 `if (chaos)` | ✅ (99/99) |
| M5.2 Shadow     | Mesma Pipeline, fork output, `shadowDiffs` incrementado em divergência | ✅ (0 diffs em 600 RPC) |
| M5.3 Canary     | `bucket = keccak256(txHash) % 100; bucket < canaryPct` determinístico | ✅ |
| M5.6 Long-Duration | Loop `while(running) { tick(); sleep(); }`, uptime ≥ 1h sem leak | ✅ (74k ops, 0 leak) |
| M5.7 Finalização | Todos os testes M5 passam, 0 regressões H0–M4, worklog atualizado | ✅ |

---

## Próximos milestones sugeridos

### M6 — Live Trading com canaryPct ramp

**Objetivo:** transicionar do paper trading para live trading real
na BSC mainnet, com ramp gradual de tráfego.

**Critérios de aceitação:**

1. `canaryPct` configurável em runtime via API autenticada
   (sem restart).
2. Rampa canônica: 1% → 5% → 10% → 25% → 50% → 100%.
3. Rollback automático para `canaryPct = 0` se:
   - `tx_reverted_rate > 5%` em janela de 5 minutos, OU
   - `shadow_diffs > 0` em janela de 1 minuto, OU
   - `broadcaster_error_rate > 1%` em janela de 5 minutos.
4. Vault/KMS integration para mnemonic do signer (substitui
   env var `SIGNER_MNEMONIC`).
5. Endpoint `/api/runtime/canary` para inspect e override manual.

**Riscos:**

- Vault/KMS pode adicionar latência de 50-100ms no cold start do
  signer.
- Rollback automático pode ser falso positivo em janelas curtas
  com poucas tx (ex.: 1% de 10 tx = 0 ou 1 reverts).

**Dependências:**

- Infra: Vault/KMS configurado (responsabilidade do operador).
- Monitoring: alerting externo (Prometheus/Grafana ou similar)
  consumindo `/api/runtime/status`.

**Pré-requisitos:**

- Operador define: qual rede (BSC mainnet confirmado?), qual
  carteira (vault path), qual estratégia de funding (USDC inicial).
- Operador define: thresholds de rollback automáticos aceitáveis.

### M7+ — Hipóteses futuras (não priorizadas)

- **M7 Multi-chain:** estender para Base/Arbitrum/Optimism.
  Exige: multi-RPC quorum, multi-token authority, multi-liquidity
  verifier.
- **M8 MEV protection avançada:** Flashbots Protect / private
  mempool. Exige: integração com relay, novo bundle broadcaster.
- **M9 Withdrawal workflow:** fluxo automatizado de saída para
  cold wallet (split 50/50 já implementado, mas saída manual).
- **M10 Dashboard de risco:** visualização em tempo real dos 5
  circuit breakers + history de triggers.
- **M11 Backtesting:** histórico de decisões do engine vs. mercado
  real, com métricas de alpha.

---

## Princípios do roadmap

1. **Hardening antes de features.** Toda fase de hardening bloqueia
   features novas até estar concluída. Não atalhar.
2. **Cada fase tem critérios objetivos.** Sem critérios mensuráveis
   (ex.: "26/26 testes pass"), a fase não está completa.
3. **Cada fase produz ADR.** Decisões estruturais ficam registradas
   em `decisions/` para auditoria futura.
4. **Cada fase produz testes adversariais.** REG-NNN em
   `SECURITY.md` pina as propriedades de segurança validadas.
5. **Nenhum rollback silencioso.** Toda reversão de fase é entrada
   em `DECISION_LOG.md` com justificativa estrutural.

---

## Histórico de mudanças do roadmap

### 2026-07-15 — M5 marcado como concluído

- Sub-fase M5.7 (finalização) concluída: 0 regressões H0–M4,
  worklog atualizado.
- Estado transita de "M5 em curso" para "Pós-M5, aguardando M6".
- Próxima tarefa de implementação sugerida: M6 (Live Trading com
  canaryPct ramp), condicionada a aprovação do operador.

### 2026-07-15 — Ordem das sub-fases M5 corrigida (DEC-004)

- Ordem original tinha Observability em paralelo com Chaos/Shadow.
- Operador corrigiu: Observability PRIMEIRO, depois cada harness
  consome o Registry único. Motivo: evitar duplicação de coleta de
  métricas.

### [Entradas futuras vêm aqui — append-only]

---

## Relacionado

- `PROJECT_STATE.md` — snapshot do milestone corrente.
- `memory/implementation-history.md` — linha do tempo de conclusão de fases.
- `DECISION_LOG.md` DEC-004 — ordem das sub-fases M5.
- `decisions/ADR-0001.md` — arquitetura que o roadmap valida.
- `HARDENING-ROADMAP.md` (raiz do projeto) — mapeia 30 attack vectors às fases.
- `memory/future-ideas.md` FI-NNN — candidatos a futuros milestones.
- `memory/technical-debt.md` TD-002 — bloqueador do M6 (Vault/KMS).
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

