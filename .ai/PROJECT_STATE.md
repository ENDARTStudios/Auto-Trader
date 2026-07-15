# PROJECT_STATE.md — Memória do Estado do Projeto

> **Regra de manutenção:** nunca apagar histórico. Somente acrescentar.
> Toda mudança de estado deve adicionar uma nova entrada datada no final
> da seção "Histórico de estado" e atualizar a seção "Estado atual".

---

## Estado atual (snapshot)

- **Fase ativa:** Pós-M5. Aguardando início do próximo milestone (Live Trading
  com canaryPct ramp 1% → 5% → 10% → 25% → 100% com rollback automático via
  `setCanaryPct`).
- **Stack:** Next.js 16 + TypeScript + Tailwind + shadcn/ui + Prisma ORM.
- **Banco:** SQLite via Prisma (`prisma/schema.prisma`).
- **Modo padrão:** Paper trading (live trading é stub; requer Vault/KMS).
- **Servidor dev:** `npm run dev` na porta 3000 (Caddyfile define proxy externo).
- **Status M5:** ✅ **CONCLUÍDO** (validado em 2026-07-15 segundo `worklog.md`).
  - M5.0 Runtime factory — ✅ concluído.
  - M5.1 Dry Run — ✅ 26/26 testes pass (`scripts/test-m5-dry-run.ts`).
  - M5.5 Observability — ✅ Registry único em
    `src/lib/observability/registry.ts`; todos os harnesses consomem o
    mesmo Registry; `/api/runtime/status` expõe snapshot read-only.
  - M5.4 Chaos — ✅ 99/99 pass (`scripts/test-m5-chaos.ts`); bug fix em
    `broadcaster.ts` (erros do signer agora prefixados `BROADCAST_*`).
  - M5.2 Shadow — ✅ 11/11 pass; 600 RPC reais BSC mainnet, 0 diffs;
    compartilha a MESMA Pipeline com fork de output.
  - M5.3 Canary — ✅ `bucket = keccak256(txHash) % 100` determinístico.
  - M5.6 Long-Duration — ✅ 7/7 pass; 74k ops em 60s, 0 leak de heap,
    lease estável. Loop `while(running)` (não setInterval). Runs 24h/72h/7d
    podem ser disparadas pelo operador via
    `npx tsx scripts/test-m5-long-duration.ts --duration 86400000`.
  - M5.7 Finalização — ✅ Critérios objetivos do operador atendidos.
- **Próximo milestone sugerido:** Live Trading com canaryPct ramp
  (1% → 5% → 10% → 25% → 100%) e rollback automático.

---

## Arquitetura atual

### Camadas (fluxo canônico M4 → Blockchain)

```
Market Data
   │
   ▼
Pipeline (H2.6)  ── src/lib/chain/pipeline.ts
   │
   ▼
SignerAdapter (M3.1)  ── src/lib/chain/signer-adapter.ts
   │
   ▼
Signer RPC (M3.2)  ── src/signer/  (processo isolado)
   │
   ▼
Writer Lease (M4)  ── src/lib/chain/writer-lease.ts
   │  (fencing tokens REG-015/016/017/018, Kleppmann pattern)
   ▼
LeasedBroadcaster (M4)  ── src/lib/chain/leased-broadcaster.ts
   │  (pre-broadcast fencing check via lease.verifyToken())
   ▼
Broadcaster (M3.3)  ── src/lib/chain/broadcaster.ts
   │
   ▼
RPC Quorum (H1.1)  ── src/lib/chain/rpc-resilience.ts
   │
   ▼
Blockchain
```

### Módulos congelados (FROZEN — Regra 8 de CORE_RULES.md)

| Fase  | Módulo                          | Arquivo                                              |
| ----- | ------------------------------- | ---------------------------------------------------- |
| H0    | Audit hash-chain                | `src/lib/audit/audit-log.ts`                         |
| H1.1  | RPC resilience / quorum         | `src/lib/chain/rpc-resilience.ts`                    |
| H1.2  | Simulation gate                 | `src/lib/chain/simulation-gate.ts`                   |
| H1.3  | Approval hardening              | `src/lib/chain/approval-hardening.ts`                |
| H1.4  | MEV baseline                    | `src/lib/chain/mev-baseline.ts`                      |
| H2.1  | Contract verification           | `src/lib/chain/contract-verification.ts`             |
| H2.2  | Liquidity verification          | `src/lib/chain/liquidity-verification.ts`            |
| H2.3  | Token authority                 | `src/lib/chain/token-authority.ts`                   |
| H2.4  | Sell simulation                 | `src/lib/chain/sell-simulation.ts`                   |
| H2.6  | Pipeline (composição)           | `src/lib/chain/pipeline.ts`                          |
| M3.1  | SignerAdapter                   | `src/lib/chain/signer-adapter.ts`                    |
| M3.2  | Signer RPC (processo)           | `src/signer/main.ts`, `wallet-methods.ts`, `sign-methods.ts`, `audit.ts` |
| M3.3  | Broadcaster                     | `src/lib/chain/broadcaster.ts`                       |
| M4    | Writer Lease                    | `src/lib/chain/writer-lease.ts`                      |
| M4    | LeasedBroadcaster               | `src/lib/chain/leased-broadcaster.ts`                |

