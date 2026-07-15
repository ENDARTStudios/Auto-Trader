# PROJECT_STATE.md — Snapshot do Estado Atual

> **Este arquivo contém APENAS o snapshot corrente do projeto.**
> Histórico de mudanças de estado (linha do tempo) está em
> `memory/implementation-history.md`. Decisões arquiteturais estão em
> `DECISION_LOG.md` (resumos) e `decisions/ADR-*.md` (detalhes).
> Roadmap canônico está em `architecture/roadmap.md`.
>
> **Regra de manutenção:** quando o estado do projeto mudar (nova fase
> concluída, novo módulo FROZEN, mudança de stack), atualizar este
> snapshot E adicionar entrada datada em
> `memory/implementation-history.md`. Nunca acumular histórico aqui.

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

## Roadmap

**Fonte canônica:** `architecture/roadmap.md` (sub-fases, critérios de
aceitação, próximos milestones) e `HARDENING-ROADMAP.md` na raiz
(mapeamento de 30 attack vectors).

**Resumo do snapshot atual:**

- Fases H0 → M5: ✅ todas concluídas (0 regressões).
- Próximo milestone: M6 (Live Trading com canaryPct ramp), condicionado
  a integração Vault/KMS e definição de thresholds de rollback pelo
  operador.

---

## Decisões arquiteturais ativas

**Fonte canônica:** `DECISION_LOG.md` (DEC-NNN com template completo) e
`decisions/ADR-*.md` (ADRs com contexto, alternativas, consequências).

**Resumo do snapshot atual (5 decisões ativas):**

- **DEC-001:** Audit hash-chain com replacer-function (H0.3 fix).
- **DEC-002:** Signer isolado em processo próprio (M3.2).
- **DEC-003:** Writer Lease com fencing tokens Kleppmann (M4).
- **DEC-004:** Observability antes de Chaos/Shadow/Canary/Long-Duration (M5).
- **DEC-005:** Prefixo `BROADCAST_SIGNER_*` em erros do signer (M5.4 fix).

---

## Histórico de mudanças de estado

**Este arquivo não acumula histórico.** Toda mudança de estado (nova fase
concluída, novo módulo FROZEN, mudança de stack, expansão de governança)
deve ser registrada em `memory/implementation-history.md` (append-only,
linha do tempo cronológica com data e contexto).

**Entradas recentes relevantes** (ver arquivo completo para detalhes):

- 2026-07-15 — M5 marcado como concluído (0 regressões H0–M4).
- 2026-07-15 — Ordem das sub-fases M5 corrigida (DEC-004).
- 2026-07-15 — Criação da camada de governança `.ai/` (8 arquivos raiz).
- 2026-07-15 — Expansão para Project OS (4 subpastas + 14 arquivos).
- 2026-07-15 — Refinamento Project OS v2 (contracts/, standards/,
  invariants.md, interfaces.md, INDEX.md, separação estado/histórico).
