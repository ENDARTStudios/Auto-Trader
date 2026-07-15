# `context/conventions.md` — Convenções do Projeto

> **STATE: ACTIVE** — Convenções evoluem com o código.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Padrões de nomenclatura, estrutura de pastas, convenções de
> commits, formato de logs, e outras convenções operacionais.
> Para estilo de código detalhado, ver `standards/coding-style.md`.
> Para git workflow, ver `standards/git-workflow.md`.

---

## Nomenclatura

### Arquivos

| Tipo                    | Padrão                          | Exemplo                              |
| ----------------------- | ------------------------------- | ------------------------------------ |
| Módulo TS               | kebab-case                      | `writer-lease.ts`                    |
| Componente React        | PascalCase.tsx                  | `PositionsTable.tsx`                 |
| Teste de unidade        | `<module>.test.ts`              | `writer-lease.test.ts`               |
| Teste adversarial       | `test-<fase>-<nome>.ts`         | `test-m4-writer-lease.ts`            |
| Script utilitário       | kebab-case ou `run-<verb>.ts`   | `run-migrations.ts`                  |
| Doc Markdown            | kebab-case ou UPPER_SNAKE       | `project-summary.md`, `CORE_RULES.md`|
| ADR                     | `ADR-NNNN.md` (4 dígitos)       | `ADR-0001.md`                        |

### Pastas

| Tipo                | Padrão                          | Exemplo                              |
| ------------------- | ------------------------------- | ------------------------------------ |
| Pasta de módulo     | kebab-case                      | `src/lib/chain/`                     |
| Pasta de componente | kebab-case (sub de components/) | `src/components/dashboard/`          |
| Pasta de API route  | nome da rota                    | `src/app/api/engine/start/`          |
| Pasta de ADR        | `decisions/`                    | `.ai/decisions/`                     |

### Identificadores em código

| Tipo                | Padrão                          | Exemplo                              |
| ------------------- | ------------------------------- | ------------------------------------ |
| Variável / função   | camelCase                       | `txHash`, `processTransaction`       |
| Constante imutável  | SCREAMING_SNAKE_CASE            | `MAX_RETRIES`, `DEFAULT_SLIPPAGE`    |
| Tipo / Interface    | PascalCase                      | `PipelineInput`, `LeaseToken`        |
| Enum                | PascalCase + members PascalCase | `enum Status { Open, Closed }`       |
| Classe              | PascalCase                      | `class SignerAdapter`                |
| Private (convention)| `_` prefix ou `#` (true private)| `_internalState`, `#secretKey`       |

### Erros e códigos

| Tipo                | Padrão                          | Exemplo                              |
| ------------------- | ------------------------------- | ------------------------------------ |
| Error class         | PascalCase + `Error` suffix     | `PipelineError`, `LeaseBusyError`    |
| Error code          | `<MODULE>_<REASON>` UPPER       | `SIM_REJECT`, `LEASE_BUSY`           |
| Audit event type    | `MODULE_EVENT` UPPER            | `PIPELINE_START`, `BROADCAST_RESULT` |
| Log level           | lowercase                       | `info`, `warn`, `error`              |
| Metric name         | `module_action_unit` snake      | `broadcast_latency_ms`, `tx_total`   |
| Label name          | lowercase, no underscore        | `routed`, `endpoint`, `bucket`       |

### Conventional Commits (resumo)

Ver `standards/git-workflow.md` para detalhes completos.

```
<type>(<scope>): <description>

types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
scopes: audit, chain, signer, runtime, observability, trading, api, ui, docs, prisma, deps, ci
```

---

## Estrutura de pastas (resumo)

```
/home/z/my-project/
│
├── .ai/                          # Governance layer (este diretório)
│   ├── INDEX.md
│   ├── README.md
│   ├── CORE_RULES.md
│   ├── ENGINEERING_RULES.md
│   ├── PROMPTING_RULES.md
│   ├── OUTPUT_RULES.md
│   ├── PROJECT_STATE.md
│   ├── DECISION_LOG.md
│   ├── TASK_TEMPLATE.md
│   ├── architecture/             # 7 arquivos
│   ├── contracts/                # 4 arquivos
│   ├── standards/                # 5 arquivos
│   ├── context/                  # 4 arquivos
│   ├── memory/                   # 4 arquivos
│   └── decisions/                # ADRs
│
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── api/                  # Route handlers
│   │   ├── dashboard/            # Páginas
│   │   └── layout.tsx
│   ├── components/
│   │   ├── dashboard/
│   │   └── ui/                   # shadcn/ui
│   ├── lib/
│   │   ├── audit/                # H0
│   │   ├── chain/                # H1, H2, M3, M4 (FROZEN)
│   │   ├── observability/        # M5.5
│   │   ├── runtime/              # M5.0-M5.6
│   │   ├── trading/              # Camada de trading
│   │   ├── db.ts                 # Prisma client singleton
│   │   └── signer-protocol.ts    # M3.2 IPC (FROZEN)
│   ├── signer/                   # M3.2 processo isolado
│   └── types/                    # Tipos globais
│
├── prisma/
│   ├── schema.prisma             # Schema canônico
│   ├── migrations/               # Prisma migrations
│   └── dev.db                    # SQLite (dev only)
│
├── scripts/                      # Scripts de teste e utilitários
│   ├── test-h0-*.ts
│   ├── test-h1-*.ts
│   ├── ...
│   ├── test-m5-*.ts
│   └── run-*.ts                  # Scripts não-teste
│
├── docs/                         # Design docs
│   ├── signer-isolation-design.md
│   └── CRYPTO.md
│
├── README.md                     # Visão geral do projeto
├── SECURITY.md                   # Regressões REG-NNN
├── HARDENING-ROADMAP.md          # Roadmap canônico
├── worklog.md                    # Log multi-agente
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
└── .env.local                    # Segredos (gitignored)
```

