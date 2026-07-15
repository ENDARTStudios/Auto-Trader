# context/conventions.md — Padrões de Código

> Padrões de organização, nomenclatura e estrutura. Todo código novo
> deve seguir estas convenções. Em caso de conflito com código
> existente, o código existente vence (CORE_RULES Regra 5: reutilizar).

---

## Organização de diretórios

```
src/
├── app/                    # Next.js 16 App Router
│   ├── api/                # API routes (route.ts por endpoint)
│   │   ├── runtime/
│   │   │   └── status/
│   │   │       └── route.ts
│   │   ├── engine/
│   │   │   ├── start/route.ts
│   │   │   └── stop/route.ts
│   │   └── ...
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── ui/                 # shadcn/ui (40+ componentes)
│   └── dashboard/          # componentes específicos do dashboard
├── hooks/
│   ├── use-trading-data.ts
│   ├── use-event-stream.ts
│   ├── use-mobile.ts
│   └── use-toast.ts
├── lib/
│   ├── audit/              # H0.3 audit hash-chain
│   ├── chain/              # H1+H2+M3+M4 (hardening chain)
│   ├── observability/      # M5.5 metrics/registry/snapshot/exporter
│   ├── runtime/            # M5 sub-módulos (canary/shadow/chaos/long-duration)
│   ├── trading/            # engine de trading (paper mode default)
│   ├── signer-protocol.ts  # contrato IPC engine↔signer
│   ├── db.ts               # Prisma client
│   ├── crash-logger.ts
│   ├── csv-export.ts
│   ├── request-peer-als.ts
│   ├── request-peer-capture.ts
│   └── utils.ts
├── signer/                 # M3.2 processo signer isolado (FROZEN)
│   ├── main.ts
│   ├── wallet-methods.ts
│   ├── sign-methods.ts
│   └── audit.ts
└── instrumentation.ts      # Next.js instrumentation hook

prisma/
├── schema.prisma           # canônico
└── migrations/             # já aplicadas — não modificar

scripts/
├── test-h0-*.ts            # testes H0
├── test-h1-*.ts            # testes H1
├── test-h2-*.ts            # testes H2
├── test-m3-*.ts            # testes M3
├── test-m4-*.ts            # testes M4
├── test-m5-*.ts            # testes M5
└── (outros utilitários)

docs/
├── CRYPTO.md
└── signer-isolation-design.md

.ai/                       # Project OS (esta pasta)
```

---

## Nomenclatura

### Arquivos

- **kebab-case** para nomes de arquivo: `writer-lease.ts`,
  `leased-broadcaster.ts`, `rpc-resilience.ts`.
- **Sufixo `-panel`** para componentes de tab do dashboard:
  `market-panel.tsx`, `watchlist-panel.tsx`.
- **Sufixo `-table`** para tabelas: `positions-table.tsx`,
  `history-table.tsx`.
- **Prefixo `test-`** para scripts de teste: `test-m5-chaos.ts`,
  `test-h2-liquidity-verification.ts`.
- **Sufixo `Route`** para handlers de API: `runtimeStatusRoute`.

### Tipos / Interfaces / Classes

- **PascalCase** para tipos, interfaces, classes, enums:
  `WriterLease`, `LeaseStore`, `PipelineResult`, `FencingToken`.
- **`I` prefix proibido.** Não usar `IWriterLease` — usar
  `WriterLease` para interface e `WriterLeaseImpl` se precisar de
  classe concreta.
- Sufixo `Result` para tipos de retorno de operações:
  `PipelineResult`, `BroadcastResult`, `LeaseOpResult`.
- Sufixo `Error` para tipos de erro: `LeaseError`, `BroadcastError`.
- Sufixo `Report` para resultados de gates: `ContractReport`,
  `LiquidityReport`, `AuthorityReport`.

### Funções

- **camelCase** para funções e métodos: `buildRuntime()`,
  `verifyToken()`, `acquireLease()`.
- **Prefixo `build`** para factories: `buildRuntime()`,
  `buildLeaseKey()`.
- **Prefixo `generate`** para geradores de IDs únicos:
  `generateOwnerId()`.
- **Prefixo `inject`** para métodos de test harness que injetam
  falhas: `injectFailure()` em `InMemoryLeaseStore`.
- Verbos booleans: `isFrozen`, `hasLease`, `canBroadcast`.

### Constantes

- **UPPER_SNAKE_CASE** para constantes de módulo:
  `DEFAULT_CANARY_PCT = 5`, `MAX_LEASE_DURATION_MS = 30000`.
- **PascalCase** para enums: `LeaseOpResult.ACQUIRE_OK`,
  `BroadcastError.BROADCAST_SIGNER_TIMEOUT`.

### Variáveis

- **camelCase** para variáveis locais e parâmetros.
- **Prefixo `_`** para parâmetros não usados: `(_req, res) => ...`.

---

## Estrutura de código

### Imports

Ordem obrigatória:

1. Imports de pacotes externos (`next`, `react`, `ethers`, `@prisma/client`).
2. Imports internos absolutos (`@/lib/...`, `@/components/...`).
3. Imports relativos (`./foo`, `../bar`).
4. Type-only imports no final (`import type { ... }`).

Entre grupos, linha em branco. Dentro de grupo, ordem alfabética.

### Exportações

- **Named exports preferidos.** Evitar `export default` (dificulta
  refactor e IDE navigation).
