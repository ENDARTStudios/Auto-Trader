# `context/project-summary.md` — Resumo do Projeto

> **STATE: FROZEN** — Identidade do projeto — mudança exige ADR.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Página única de contexto imutável. Objetivos, escopo,
> tecnologias, arquitetura em alto nível. Para detalhes, veja
> arquivos em `architecture/`, `contracts/`, `standards/`.

---

## O quê

**GLM 5.1 Crypto Trading** é um sistema de trading automatizado de
criptomoedas com detecção de scam multicamada, circuit breakers de
risco, isolamento defensivo do signer (processo separado), e
writer lease com fencing tokens (Kleppmann pattern).

## Por quê

Operar trading automatizado em cripto exige defesa em profundidade:
scam tokens são frequentes, contratos podem ser rug-pulled, RPCs
podem mentir, e chaves privadas são o ativo mais sensível. Sem
hardening explícito por camadas, qualquer bug em uma camada
compromete o sistema inteiro.

O projeto adota a filosofia **"hardening antes de features"**:
cada fase do roadmap (H0 → M5) valida invariantes de segurança
antes de avançar. Features de trading só são introduzidas após o
hardening da camada de chain estar completo.

## Para quem

- **Operador** (usuário único no estágio atual): configura,
  monitora, e decide ramp de canary em produção.
- **Auditores** (futuro): podem revisar ADRs, audit log, e
  SECURITY.md para validar que as garantias de segurança são reais.

## Stack

| Camada       | Tecnologia                                |
| ------------ | ----------------------------------------- |
| Web framework| Next.js 16 (App Router)                   |
| UI           | React 19 + Tailwind CSS 4 + shadcn/ui     |
| Linguagem    | TypeScript 5                              |
| ORM          | Prisma 5 + SQLite (dev) / Postgres (M6+)  |
| Blockchain   | ethers 6 (BSC mainnet primário)           |
| LLM          | z-ai-web-dev-sdk (GLM-4.6) p/ ScamDetector|
| Runtime      | Node.js 20+                               |
| Testing      | Vitest (unidade) + tsx scripts (adversarial) |

## Arquitetura em alto nível

```
┌─────────────────────────────────────────────────────┐
│                  Dashboard (React)                   │
│  positions | history | scam | rounds | logs | config │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP
                        ▼
┌─────────────────────────────────────────────────────┐
│              Next.js API Routes                      │
│  /api/status | /api/positions | /api/engine/* | ... │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│                  Engine (TS)                         │
│  SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBAL.│
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │ScamDetector │ │RiskManager  │ │ Portfolio    │  │
│  │  6 sub + LLM│ │  5 breakers │ │ split 50/50  │  │
│  └─────────────┘ └─────────────┘ └──────────────┘  │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              Pipeline (chain hardening)              │
│  H1.1 RPC → H1.2 Sim → H1.3 Approval → H1.4 MEV    │
│  → H2.1 Contract → H2.2 Liquidity → H2.3 Authority │
│  → H2.4 SellSim → H2.6 Pipeline composition        │
└───────────────────────┬─────────────────────────────┘
                        │
                        ▼
┌──────────────────────┐   IPC   ┌────────────────────┐
│  SignerAdapter M3.1  │◄───────►│  Signer RPC M3.2   │
│  (engine processo)   │         │  (processo isolado)│
└──────────┬───────────┘         │  segura chave      │
           │                     └────────────────────┘
           ▼
┌─────────────────────────────────────────────────────┐
│  WriterLease M4 (fencing) → LeasedBroadcaster       │
│  → Broadcaster M3.3 → RPC Quorum H1.1 → Blockchain │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│              Audit Log H0 (hash-chain)               │
│              Append-only, tamper-evident             │
└─────────────────────────────────────────────────────┘
```

## Escopo

### Incluído

- Engine de paper trading (modo default).
- Hardening completo H0 → M5 (6 sub-fases de M5 concluídas).
- Dashboard Next.js para monitoramento local.
- ScamDetector com LLM squad (GLM-4.6).
- 5 circuit breakers de risco.
- Split 50/50 (cold reserve / reinvest).

### Excluído (por design)

- Live trading real (requer M6 com Vault/KMS).
- Multi-chain (BSC only atualmente; M7+ para Base/Arbitrum/Optimism).
- Frontend mobile (dashboard é desktop-only).
- Auth multi-usuário (operador único atualmente).
- Backtesting (M11+ hipotético).
- Withdrawal automatizado (saída para cold wallet é manual).

## Modo padrão

**Paper trading:** todas as ordens são simuladas com slippage 0.3%.
Nenhuma tx real é enviada para a blockchain. Permite validação
completa do engine sem risco de fundos.

**Live trading (M6+):** txs reais enviadas via `canaryPct` ramp
(1% → 5% → 10% → 25% → 50% → 100%) com rollback automático em
detecção de regressão.

## Fase atual

**Pós-M5.** Hardening completo. Próximo milestone: M6 (Live Trading
com canaryPct ramp), condicionado a:

1. Operador configurar Vault/KMS para mnemonic.
2. Operador definir thresholds de rollback automáticos.
3. Operador confirmar rede (BSC mainnet) e funding inicial.

## Documentação canônica

- **Estado atual:** `.ai/PROJECT_STATE.md`
- **Regras absolutas:** `.ai/CORE_RULES.md`
- **Arquitetura detalhada:** `.ai/architecture/`
- **Contratos:** `.ai/contracts/`
- **Padrões:** `.ai/standards/`
- **Decisões:** `.ai/decisions/` (ADRs)
- **Histórico:** `.ai/memory/implementation-history.md`
- **Regressões de segurança:** `SECURITY.md` (raiz)
- **Roadmap canônico:** `HARDENING-ROADMAP.md` (raiz) +
  `.ai/architecture/roadmap.md`
- **Log multi-agente:** `worklog.md` (raiz)
