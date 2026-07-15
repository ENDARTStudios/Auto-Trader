# `standards/coding-style.md` — Estilo de Código

> **STATE: ACTIVE** — Padrões de estilo — refináveis com novas lições.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Regras detalhadas de estilo. `ENGINEERING_RULES.md` é o resumo
> executivo; este arquivo é a referência completa. Aplica-se a
> TypeScript, React (TSX) e scripts Node.
>
> **IDs canônicos:** STD-001 a STD-009 (ver `MANIFEST.md` para a
> tabela completa de prefixos).

---

## TypeScript

### STD-001 — Naming conventions

| Tipo                  | Convenção             | Exemplo                              |
| --------------------- | --------------------- | ------------------------------------ |
| Variável / função     | camelCase             | `processTransaction`, `txHash`       |
| Constante (imutável)  | SCREAMING_SNAKE_CASE  | `MAX_RETRIES`, `DEFAULT_SLIPPAGE`    |
| Tipo / Interface      | PascalCase            | `PipelineInput`, `LeaseToken`        |
| Enum                  | PascalCase + members  | `enum Status { Open, Closed }`       |
| Classe                | PascalCase            | `class SignerAdapter`                |
| Arquivo (módulo)      | kebab-case            | `writer-lease.ts`, `signer-adapter.ts`|
| Arquivo (componente)  | PascalCase            | `PositionsTable.tsx`                 |
| Arquivo (rota API)    | convenção Next.js     | `route.ts` em pasta `routename/`     |
| Arquivo (test)        | `<name>.test.ts`      | `audit-log.test.ts`                  |
| Arquivo (harness)     | `test-<name>.ts`      | `test-m5-chaos.ts`                   |

### STD-002 — Tipos

- **Sempre tipar** parâmetros de função e retorno. Usar
  `unknown` em vez de `any` quando o tipo é realmente desconhecido.
- **`any` é proibido** em código de produção. ESLint deve rejeitar.
  Exceção: tipos de dependências externas sem type definitions.
- **`as` cast** é permitido apenas após validação com `zod` ou
  `typeof`/`instanceof`. Cast cego sem validação é proibido.
- **`!` non-null assertion** é permitido apenas após `if (x !== null)`
  explícito. Não usar para "eu sei que não é null".

### STD-003 — Imports

```typescript
// ✅ Ordem: (1) node builtins, (2) external packages, (3) internal alias, (4) relative
import { readFile } from 'node:fs/promises';        // 1
import { ethers } from 'ethers';                     // 2
import { prisma } from '@/lib/db';                   // 3 (@/ alias)
import { AuditLog } from '../../audit/audit-log';    // 4 (relative)

// ✅ Named imports, nunca default import quando há named exports
import { Counter, Gauge } from '@/lib/observability/metrics';

// ❌ Proibido: import * as Foo (exceto para namespaces explícitos)
```

### STD-004 — Async/await

- **Sempre** preferir `async/await` sobre `.then()`/`.catch()`.
- **Nunca** async function sem await (ESLint deve warn).
- **Try/catch** em todo async boundary externo (RPC, IPC, DB).
  Erro não tratado em Promise rejeitada = unhandled rejection =
  crash do processo.

### STD-005 — Error handling (preserva cause — INV-004)

```typescript
// ✅ Custom errors com code
class PipelineError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
    public cause?: unknown
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

// ✅ Preservar cause (INV-004)
throw new PipelineError('SIM_REJECT', 'simulation reverted', { gasEstimate }, originalError);

// ❌ Proibido: throw new Error('string') em módulos de chain
// ❌ Proibido: console.log(error) — usar logger estruturado
```

### STD-006 — Format

- **Indentação:** 2 espaços (não tabs).
- **Line length:** 120 chars máximo (ESLint enforce).
- **Semicolons:** sempre.
- **Quotes:** single quote para strings; backtick para template
  literals; double quote apenas dentro de JSX.
- **Trailing comma:** sempre em multiline (facilita diff).

---

## React / TSX

### STD-007 — Componentes

```typescript
// ✅ Function component com tipo explícito
export function PositionsTable({ positions }: PositionsTableProps) {
  // ...
}

interface PositionsTableProps {
  positions: Position[];
  onSelect?: (id: string) => void;
}

// ❌ Proibido: React.FC (deprecated pattern, causa problemas com children)
// ❌ Proibido: class components (exceto ErrorBoundary, única exceção)
```

### STD-007.1 — Hooks

- **Naming:** `useXxx` (ex.: `usePositions`, `useEngineStatus`).
- **Sempre** tipar retorno: `function useXxx(): ReturnType`.
- **Dep array:** preencher corretamente. Usar `eslint-plugin-react-hooks`
  exhaustive-deps.

### STD-007.2 — Estado

