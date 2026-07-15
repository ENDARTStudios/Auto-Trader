# `standards/testing.md` — Padrões de Teste

> Regras detalhadas de teste. `ENGINEERING_RULES.md` >
> "Princípio de teste adversarial" é o resumo executivo; este
> arquivo é a referência completa.
>
> **IDs canônicos:** STD-101 a STD-108 (ver `MANIFEST.md` para a
> tabela completa de prefixos).

---

## STD-101 — Estrutura de testes

```
src/
├── lib/
│   └── chain/
│       ├── writer-lease.ts
│       └── writer-lease.test.ts          # Teste de unidade ao lado do módulo
└── ...

scripts/
├── test-h0-audit.ts                       # Teste adversarial H0 (audit tamper)
├── test-h1-rpc-resilience.ts              # Teste adversarial H1.1 (RPC quorum)
├── test-h1-simulation-gate.ts             # Teste adversarial H1.2 (sim revert)
├── test-h1-approval-hardening.ts          # Teste adversarial H1.3 (approval rug)
├── test-h1-mev-baseline.ts                # Teste adversarial H1.4 (sandwich)
├── test-h2-contract-verification.ts       # ... H2.1
├── test-h2-liquidity-verification.ts      # ... H2.2
├── test-h2-token-authority.ts             # ... H2.3
├── test-h2-sell-simulation.ts             # ... H2.4
├── test-h2-6-pipeline.ts                  # ... H2.6 composição
├── test-m3-1-signer-adapter.ts            # ... M3.1
├── test-m3-2-signer-isolation.ts          # ... M3.2
├── test-m3-3-broadcaster.ts               # ... M3.3
├── test-m4-writer-lease.ts                # ... M4 (fencing tokens)
├── test-m5-dry-run.ts                     # ... M5.1 (26 testes)
├── test-m5-chaos.ts                       # ... M5.4 (99 testes)
├── test-m5-shadow.ts                      # ... M5.2 (11 testes, 600 RPC reais)
├── test-m5-canary.ts                      # ... M5.3 (keccak256 bucketing)
├── test-m5-long-duration.ts               # ... M5.6 (24h/72h/7d)
└── test-m5-observability.ts               # ... M5.5 Registry único
```

### Regras

- **Teste de unidade** (`*.test.ts`): ao lado do módulo testado.
  Usa Jest ou Vitest. Mocka dependências externas.
- **Teste adversarial** (`scripts/test-*.ts`): script TypeScript
  isolado, roda com `npx tsx`. NÃO usa mocks — usa implementação
  real ou fork de rede.
- **Teste de integração:** em `scripts/test-integration-*.ts`.
  Pode usar Docker para subir dependências (Postgres, anvil/hardhat
  node).

---

## STD-102 — Princípio de teste adversarial (REPETINDO por criticalidade)

> Toda nova implementação criptográfica ou de segurança deve vir
> acompanhada de pelo menos um teste que **tenta explicitamente
> quebrar** a propriedade prometida.

Aplicável a:

- Hash-chain (audit log) — DEC-001
- KDF / encryption (key rotation)
- Assinatura (personal_sign, typed_data)
- Transaction simulation (H1.2)
- Approval cap (H1.3)
- RPC quorum (H1.1)
- Fencing tokens (M4) — REG-015/016/017/018
- Writer lease exclusividade (M4)
- Canary bucketing determinístico (M5.3)
- Shadow diff detection (M5.2)
- Audit exactly-once (INV-005)
- Signer key isolation (INV-006)

Um primitivo de segurança sem teste adversarial está **incompleto
por definição** — não foi provado que defende o que afirma defender.

### Estrutura de um teste adversarial

```typescript
// scripts/test-m4-writer-lease.ts (excerpt)
import { describe, it, expect } from 'vitest';
import { WriterLease } from '../src/lib/chain/writer-lease';

describe('REG-015: fencing token monotônico crescente', () => {
  it('rejeita writer stale com fence menor que o atual', async () => {
    const lease = new WriterLease(new InMemoryLeaseStore());

    const token1 = await lease.acquire('writer-A', 10_000);
    await lease.release(token1);

    const token2 = await lease.acquire('writer-B', 10_000);

    // Writer A (stale) tenta usar token1 (fence menor)
    expect(lease.verifyToken(token1)).toBe(false); // ❌ deve rejeitar
    expect(lease.verifyToken(token2)).toBe(true);  // ✅ aceita atual
  });

  it('fence é estritamente crescente entre leases consecutivas', async () => {
    const lease = new WriterLease(new InMemoryLeaseStore());
    const t1 = await lease.acquire('a', 1000);
    await lease.release(t1);
    const t2 = await lease.acquire('b', 1000);
    await lease.release(t2);
    const t3 = await lease.acquire('c', 1000);

    expect(t2.fence).toBeGreaterThan(t1.fence);
    expect(t3.fence).toBeGreaterThan(t2.fence);
  });
});

describe('REG-016: lease acquire exclusivo', () => {
  it('rejeita segundo acquire enquanto primeiro está ativo', async () => {
    const lease = new WriterLease(new InMemoryLeaseStore());
    await lease.acquire('writer-A', 10_000);

    await expect(lease.acquire('writer-B', 10_000))
      .rejects.toMatchObject({ code: 'LEASE_BUSY' });
  });
});
```

---

## STD-103 — Testes de unidade

### Padrões

