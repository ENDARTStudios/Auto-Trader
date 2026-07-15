# architecture/roadmap.md — Roadmap Técnico

> Histórico, fase atual, próximos milestones.
> **Nunca apagar histórico.** Somente acrescentar.
> Fonte canônica de fases: `/home/z/my-project/HARDENING-ROADMAP.md`
> (1118+ linhas, mapeia 30 attack vectors a fases).

---

## Estado atual (snapshot 2026-07-15)

- **Fase ativa:** Pós-M5. Aguardando início do próximo milestone.
- **Próximo milestone sugerido:** Live Trading com canaryPct ramp
  (1% → 5% → 10% → 25% → 100%) e rollback automático via
  `setCanaryPct`.
- **Stack:** Next.js 16 + TypeScript + Tailwind + shadcn/ui + Prisma +
  SQLite.
- **Modo padrão:** Paper trading (live é stub; requer Vault/KMS).

---

## Fases concluídas (histórico — não remover)

### H0 — Crypto Foundation ✅

- **KDF versionada** (`src/lib/trading/kdf.ts`): encriptação de chaves
  privadas com bump de versão suportado. Legacy blobs sem version
  field ainda decriptam com a passphrase correta.
- **Audit hash-chain** (`src/lib/audit/audit-log.ts`): append-only com
  hash determinístico (replacer-function recursiva que ordena chaves
  em todos os níveis). Bug H0.3 corrigido: forma replacer-array
  silenciosamente dropava nested keys — atacante podia modificar
  payload sem quebrar a cadeia. Corrigido + REG adversarial.
- **Key rotation** (`src/lib/trading/key-rotation.ts`): rotação de
  passphrase em todos os blobs. Wrong-passphrase-fails-ALL-blobs
  (sem rotação parcial).

### H1 — RPC/Sim/Approval/MEV ✅

- **H1.1 RPC resilience** (`rpc-resilience.ts`): quorum com detecção
  de endpoint malicioso (chain id errado, block stale, balance
  errado). Endpoint em quarentina é removido do quorum.
- **H1.2 Simulation gate** (`simulation-gate.ts`): simula tx antes de
  broadcast. Revert simulado bloqueia. State-diff divergente bloqueia.
- **H1.3 Approval hardening** (`approval-hardening.ts`): rejeita
  `type(uint256).max`, cap excedido, saldo on-chain excedido.
- **H1.4 MEV baseline** (`mev-baseline.ts`): baseline anti-MEV.
  Detecta sandwich opportunity.

### H2 — Contract/Liquidity/TokenAuthority/SellSim ✅

- **H2.1 Contract verification**: source code via Etherscan/Sourcify.
  Rejeita proxy oculto, selfdestruct, delegatecall não justificado.
- **H2.2 Liquidity verification**: LP lock, concentração de LP,
  liquidez real (não TVL reportada).
- **H2.3 Token authority**: mint/freeze/upgrade authority. Rejeita
  mint não renunciado, freeze ativa.
- **H2.4 Sell simulation**: simula sell antes de buy (honeypot
  detection). Slippage de sell acima do limiar bloqueia.

### H2.6 — Pipeline ✅

- Composição dos gates H1+H2 em sequência. `PipelineResult` é o
  contrato consumido por `signer-adapter`.

### M3.1 — SignerAdapter ✅

- Adaptador IPC entre engine e processo signer. Serializa params,
  envia via canal dedicado, aguarda resposta.

### M3.2 — Signer RPC ✅

- Signer isolado em processo próprio (`src/signer/`). Chave privada
  nunca sai do processo. Audit log interno com hash-chain separada.
  Domain separator aplicado para evitar cross-protocol signature
  reuse.

### M3.3 — Broadcaster ✅

- Submete tx ao RPC quorum, aguarda receipt, classifica erros.
  Prefixo `BROADCAST_*` para permitir classificação correta pelo
  LeasedBroadcaster (correção M5.4).

### M4 — Writer Lease ✅

- Lease distribuído com fencing tokens Kleppmann. Cada acquire recebe
  token monotônico. LeasedBroadcaster verifica token antes de
  broadcastar. REG-015/016/017/018 travam invariants.

### M5 — Production Validation ✅

- **M5.0** Runtime factory (`buildRuntime()`).
- **M5.1** Dry Run — 26/26 testes, 1000 ops, lease invariants
  preservadas, memória estável.
- **M5.5** Observability — Registry único consumido por todos os
  harnesses; `/api/runtime/status` read-only JSON.
- **M5.4** Chaos — 99/99 testes, ChaosInjector classes independentes
  com `before/after/cleanup`. Bug fix em `broadcaster.ts` (prefixo
  `BROADCAST_SIGNER_*`).