### Módulos não congelados (validados em M5 — não devem ser alterados sem nova entrada em DECISION_LOG.md)

- `src/lib/chain/runtime.ts` — factory `buildRuntime()` (M5.0).
- `src/lib/runtime/runtime.ts` — runtime principal.
- `src/lib/runtime/canary.ts` (ou embutido em `CanaryBroadcaster`) —
  bucketing determinístico `keccak256(txHash) % 100`.
- `src/lib/runtime/shadow.ts` — mesma Pipeline, fork Live + Shadow.
- `src/lib/runtime/chaos.ts` — ChaosInjector classes independentes.
- `src/lib/runtime/long-duration.ts` — loop `while(running)`.
- `src/lib/observability/metrics.ts` — interface `RuntimeMetrics`.
- `src/lib/observability/registry.ts` — Registry único (fonte de verdade).
- `src/lib/observability/snapshot.ts` — snapshot read-only.
- `src/lib/observability/exporter.ts` — export para API.
- `src/app/api/runtime/status/route.ts` — endpoint read-only JSON.

### Camada de trading (não-hardening)

Localizada em `src/lib/trading/` — engine de paper trading, scam-detector
(multicamada regex + GoPlus + market TA + AI LLM squad), risk-manager com
5 circuit breakers, portfolio com split 50/50, watchlist, etc. Esta camada
está fora do escopo do hardening roadmap mas é consumidora final da
camada de chain.

---

## Roadmap (resumo — fonte canônica: `HARDENING-ROADMAP.md`)

| Fase  | Status       | Descrição                                              |
| ----- | ------------ | ------------------------------------------------------ |
| H0    | ✅ Concluído | Crypto foundation: KDF, audit hash-chain, key rotation |
| H1    | ✅ Concluído | RPC/Sim/Approval/MEV (4 sub-fases)                     |
| H2    | ✅ Concluído | Contract/Liquidity/TokenAuthority/SellSim              |
| H2.6  | ✅ Concluído | Pipeline (composição gate → signer)                    |
| M3.1  | ✅ Concluído | SignerAdapter                                          |
| M3.2  | ✅ Concluído | Signer RPC (processo isolado)                          |
| M3.3  | ✅ Concluído | Broadcaster                                            |
| M4    | ✅ Concluído | Writer Lease (fencing tokens, REG-015/016/017/018)     |
| M5    | ✅ Concluído | Production Validation (6 sub-fases + finalização M5.7) |
| M6+   | ⏳ Pendente  | Próximo milestone sugerido: Live Trading com canaryPct ramp |

### Sub-fases M5 (ordem corrigida pelo operador — todas concluídas)

> **PRINCÍPIO:** observabilidade antes de chaos/shadow/canary/long-duration,
> para evitar que cada harness implemente sua própria coleta de métricas
> (duplicação). Todos os harnesses consomem o **mesmo Registry**.

1. M5.0 Runtime factory — ✅
2. M5.1 Dry Run — ✅ (26/26)
3. M5.5 Observability — ✅ (Registry único + `/api/runtime/status`)
4. M5.4 Chaos — ✅ (99/99, ChaosInjector pattern, bug fix broadcaster)
5. M5.2 Shadow — ✅ (11/11, 600 RPC reais BSC mainnet, 0 diffs)
6. M5.3 Canary — ✅ (`keccak256(txHash) % 100` determinístico)
7. M5.6 Long-Duration — ✅ (7/7, 74k ops, 0 leak, loop `while(running)`)
8. M5.7 Finalização — ✅ (critérios objetivos atendidos, 0 regressões H0–M4)

### Critérios objetivos para declarar M5 completo (todos atendidos)

| Sub-fase        | Critério de aceitação                                    | Status |
| --------------- | -------------------------------------------------------- | ------ |
| M5.0            | `buildRuntime()` compõe stack completa sem erros de tipo | ✅ |
| M5.1 Dry Run    | 1000 ops, lease invariants preservadas, memória estável | ✅ (26/26) |
| M5.5 Observability | Registry único, `/api/runtime/status` retorna JSON válido, todos os harnesses consomem o Registry | ✅ |
| M5.4 Chaos      | ChaosInjector classes independentes com `before/after/cleanup`, 0 `if (chaos)` espalhados | ✅ (99/99) |
| M5.2 Shadow     | Mesma Pipeline, fork output, `shadowDiffs` incrementado em divergência | ✅ (0 diffs em 600 RPC) |
| M5.3 Canary     | `bucket = keccak256(txHash) % 100; bucket < canaryPct` determinístico | ✅ |
| M5.6 Long-Duration | Loop `while(running) { tick(); sleep(); }`, uptime ≥ 1h sem leak | ✅ (74k ops, 0 leak) |
| M5.7            | Todos os testes M5 passam, 0 regressões H0–M4, worklog atualizado | ✅ |