- **Naming:** `describe('Module name')` → `it('should <behavior>')`.
- **AAA:** Arrange, Act, Assert. Comentários `// arrange`, `// act`,
  `// assert` são opcionais mas recomendados em testes complexos.
- **Um assertion por teste** (idealmente). Se múltiplos, todos
  devem testar o mesmo comportamento.
- **Setup/teardown:** `beforeEach`/`afterEach` para estado
  compartilhado. Evitar `beforeAll` (estado vaza entre testes).

### Mocks

- **Mock de módulo:** `vi.mock('@/lib/db')` no topo do arquivo.
- **Mock de função:** `vi.spyOn(obj, 'method').mockResolvedValue(...)`.
- **Mock de fetch:** usar `msw` (Mock Service Worker) para
  interceptar HTTP.
- **Nunca** mockar o módulo sob teste. Se precisa mockar uma
  função interna, ela deveria ser injetável.

### Coverage

- **Mínimo:** 80% line coverage em `src/lib/chain/` (camada de
  hardening). Verificado em CI.
- **Mínimo:** 60% line coverage em `src/lib/trading/`.
- **Nenhum mínimo** para `src/app/api/` (testes de integração
  cobrem isso).

---

## STD-104 — Testes de integração

### Padrões

- Subir dependências via Docker Compose (`docker-compose.test.yml`).
- Rodar com `npm run test:integration` (script no `package.json`).
- Limpar estado entre testes (truncate tables, reset anvil).

### Exemplo

```typescript
// scripts/test-integration-pipeline.ts (excerpt)
import { spawn } from 'node:child_process';
import { Pipeline } from '../src/lib/chain/pipeline';

describe('Pipeline integration com anvil (fork BSC)', () => {
  let anvil: ChildProcess;

  beforeAll(async () => {
    anvil = spawn('anvil', ['--fork-url', process.env.BSC_RPC_URL!]);
    await waitForPort(8545);
  });

  afterAll(async () => {
    anvil.kill();
  });

  it('processa tx com sucesso em fork BSC', async () => {
    const pipeline = new Pipeline({ rpcUrl: 'http://localhost:8545' });
    const result = await pipeline.process({
      token: '0x...',
      amount: 1000000n,
      slippageBps: 30,
      deadline: Math.floor(Date.now() / 1000) + 300,
    });
    expect(result.status).toBe('confirmed');
  });
});
```

---

## STD-105 — Testes de harness M5

### Dry Run (M5.1)

- 26 testes cobrindo todos os módulos H0-M5.
- Roda em < 30s.
- Critério: 26/26 pass para declarar M5.1 completo.

### Chaos (M5.4)

- 99 testes com ChaosInjector classes.
- Cada teste injeta falha específica (RPC down, signer crash,
  lease stolen, etc.) e valida que o sistema se recupera.
- Critério: 99/99 pass para declarar M5.4 completo.

### Shadow (M5.2)

- 11 testes comparando Live vs. Shadow.
- Usa 600 RPC reais BSC mainnet (não mock).
- Critério: 0 diffs em 600 RPC para declarar M5.2 completo.

### Canary (M5.3)

- Testa determinismo do bucketing `keccak256(txHash) % 100`.
- Mesma txHash → mesmo bucket, em qualquer instância.
- Critério: 100% determinístico para declarar M5.3 completo.

### Long-Duration (M5.6)

- Loop `while(running) { tick(); sleep(); }` por 24h/72h/7d.
- Valida: 0 leak de heap, lease estável, Registry coleta
  corretamente.
- Critério: 74k ops em 60s com 0 leak (validado em M5.6).

---

## STD-106 — CI/CD

- **PR trigger:** roda `typecheck`, `lint`, `test` (unidade), `test:integration`.
- **Merge to main:** roda todos os testes adversariais (`scripts/test-*.ts`).
- **Release tag:** roda long-duration 1h como smoke test antes de
  promover para produção.

---

## STD-107 — Anti-patterns

- ❌ **Teste que só testa o mock:** se o teste só valida que o mock
  foi chamado, ele não testa comportamento real.
- ❌ **Teste com `setTimeout` para esperar async:** usar
  `waitFor`/`findBy` do testing-library.
- ❌ **Snapshot testing para lógica:** snapshots são frágeis e
  não explicam falhas. Usar apenas para output de UI.
- ❌ **`expect.assertions(N)` em todo teste:** adiciona ruído. Usar
  apenas quando o teste tem early returns que poderiam pular
  assertions.
- ❌ **Teste que depende de ordem de execução:** cada teste deve
  ser isolado. Estado compartilhado via `beforeEach` setup.

---

## Relacionado

- `ENGINEERING_RULES.md` > Princípio de teste adversarial — resumo executivo.
- `standards/security.md` (STD-201+) — padrões de segurança associados.
- `standards/coding-style.md` (STD-001+) — estilo aplicado a testes.
- `architecture/invariants.md` INV-001 a INV-010 — invariantes que devem ser testados adversarialmente.
- `architecture/interfaces.md` — contratos públicos testados.
- `DECISION_LOG.md` DEC-001 (hash-chain), DEC-005 (prefixos de erro) — decisões com testes adversariais.
- `SECURITY.md` (raiz do projeto) — REG-NNN adversariais canônicos.
- `memory/known-problems.md` KP-001 a KP-006 — bugs passados que geraram testes adversariais.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.