- **M5.2** Shadow — 11/11 testes, 600 RPC reais BSC mainnet, 0 diffs.
  Compartilha a MESMA Pipeline com fork de output.
- **M5.3** Canary — `bucket = keccak256(txHash) % 100; bucket <
  canaryPct` determinístico.
- **M5.6** Long-Duration — 7/7 testes, 74k ops em 60s, 0 leak de
  heap, lease estável. Loop `while(running)` (não setInterval).
- **M5.7** Finalização — critérios objetivos atendidos, 0 regressões
  H0–M4.

---

## Próximos milestones (propostos — não iniciados)

### M6 — Live Trading (canaryPct ramp)

- **Objetivo:** Transição controlada de paper para live trading.
- **Mecanismo:** `canaryPct` ramp 1% → 5% → 10% → 25% → 100%.
  Cada nível mantido por N rounds; se `roundsFailed / roundsStarted`
  > threshold, `setCanaryPct` automaticamente retorna ao nível
  anterior (rollback).
- **Dependências:** Vault/KMS para chave privada do signer (hoje é
  stub). Definir policy de rollback automático (thresholds, janela de
  observação).
- **Critério de aceitação:** 100% canary por 24h sem rollback
  automático, sem divergência shadow, sem lease failures.

### M7 — Multi-chain (proposto)

- **Objetivo:** Estender de BSC mainnet para Base / Arbitrum / Optimism.
- **Dependências:** RPC endpoints por chain, configurar quorum por
  chain, validar gates H1+H2 em cada chain.
- **Status:** Apenas ideia — ver `memory/future-ideas.md`.

### M8 — Observer dashboard (proposto)

- **Objetivo:** Dashboard dedicado a `/api/runtime/status` em tempo
  real, com gráficos de latência P50/P95/P99, contadores de gate
  rejects, canary acceptance rate, shadow diff rate.
- **Dependências:** Nenhuma (consome Registry existente).
- **Status:** Apenas ideia — ver `memory/future-ideas.md`.

---

## Ataques defendidos (resumo — detalhes em `HARDENING-ROADMAP.md`)

| Vector                              | Fase | Mecanismo                                |
| ----------------------------------- | ---- | ---------------------------------------- |
| Audit log tampering                 | H0.3 | Hash-chain determinística + adversarial REG |
| Key compromise via memory dump     | M3.2 | Signer isolado em processo próprio       |
| Wrong-passphrase partial rotation  | H0   | Key rotation all-or-nothing              |
| RPC endpoint poisoning              | H1.1 | Quorum + endpoint quarantine             |
| Revert on broadcast                 | H1.2 | Simulation gate blocks broadcast         |
| Unlimited approval                  | H1.3 | Approval hardening rejects max uint      |
| Sandwich MEV                        | H1.4 | MEV baseline detects opportunity         |
| Unverified contract                 | H2.1 | Contract verification required           |
| LP rug (lock expiry, concentration) | H2.2 | Liquidity verification on-chain          |
| Mint authority rug                  | H2.3 | Token authority check                    |
| Honeypot (sell reverts)             | H2.4 | Sell simulation before buy               |
| Stale writer broadcast              | M4   | Fencing tokens (Kleppmann)               |
| Writer lease split-brain            | M4   | LeasedBroadcaster pre-broadcast verify   |
| Signer error misclassification      | M5.4 | `BROADCAST_SIGNER_*` prefix              |

---

## Lições permanentes (registradas em DECISION_LOG.md)

1. **Todo primitivo criptográfico precisa de teste adversarial.**
   (H0.3 — hash-chain bug).
2. **Isolamento por processo > isolamento por thread/vm.** (M3.2).
3. **Fencing tokens > time-based locks.** (M4, Kleppmann).
4. **Observability antes de chaos/shadow/canary/long-duration.** (M5,
   ordem corrigida pelo operador).
5. **Erros de subsistema devem ter prefixo que permita classificação
   sem introspecção de mensagem.** (M5.4, broadcaster bug).

---

## Histórico de estado (append-only)

### 2026-07-15 — M5 concluído

- Todas as sub-fases M5.0–M5.7 validadas. Critérios objetivos do
  operador atendidos. 0 regressões H0–M4. Registry único é fonte de
  verdade. Próximo milestone: M6 Live Trading.

### 2026-07-15 (anterior) — Camada de governança `.ai/` criada

- Criada estrutura `.ai/` com 8 arquivos de governança (README,
  CORE_RULES, ENGINEERING_RULES, PROMPTING_RULES, OUTPUT_RULES,
  PROJECT_STATE, DECISION_LOG, TASK_TEMPLATE). Antes desta entrada,
  decisões estavam dispersas no `worklog.md` (2385+ linhas) e no
  `HARDENING-ROADMAP.md`.

### [Entradas futuras vêm aqui — nunca sobrescrever acima]
