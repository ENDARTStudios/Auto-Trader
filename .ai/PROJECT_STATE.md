# PROJECT_STATE.md — Snapshot Puro do Estado Atual

> **Este arquivo é APENAS o snapshot corrente do projeto.**
> Não contém roadmap, decisões nem histórico. Tudo else é
> referência para a fonte canônica.

---

## Versão do Project OS

```
Project OS  : v2.1
Atualizado  : 2026-07-16
Ver ADR-0002 para a última mudança estrutural.
```

---

## Snapshot do projeto

| Campo                          | Valor                                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| **Versão do projeto**          | GLM 5.1 — Crypto Trading System                                    |
| **Branch principal**           | `main`                                                             |
| **Milestone atual**            | Pós-M5 (validado 2026-07-15). Aguardando início do próximo.        |
| **Stack**                      | Next.js 16 + TypeScript + Tailwind + shadcn/ui + Prisma ORM        |
| **Banco**                      | SQLite via Prisma (`prisma/schema.prisma`)                         |
| **Modo padrão**                | Paper trading (live trading é stub; requer Vault/KMS)              |
| **Servidor dev**               | `npm run dev` porta 3000 (Caddyfile define proxy externo)          |
| **Próximo milestone sugerido** | M6 — Live Trading com canaryPct ramp (1% → 5% → 10% → 25% → 100%)  |
| **Data da última atualização** | 2026-07-16                                                         |

---

## Módulos concluídos (FROZEN — Regra 8 CORE_RULES.md)

> Lista canônica completa em `architecture/frozen-files.md`.

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
| M3.2  | Signer RPC (processo)           | `src/signer/` (`main.ts`, `wallet-methods.ts`, `sign-methods.ts`, `audit.ts`) |
| M3.3  | Broadcaster                     | `src/lib/chain/broadcaster.ts`                       |
| M4    | Writer Lease                    | `src/lib/chain/writer-lease.ts`                      |
| M4    | LeasedBroadcaster               | `src/lib/chain/leased-broadcaster.ts`                |

## Módulos em andamento / validados mas não FROZEN

> Estes módulos foram validados em M5 mas não têm marcador FROZEN.
> Não devem ser alterados sem nova entrada em `DECISION_LOG.md`.

- `src/lib/chain/runtime.ts` — factory `buildRuntime()` (M5.0).
- `src/lib/runtime/runtime.ts` — runtime principal.
- `src/lib/runtime/{canary,shadow,chaos,long-duration}.ts` — harnesses M5.
- `src/lib/observability/{metrics,registry,snapshot,exporter}.ts` — Observability (M5.5).
- `src/app/api/runtime/status/route.ts` — endpoint read-only.

## Status M5 (validação final)

```
M5.0 Runtime factory        ✅ concluído
M5.1 Dry Run                ✅ 26/26 pass
M5.5 Observability          ✅ Registry único em src/lib/observability/registry.ts
M5.4 Chaos                  ✅ 99/99 pass (bug fix em broadcaster.ts — DEC-005)
M5.2 Shadow                 ✅ 11/11 pass; 600 RPC BSC mainnet, 0 diffs
M5.3 Canary                 ✅ bucket = keccak256(txHash) % 100 determinístico
M5.6 Long-Duration          ✅ 7/7 pass; 74k ops em 60s, 0 leak de heap
M5.7 Finalização            ✅ Critérios objetivos do operador atendidos
```

---

## Camada de fluxo canônico (referência)

```
Market Data
   │
   ▼
Pipeline (H2.6) ── src/lib/chain/pipeline.ts
   │
   ▼
SignerAdapter (M3.1) ── src/lib/chain/signer-adapter.ts
   │
   ▼
Signer RPC (M3.2) ── src/signer/  (processo isolado)
   │
   ▼
Writer Lease (M4) ── src/lib/chain/writer-lease.ts
   │   (fencing tokens REG-015/016/017/018, Kleppmann pattern)
   ▼
LeasedBroadcaster (M4) ── src/lib/chain/leased-broadcaster.ts
   │   (pre-broadcast fencing check via lease.verifyToken())
   ▼
Broadcaster (M3.3) ── src/lib/chain/broadcaster.ts
   │
   ▼
RPC Quorum (H1.1) ── src/lib/chain/rpc-resilience.ts
   │
   ▼
Blockchain
```

> Detalhes do runtime e dos eventos: `architecture/runtime.md`.
> Lista de módulos e responsabilidades: `architecture/modules.md`.

---

## Referências (fontes canônicas externas a este snapshot)

```
Roadmap canônico:
→ architecture/roadmap.md

Histórico cronológico (linha do tempo):
→ memory/implementation-history.md

Decisões arquiteturais:
→ DECISION_LOG.md (resumos DEC-NNN)
→ decisions/ADR-*.md (detalhes ADR-NNNN)

Invariantes do sistema:
→ architecture/invariants.md

Contratos de integração:
→ contracts/api.md
→ contracts/database.md
→ contracts/rpc.md
→ contracts/events.md

Padrões de engenharia:
→ standards/coding-style.md
→ standards/testing.md
→ standards/security.md
→ standards/documentation.md
→ standards/git-workflow.md

Problemas conhecidos (KP-NNN):
→ memory/known-problems.md

Débitos técnicos (TD-NNN):
→ memory/technical-debt.md

Regressões de segurança (REG-NNN):
→ SECURITY.md (raiz do projeto)

Mapeamento de attack vectors:
→ HARDENING-ROADMAP.md (raiz do projeto)

Log de trabalho contínuo:
→ worklog.md (raiz do projeto)
```

---

## Manutenção deste arquivo

- Atualizar este snapshot **sempre que** o estado do projeto
  mudar (nova fase, novo FROZEN, mudança de stack, etc.).
- **Nunca** acumular histórico aqui. Toda mudança de estado deve
  ser registrada também em `memory/implementation-history.md`.
- **Nunca** listar roadmap ou decisões aqui — apenas referenciar.
- **Nunca** detalhar módulos FROZEN aqui — usar
  `architecture/frozen-files.md` como fonte.
- Bumpar a versão do Project OS **sempre que** a estrutura de
  `.ai/` mudar (com novo ADR em `decisions/ADR-NNNN.md`).