- **Estado local:** `useState`.
- **Estado compartilhado entre componentes irmãos:** lift up para
  parent comum.
- **Estado global (cross-page):** Zustand ou React Context.
  - Zustand preferido para alta frequência (ex.: logs feed).
  - Context preferido para baixa frequência (ex.: user session).

### STD-007.3 — Styling

- **Tailwind CSS 4** é o padrão. Sem CSS modules, sem styled-components.
- **shadcn/ui** para componentes base (Button, Dialog, Table, etc.).
- **Dark mode:** preferido. Light mode é opt-in.

---

## STD-008 — Estrutura de pastas

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # Route handlers
│   │   ├── status/route.ts
│   │   ├── engine/start/route.ts
│   │   └── ...
│   ├── dashboard/page.tsx
│   └── layout.tsx
├── components/
│   ├── dashboard/              # Componentes de dashboard
│   └── ui/                     # shadcn/ui components
├── lib/
│   ├── audit/                  # H0 audit hash-chain
│   ├── chain/                  # H1, H2, M3, M4 (hardening)
│   ├── observability/          # M5.5 Registry
│   ├── runtime/                # M5.0-M5.6 runtime + harnesses
│   ├── trading/                # Camada de trading (não-hardening)
│   ├── db.ts                   # Prisma client singleton
│   └── signer-protocol.ts      # M3.2 IPC protocol (FROZEN)
├── signer/                     # M3.2 processo signer isolado
│   ├── main.ts
│   ├── wallet-methods.ts
│   ├── sign-methods.ts
│   └── audit.ts
└── types/                      # Tipos compartilhados globais
```

### Regras

- **Nunca** importar de `app/` para `lib/` (vínculo errado).
- **Nunca** importar de `signer/` para `lib/` (signer é processo
  isolado, comunicação só via IPC).
- **`lib/` é leaf** — não importa de `app/`, `components/`, `signer/`.

---

## Comentários e JSDoc

### STD-009 — Quando comentar

- **Sempre** que a intenção não for óbvia pelo código.
- **Sempre** em invariantes críticos (ex.: "INV-007: fence é
  monotônico crescente").
- **Nunca** para explicar o que o código faz (código limpo já diz).
- **Nunca** código comentado — deletar. Git mantém histórico.

### STD-009.1 — JSDoc para API pública

```typescript
/**
 * Executa o fluxo canônico: gate → verify → approve → sign → broadcast.
 *
 * @param input - Parâmetros da transação (token, amount, slippage, deadline).
 * @returns Resultado com txHash, status e auditId para correlação.
 * @throws {PipelineError} Com código prefixado (SIM_*, VERIFY_*, etc.)
 *
 * @see {@link architecture/interfaces.md} para contrato público completo.
 * @see {@link architecture/invariants.md} INV-001 para ordem canônica.
 */
async function process(input: PipelineInput): Promise<PipelineResult>;
```

### STD-009.2 — TODO comments

- **Formato:** `// TODO(<name>): <description> [issue#NNN]`
- **Sempre** com nome do responsável ou referência a issue.
- **Nunca** TODO vago (`// TODO: fix this`).

---

## STD-009.3 — ESLint e Prettier

- **ESLint config:** `.eslintrc.json` na raiz. Regras do projeto
  são stricter que default do Next.js.
- **Prettier config:** `.prettierrc` na raiz. Formatação é
  automática em commit (husky pre-commit hook).
- **Proibido:** `eslint-disable` sem justificativa inline.
  `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason here`.

---

## STD-009.4 — Scripts de build

| Comando                 | O que faz                                         |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | Inicia Next.js dev server (porta 3000).           |
| `npm run build`         | Build produção.                                   |
| `npm run start`         | Inicia servidor produção (após build).            |
| `npm run lint`          | ESLint.                                           |
| `npm run typecheck`     | `tsc --noEmit`.                                   |
| `npm run test`          | Roda todos os testes.                             |
| `npx prisma migrate dev`| Aplica migrations em dev.                         |
| `npx tsx scripts/X.ts`  | Roda script TypeScript isolado (test harnesses).  |

---

## Relacionado

- `ENGINEERING_RULES.md` — resumo executivo do fluxo de engenharia.
- `standards/testing.md` (STD-101+) — padrões de teste.
- `standards/security.md` (STD-201+) — padrões de segurança.
- `standards/documentation.md` (STD-301+) — padrões de documentação.
- `standards/git-workflow.md` (STD-401+) — padrões de git.
- `architecture/interfaces.md` — contratos públicos que usam estes padrões.
- `architecture/invariants.md` INV-004 — preservar cause em erros.
- `DECISION_LOG.md` DEC-005 — prefixo `BROADCAST_SIGNER_*` em erros do signer.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.
