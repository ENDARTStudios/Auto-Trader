# `contracts/database-contracts.md` — Schema Prisma

> **STATE: FROZEN** — Schema Prisma — migrations reversíveis apenas.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Contrato canônico do banco de dados. Fonte de verdade é
> `prisma/schema.prisma`. Este documento é espelho legível + regras
> de evolução. Antes de alterar qualquer model, consultar este
> arquivo e o `schema.prisma` real.

---

## Models canônicos

### `Config`

Armazena configuração do engine (defaults + overrides).

```prisma
model Config {
  id           String   @id @default("default")
  paperMode    Boolean  @default(true)
  canaryPct    Int      @default(0)
  slippageBps  Int      @default(30)
  stopLossPct  Float    @default(0.10)
  takeProfitPct Float   @default(0.20)
  maxExposure  Float    @default(0.05)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

**Invariantes:**

- `id` é sempre `"default"` (singleton).
- `paperMode = true` em produção sem Vault/KMS configurado.
- `canaryPct` no range [0, 100].

### `Position`

Posição aberta ou fechada no portfólio.

```prisma
model Position {
  id           String   @id @default(cuid())
  token        String
  amount       String   // bigint as string (Prisma não suporta bigint nativo)
  entryPrice   Float
  exitPrice    Float?
  stopLoss     Float
  takeProfit   Float
  status       String   @default("open")  // open | closed | reverted
  openedAt     DateTime @default(now())
  closedAt     DateTime?
  txHashEntry  String?
  txHashExit   String?
  auditIdEntry String?
  auditIdExit  String?
  roundId      String?

  @@index([token])
  @@index([status])
  @@index([openedAt])
}
```

**Invariantes:**

- `amount` é string de inteiro sem sinal (wei units).
- `status = "closed"` exige `exitPrice` e `closedAt` preenchidos.
- `txHashEntry` e `txHashExit` são hash da tx on-chain (quando
  aplicável; null em paper mode).

### `Reserve`

Reserva USDC cold (split 50/50).

```prisma
model Reserve {
  id           String   @id @default("default")
  balanceUsdc  String   // bigint as string
  targetPct    Float    @default(0.50)  // 50% cold reserve
  updatedAt    DateTime @updatedAt
}
```

### `TradingBalance`

Saldo trading (a outra metade do split 50/50).

```prisma
model TradingBalance {
  id           String   @id @default("default")
  balanceUsdc  String   // bigint as string
  updatedAt    DateTime @updatedAt
}
```

### `RiskEvent`

Evento disparado pelos 5 circuit breakers do RiskManager.

```prisma
model RiskEvent {
  id           String   @id @default(cuid())
  breakerType  String   // kill_switch | daily_loss | per_trade | exposure | drawdown
  severity     String   // info | warn | critical
  message      String
  triggeredAt  DateTime @default(now())
  metadata     String?  // JSON stringified

  @@index([breakerType])
  @@index([triggeredAt])
}
```

### `ScamReport`

Relatório de ScamDetector para um token.

```prisma
model ScamReport {
  id           String   @id @default(cuid())
  token        String
  score        Int      // 0-100, higher = more scammy
  subScores    String   // JSON: { honeypot, liquidity, audit, tax, holders, age }
  llmVerdict   String?  // veredito do LLM squad (GLM-4.6)
  generatedAt  DateTime @default(now())

  @@index([token])
  @@index([score])
}
```

### `Round`

Ciclo completo do engine (SCOUT → ANALYZE → EXECUTE → MONITOR →
EXIT → REBALANCE).

```prisma
model Round {
  id           String   @id @default(cuid())
  startedAt    DateTime @default(now())
  endedAt      DateTime?
  state        String   // scout | analyze | execute | monitor | exit | rebalance
  positionId   String?

  @@index([startedAt])
}
```

### `AppLog`

Log persistente (além do audit hash-chain H0). Para queries de
debug e dashboard.

```prisma
model AppLog {
  id           Int      @id @default(autoincrement())
  level        String   // debug | info | warn | error
  message      String
  metadata     String?  // JSON stringified
  timestamp    DateTime @default(now())

  @@index([level])
  @@index([timestamp])
}
```

---

## Invariantes de banco (não checados por schema)

| Invariante                                                  | Onde checado             |
| ----------------------------------------------------------- | ------------------------ |
| `Position.amount` > 0                                       | App-level (zod)          |
| `Position.exitPrice` > 0 quando `status = "closed"`         | App-level                |
| `Reserve.balanceUsdc + TradingBalance.balanceUsdc` = total  | App-level (split 50/50)  |
| `Config.canaryPct` ∈ [0, 100]                               | App-level (zod)          |
| `ScamReport.score` ∈ [0, 100]                               | App-level (ScamDetector) |
| `RiskEvent.breakerType` ∈ enum                              | App-level (TS union)     |

---

## Regras de migração

1. **Migrations via Prisma Migrate:** `npx prisma migrate dev --name <desc>`.
   NUNCA editar migration já aplicada — criar nova migration.
2. **Schema changes additive:** preferir adicionar campo opcional
   (`String?`) sobre tornar obrigatório. Breaking changes requerem
   DEC-NNN.
3. **Renomear campo:** breaking change — criar campo novo, migrar
   dados, marcar campo antigo como deprecated, remover após período
   de grace.
4. **Remover model:** breaking change — primeiro marcar como
   deprecated, aguardar período de grace, remover.
5. **Toda migration DEVE ser testada** com `npx prisma migrate dev`
   em ambiente de desenvolvimento antes de aplicar em produção.

---

## Backup e restore

- **Backup:** SQLite arquivo único em `prisma/dev.db` (dev) ou
  path configurado em produção. Backup = `cp` do arquivo.
- **Restore:** substituir arquivo e restart do engine.
- **Em M6+ (produção):** migrar para Postgres; backup via
  `pg_dump` automático diário.

---

## Tabelas futuras (não implementadas)

> Listadas para planejamento. Implementação depende de M7+.

- `OrderBook` — ordens limite pendentes (M7 multi-chain).
- `VaultConfig` — configuração do Vault/KMS (M6 live trading).
- `CanaryEvent` — eventos de ramp/rollback do canary (M6).
- `Alert` — alertas disparados por thresholds (M6 monitoring).

---

## Relacionado

- `contracts/events.md` — eventos que tocam estas tabelas.
- `architecture/invariants.md` INV-005 — audit exactly-once (AuditLog table).
- `standards/security.md` STD-202 — segredos não são armazenados em banco.
- `CORE_RULES.md` Regra 9 — schema changes são breaking changes.
- `memory/technical-debt.md` TD-003 — possível migração SQLite → Postgres.
- `prisma/schema.prisma` (raiz do projeto) — fonte canônica do schema.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