- **Barrel files proibidos** salvo necessidade: cada arquivo
  importa diretamente do arquivo fonte.
- **Re-export proibido** em código de produção (permitido em
  scripts de teste para reduzir boilerplate).

### Error handling

- **Erros são strings prefixadas**, não subclasses de `Error`, para
  facilitar serialização em IPC e classificação por prefixo:
  `"BROADCAST_SIGNER_TIMEOUT"`, `"LEASE_BUSY"`,
  `"FENCING_TOKEN_STALE"`.
- **`try/catch`** sempre que há I/O (RPC, IPC, disk). Nunca deixar
  erro escapar silenciosamente para o caller sem classificação.
- **`throw new Error(string)`** apenas em código de inicialização
  (load de config, init de signer). No hot path, retornar
  `Result`-like com error field.

### Async/await

- **`async/await`** sempre que possível. Evitar `.then()/.catch()`
  chains.
- **`Promise.all`** para paralelismo independente. Evitar
  `Promise.race` salvo em timeout patterns.
- **`AbortController`** para cancelamento. Não usar `setTimeout` +
  `clearTimeout` para cancelar fetch.

### Tipagem

- **`strict: true`** em `tsconfig.json`. Sem `any` em código de
  produção (uso permitido em scripts de teste).
- **`unknown`** preferido a `any` quando o tipo é desconhecido em
  runtime; narrow com type guard.
- **`satisfies`** para validar shape sem widening:
  `const config = { ... } satisfies RuntimeConfig`.
- **`as`** apenas em testes ou pontes de IPC; nunca para "silenciar"
  erro de tipo.

---

## Convenções específicas

### API routes (Next.js 16 App Router)

```typescript
// src/app/api/<resource>/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // ...
  return NextResponse.json({ ... });
}

export async function POST(req: NextRequest) {
  // ...
  return NextResponse.json({ ... }, { status: 201 });
}
```

- **Read-only endpoints** (`/api/runtime/status`, `/api/positions`,
  etc.) só implementam `GET`.
- **Action endpoints** (`/api/engine/start`, `/api/kill-switch`)
  só implementam `POST` (não `PUT`/`PATCH` — actions não são
  idempotentes no sentido REST).
- **Sem `DELETE`** para soft-delete; usar POST com flag.

### Prisma

- **Schema primeiro.** Toda mudança no banco começa em
  `prisma/schema.prisma` seguido de `npx prisma migrate dev --name
  <description>`.
- **Migrations já aplicadas não são modificadas.** Nova migration
  para corrigir.
- **`@map`** para snake_case em colunas (preserva compatibilidade
  com SQL existente).

### Testes

- **Scripts em `scripts/test-*.ts`**, executados via
  `npx tsx scripts/test-<name>.ts`.
- **Cada teste é uma função `async function testX(): Promise<void>`**
  que lança em caso de falha.
- **Main runner** no final do arquivo:
  ```typescript
  async function main() {
    await testA();
    await testB();
    // ...
    console.log("ALL PASS");
  }
  main().catch((e) => { console.error(e); process.exit(1); });
  ```
- **Sem framework de teste** (jest/vitest) — pattern simples com
  try/catch e contador.
- **Testes adversariais** obrigatórios para primitivos de
  segurança (ver `ENGINEERING_RULES.md`).

### UI Components

- **shadcn/ui** para componentes base (`Button`, `Card`, `Dialog`,
  `Table`, etc.).
- **Custom components em `src/components/dashboard/`** com sufixo
  apropriado (`-panel`, `-table`, `-card`).
- **Props tipadas** com interface exportada.
- **Sem CSS inline** — usar Tailwind classes.

---

## Comentários

- **Comentários explicam o PORQUÊ, não o O QUÊ.** O código diz o
  que; o comentário diz por que.
- **`// TODO:`** proibido em produção. Criar entrada em
  `memory/technical-debt.md` ou `memory/future-ideas.md` e
  referenciar o ID.
- **JSDoc** para APIs públicas de módulos exportados.
- **`// REG-NNN:`** para marcar invariantes de segurança
  referenciados em `SECURITY.md`.

---

## Commits (quando git for usado)

- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `test:`,
  `docs:`, `chore:`, `harden:` (custom para hardening roadmap).
- **Scope opcional:** `feat(trading):`, `fix(chain):`,
  `harden(m4):`.
- **Mensagem descritiva** no corpo do commit, não só no título.
- **Referenciar REG-NNN ou DEC-NNN** quando aplicável.

---

## LGTM checklist (antes de marcar tarefa completa)

- [ ] `tsc --noEmit` passa sem erros.
- [ ] `eslint` passa sem novos warnings.
- [ ] Testes do módulo afetado passam.
- [ ] Nenhum teste de regressão (REG-NNN) quebrou.
- [ ] `worklog.md` atualizado.
- [ ] Se tocado arquivo FROZEN: entrada em `DECISION_LOG.md` +
  autorização explícita do operador.
- [ ] Se introduziu primitivo de segurança: teste adversarial
  REG-NNN em `SECURITY.md`.
- [ ] Se mudou estado do projeto: `PROJECT_STATE.md` atualizado.
- [ ] Se decisão arquitetural: `DECISION_LOG.md` (e/ou ADR) criado.
- [ ] Sem `TODO`, `FIXME`, ou `console.log` em produção.