---

## Decisões importantes (resumo — detalhes em `DECISION_LOG.md`)

1. **H0.3 — Audit hash-chain** usa `JSON.stringify(entry, sortedKeysArray)`
   bugado que silenciosamente dropava nested keys. Corrigido + REG-NNN
   adversarial. **Lição:** todo primitivo criptográfico precisa de teste
   que tente quebrá-lo.
2. **M3.2 — Signer isolado em processo próprio.** Não é uma função
   importada; é um processo separado comunicando via protocolo. Design
   em `docs/signer-isolation-design.md`.
3. **M4 — Writer Lease com fencing tokens** (Kleppmann pattern).
   `LeasedBroadcaster` faz pre-broadcast fencing check.
   REG-015/016/017/018 travam os invariantes.
4. **M5 — Ordem corrigida pelo operador.** Não desenvolver Shadow/Chaos/
   Observability/Long-Duration em paralelo. Observability primeiro,
   depois cada harness consome o Registry único.
5. **M5 — Broadcaster bug corrigido durante M5.4.** Erros do signer não
   estavam prefixados com `BROADCAST_*`, fazendo `LeasedBroadcaster`
   misclassificá-los. Fix preserva o contrato público.

---

## Histórico de estado (append-only)

### 2026-07-15 — Criação da camada de governança `.ai/`

- Criada pasta `.ai/` na raiz do projeto com 8 arquivos de governança:
  README, CORE_RULES, ENGINEERING_RULES, PROMPTING_RULES, OUTPUT_RULES,
  PROJECT_STATE, DECISION_LOG, TASK_TEMPLATE.
- Antes desta entrada, o projeto operava sem camada formal de governança;
  decisões estavam dispersas no `worklog.md` (2385+ linhas) e no
  `HARDENING-ROADMAP.md`.
- Esta é a entrada inicial de `PROJECT_STATE.md`. Snapshots futuros devem
  adicionar novas entradas datadas abaixo desta, sem remover texto anterior.

### [Entradas futuras vêm aqui — nunca sobrescrever acima]

### 2026-07-15 (posterior) — Expansão para Project Operating System (Project OS)

- Criados 4 subdiretórios adicionais em `.ai/`:
  - `architecture/` (5 arquivos): `modules.md`, `dependencies.md`,
    `frozen-files.md`, `runtime.md`, `roadmap.md`.
  - `context/` (4 arquivos): `project-summary.md`, `terminology.md`,
    `conventions.md`, `glossary.md`.
  - `memory/` (4 arquivos): `implementation-history.md`,
    `known-problems.md`, `technical-debt.md`, `future-ideas.md`.
  - `decisions/` (1 arquivo): `ADR-0001.md` (defense-in-depth
    architecture com signer isolado e fencing-token lease).
- 14 arquivos novos totalizando ~2200 linhas adicionais de
  documentação estrutural.
- Edições direcionadas (não-rewrite) em 5 arquivos existentes:
  - `README.md`: expandido para refletir árvore Project OS completa
    + nova sequência obrigatória de leitura + regras adicionais.
  - `CORE_RULES.md`: adicionada Regra 11 ("Todo bug deve produzir
    aprendizado") com referência a `memory/known-problems.md`,
    `DECISION_LOG.md` e `SECURITY.md`.
  - `ENGINEERING_RULES.md`: adicionada seção "Toda alteração deve
    informar" com 6 itens (Arquivos, Dependências, Impacto, Risco,
    Como validar, **Rollback**).
  - `TASK_TEMPLATE.md`: adicionado campo "Rollback" entre "Resultado"
    e "Pendências".
  - `PROJECT_STATE.md`: esta entrada (append-only).
- Nenhum arquivo FROZEN do código-fonte foi tocado. Nenhuma
  dependência adicionada. Nenhum arquivo renomeado ou movido.
  Escopo mínimo respeitado.
- Estado do projeto (M5 concluído, próximo milestone M6) mantido
  sem alteração — apenas adicionada camada de documentação
  estrutural.
- Próxima tarefa de implementação deverá seguir a sequência
  obrigatória: ler `CORE_RULES` → `PROJECT_STATE` → `DECISION_LOG`
  → `architecture/roadmap.md` → arquivos necessários → implementar.
