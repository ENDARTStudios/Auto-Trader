# context/project-summary.md — Resumo do Projeto

> Snapshot atualizado do projeto. Objetivos, escopo, tecnologias,
> arquitetura. Atualizar quando o escopo mudar; nunca apagar histórico
> (append novas versões datadas no final).

---

## Visão de uma linha

Sistema de **trading autônomo de criptomoedas em paper mode default**,
com camada de hardening defense-in-depth (H0 → M5 concluído) que o
prepara para eventual live trading via canary ramp.

---

## Objetivos

1. **Scam-resistance, não "100% seguro".** O sistema deve resistir a
   padrões conhecidos de scam (honeypot, LP rug, mint authority rug,
   proxy oculto, contrato não-verificado) e a vetores de ataque na
   camada de chain (RPC poisoning, MEV sandwich, approval ilimitado,
   revert de broadcast, stale writer).
2. **Audit trail completo.** Toda decisão de trading, toda tx
   broadcastada, toda assinatura, todo gate reject é registrado em
   audit log append-only com hash-chain determinística.
3. **Defense-in-depth.** Múltiplas camadas independentes (gates H1+H2,
   signer isolado, writer lease com fencing tokens, observability) —
   falha de uma camada não derruba o sistema.
4. **Paper mode default.** Live trading só via canary ramp explícita
   com rollback automático. Operador nunca perde o controle.
5. **100% open-source / free tier.** Binance REST, DexScreener,
   GoPlus, alternative.me, CoinGecko, Etherscan — todas APIs
   gratuitas. LLM via z-ai-web-dev-sdk.

---

## Escopo

### Dentro do escopo

- Engine de trading autônomo (scout → analyze → execute → monitor →
  exit → rebalance).
- Scam detection multicamada: regex + Etherscan + GoPlus + market TA
  + AI LLM squad (thesis + contract auditor + news/sentiment) com
  consensus veto.
- Risk management com 5 circuit breakers: kill switch, daily loss,
  per-trade loss, exposure per token, drawdown.
- Portfolio com split 50/50 (50% USDC cold reserve, 50% reinvestido).
- Watchlist e platform scanner (multi-DEX).
- Hardening roadmap H0–M5 (ver `architecture/roadmap.md`).
- Dashboard Next.js com 16+ tabs (Posições, Histórico, Mercado, AI
  Agents, Scam Audit, Site Audit, Rounds, Logs, Vigilância, etc.).

### Fora do escopo

- Live trading real (M6 — proposto, não iniciado). Atualmente paper
  mode default; live é stub.
- Multi-chain (M7 — proposto). Atualmente BSC mainnet.
- Compliance AML/KYC (responsabilidade do operador).
- Custody de fundos (operador mantém custódia; app não é custodial).
- "Irrastreável" (incompatível com AML/KYC — removido do escopo
  original em negociação com o operador).

---

## Tecnologias

| Camada           | Tecnologia                                            |
| ---------------- | ----------------------------------------------------- |
| Frontend         | Next.js 16 (App Router), React 19, TypeScript         |
| UI               | Tailwind CSS, shadcn/ui (40+ componentes)             |
| Backend          | Next.js API Routes (Route Handlers)                   |
| ORM              | Prisma                                                |
| Banco            | SQLite (`prisma/dev.db`) — produção: Postgres recomendado |
| Runtime          | Node.js                                               |
| EVM              | ethers.js (`JsonRpcProvider`)                         |
| WebSocket        | Next.js SSE (`/api/stream`)                           |
| LLM              | z-ai-web-dev-sdk (thesis, contract auditor, news)     |
| API market data  | Binance REST, DexScreener, GoPlus, alternative.me, CoinGecko, Etherscan |
| Dev server       | `next dev` porta 3000                                 |
| Proxy externo    | Caddy (`Caddyfile`)                                   |
| Build            | `next build`, `tsc --noEmit`, `eslint`                |

---

## Arquitetura (resumo)

Ver `architecture/modules.md`, `architecture/dependencies.md`,
`architecture/runtime.md` para detalhes.

```
Market Data → Pipeline (H2.6, 7 gates) → SignerAdapter (M3.1)
   → Signer RPC (M3.2, processo isolado) → Writer Lease (M4, fencing)
   → LeasedBroadcaster (M4, pre-broadcast verify) → Broadcaster (M3.3)
   → RPC Quorum (H1.1) → Blockchain

Em paralelo: Registry único (M5.5) alimenta /api/runtime/status.
Canário (M5.3): bucket = keccak256(txHash) % 100; bucket < canaryPct.
Shadow (M5.2): mesma Pipeline, fork output, compara, incrementa shadowDiffs.
Long-Duration (M5.6): while(running) { tick(); sleep(); }.
```

---

## Modos de operação

| Modo            | Descrição                                           | Como ativar                          |
| --------------- | --------------------------------------------------- | ------------------------------------ |
| Paper (default) | Tx são simuladas; nada vai on-chain.               | Default; `Config.paperMode = true`. |
| Live canário    | Tx reais, apenas `bucket < canaryPct` da txHash.   | M6 (não iniciado); via `setCanaryPct`. |
| Kill switch     | Toda atividade de trading para imediatamente.      | `/api/kill-switch` ou botão no dashboard. |

---

## Estado do hardening (2026-07-15)

- ✅ H0, H1, H2, H2.6, M3.1, M3.2, M3.3, M4 — todas as fases de
  hardening concluídas e FROZEN (exceto exceção M5.4 em
  `broadcaster.ts`).
- ✅ M5 (Production Validation) — todas as 7 sub-fases validadas, 0
  regressões H0–M4.
- ⏳ M6 (Live Trading canaryPct ramp) — proposto, não iniciado.

---

## Documentação complementar

- `/home/z/my-project/README.md` — README do projeto (visão geral).
- `/home/z/my-project/SECURITY.md` — regressões REG-NNN.
- `/home/z/my-project/HARDENING-ROADMAP.md` — roadmap canônico de
  hardening (mapeia 30 attack vectors).
- `/home/z/my-project/docs/signer-isolation-design.md` — design do
  isolamento do signer.
- `/home/z/my-project/docs/CRYPTO.md` — documentação crypto.

---

## Histórico de versões deste resumo (append-only)

### 2026-07-15 — Versão inicial (Project OS expansion)

- Criado durante a expansão `.ai/` para Project Operating System.
- Reflete estado pós-M5 (todas as fases de hardening concluídas).
- Próximo milestone proposto: M6 Live Trading.

### [Versões futuras vêm aqui — nunca sobrescrever acima]