---

## Logs

### Níveis

| Nível   | Uso                                                      |
| ------- | -------------------------------------------------------- |
| `debug` | Detalhe interno para troubleshooting. Off em produção.  |
| `info`  | Eventos normais (tx confirmed, lease acquired).         |
| `warn`  | Anomalias recuperáveis (RPC fallback, lease stolen).    |
| `error` | Falhas que requerem intervenção (signer crash, DB error).|

### Formato

Estruturado (JSON), via `Logger` em `src/lib/trading/logger.ts`:

```json
{
  "level": "info",
  "message": "tx confirmed",
  "timestamp": "2026-07-15T15:30:00.000Z",
  "metadata": {
    "txHash": "0x...",
    "auditId": "audit_xyz",
    "latencyMs": 1234
  }
}
```

### Regras

- **Nunca** `console.log` em produção (use `Logger`).
- **Nunca** logar segredos (mnemonic, API key, private key).
- **Sempre** incluir `auditId` quando aplicável (correlação com
  audit log H0).
- **Sempre** logar em UTC (ISO 8601).

---

## Métricas

### Naming

| Tipo       | Padrão                          | Exemplo                              |
| ---------- | ------------------------------- | ------------------------------------ |
| Counter    | `<module>_<noun>_total`         | `tx_total`, `broadcast_attempt_total`|
| Gauge      | `<module>_<noun>` (sem `_total`)| `active_leases`, `heap_used_mb`      |
| Histogram  | `<module>_<noun>_<unit>`        | `broadcast_latency_ms`, `tick_duration_ms` |

### Labels

- **Lowercase** sem underscore (ex.: `routed`, não `routed_type`).
- **Cardinality baixa** (máx ~10 valores distintos por label).
  Evitar label `txHash` (high cardinality explode o Registry).
- **Boolean como label** com valor `"true"`/`"false"`.

---

## Horários e timestamps

- **Storage:** unix milliseconds (number) em DB e audit log.
- **Display:** ISO 8601 UTC (`2026-07-15T15:30:00.000Z`).
- **Logs:** ISO 8601 UTC.
- **Dashboard:** converter para timezone do operador (America/Sao_Paulo).

---

## Encoding e unidades

| Tipo            | Convenção                                                |
| --------------- | -------------------------------------------------------- |
| Endereço ETH    | lowercase hex com `0x` prefix (checksum em UI apenas)    |
| Hash ETH        | lowercase hex com `0x` prefix, 64 chars                  |
| Amount (wei)    | string de decimal sem sinal (Prisma não suporta bigint)  |
| Amount (USDC)   | string de decimal com 6 casas (1 USDC = "1000000")       |
| Gas price       | string de decimal em wei (ex.: "20000000000" = 20 gwei)  |
| Percentage      | float 0-1 (não 0-100); ex.: 0.05 = 5%                    |
| Bps (basis pts) | int 0-10000; ex.: 30 = 0.3%                              |
| Latência        | int em milliseconds                                      |

---

## Internacionalização

- **Documentação `.ai/`:** Português (PT-BR).
- **Code comments / JSDoc:** Inglês.
- **Mensagens de commit:** Inglês (Conventional Commits).
- **Mensagens de erro:** Inglês (stack traces consistentes).
- **Logs:** Inglês (compatibilidade com tooling externo).
- **Dashboard:** Inglês (labels e botões) por enquanto; i18n é
  M11+ hipotético.

Ver `standards/documentation.md` > Idioma para detalhes.

---

## Convenções operacionais

### Variáveis de ambiente

| Var                  | Uso                                              | Default                |
| -------------------- | ------------------------------------------------ | ---------------------- |
| `DATABASE_URL`       | Prisma connection string                         | `file:./prisma/dev.db` |
| `SIGNER_MNEMONIC`    | Mnemonic do signer (dev only; M6+ usa Vault)     | (none)                 |
| `BSC_RPC_URL`        | RPC endpoint BSC mainnet primário                | (required)             |
| `BSC_RPC_URL_BACKUP` | RPC endpoint BSC fallback                        | (none)                 |
| `BINANCE_API_KEY`    | Binance REST API key (para CEX price feed)       | (none)                 |
| `BINANCE_API_SECRET` | Binance REST API secret                          | (none)                 |
| `NODE_ENV`           | `development` ou `production`                    | `development`          |
| `PORT`               | Porta do Next.js server                          | `3000`                 |

### Portas

| Porta | Uso                                              |
| ----- | ------------------------------------------------ |
| 3000  | Next.js dev server                               |
| 8545  | Anvil (fork BSC, em testes de integração)        |
| 5432  | Postgres (M6+ quando migrar de SQLite)           |
| 8200  | Vault dev server (M6+)                           |

### File paths

- **Scripts persistentes:** sempre em `/home/z/my-project/scripts/`.
- **Downloads/entregas:** sempre em `/home/z/my-project/download/`.
- **Logs runtime:** via Prisma `AppLog` table, não filesystem.
- **Audit log:** via Prisma `AuditLog` table (a criar; atualmente
  in-memory + JSON file).

---

## Relacionado

- `context/terminology.md` — nomes oficiais usados nas convenções.
- `standards/coding-style.md` STD-001, STD-008 — convenções de código.
- `standards/git-workflow.md` STD-402 — convenções de branch.
- `architecture/modules.md` — aplicação das convenções aos módulos.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

