# Testes — Unitários, Integração e E2E

> **Versão:** 1.1 — 2026-09-23 (v1.0 — 2026-08-26; atualizado pós T050-T054: chain de coverage fechada, e2e no CI condicional a label `e2e`)
> **Stack:** Vitest (unit) + Vitest+Prisma (integração) + Playwright (E2E) + Codecov
> **Gate:** `npm run test:ci` deve passar antes de qualquer push (pre-push hook REG-004)
> **Relacionados:** [QA_TESTING.md](./QA_TESTING.md) (plano de QA por release) · índice em [README.md](./README.md)

---

## 1. Pirâmide

```
        /\
       /E2E\        Playwright — 10 fluxos críticos (lento, poucos)
      /------\
     /  INT   \     Vitest + Prisma + inject — por rota (médio)
    /----------\
   /   UNIT     \   Vitest + mocks — por service (rápido, muitos)
  /--------------\
```

| Camada | Ferramenta | Onde | Cobertura alvo | Quando roda |
|---|---|---|---|---|
| **Unit** | Vitest | `src/lib/**/__tests__/*.test.ts` | ≥80% em `src/lib/trading/**` e `src/lib/chain/**` | Cada save (watch) + CI |
| **Integração** | Vitest + Prisma (SQLite) | `tests/integration/*.test.ts` | Cada rota com happy + erro + auth | CI |
| **E2E** | Playwright | `e2e/*.spec.ts` | Fluxos críticos (login → trade → close) | CI (push) + nightly |

---

## 2. Vitest — Unit + Integração

### 2.1 Config (`vitest.config.ts`)

```ts
// vitest.config.ts — SPRINT cria
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // 'jsdom' para testes de componentes
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
      include: ['src/lib/trading/**', 'src/lib/chain/**', 'src/lib/auth/**'],
      exclude: ['src/components/ui/**', 'src/lib/crash-logger.ts'],
    },
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

### 2.2 Setup (`tests/setup.ts`)

```ts
// tests/setup.ts
import { beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';

beforeAll(async () => {
  // Para integração: garantir DB limpo (hardCleanupBeforeSuite pattern REG-003)
  // Só roda quando DATABASE_URL é test DB (isolado)
  if (process.env.DATABASE_URL?.includes('test')) {
    // truncate tabelas não-singleton
  }
});

afterAll(async () => {
  await db.$disconnect();
});
```

### 2.3 Exemplo Unit (service puro)

```ts
// src/lib/trading/__tests__/risk-manager.test.ts
import { describe, it, expect } from 'vitest';
import { assessTradeRisk } from '@/lib/trading/risk-manager';

describe('assessTradeRisk', () => {
  it('blocks when kill switch active', () => {
    const result = assessTradeRisk({ killSwitchActive: true } as any, 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/kill switch/i);
  });
  it('blocks when per-trade loss exceeds cap', () => {
    // ...
  });
});
```

### 2.4 Exemplo Integração (rota)

```ts
// tests/integration/positions.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

describe('GET /api/positions', () => {
  it('401 without session', async () => {
    const res = await fetch('http://localhost:3000/api/positions');
    expect(res.status).toBe(401);
  });
  it('200 with trader session + returns only own positions (RLS)', async () => {
    const session = await loginAs('trader');
    const res = await fetch('http://localhost:3000/api/positions', {
      headers: { Cookie: `session=${session.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.positions)).toBe(true);
  });
});
```

### 2.5 Scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:unit": "vitest run --project=unit",
    "test:integration": "vitest run --project=integration"
  }
}
```

---

## 3. Playwright — E2E

### 3.1 Config (`playwright.config.ts`)

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
```

### 3.2 Fluxos Críticos (10)

| # | Fluxo | Passos | Asserts |
|---|---|---|---|
| 1 | Login → Dashboard | Preenche login, submit, redirect `/` | Dashboard carrega, status visível |
| 2 | Engine start/stop | Clica Iniciar, vê `engine_running=true`, clica Parar | Toast + status muda |
| 3 | Kill switch | Clica Kill Switch, confirma | Badge vermelho + posições fecham |
| 4 | Abrir posição (paper) | Engine roda, posição aparece em PositionsTable | Row com symbol + P&L |
| 5 | Scam filter | Busca token scam (score<70) | ScamReport passed=false, não abre posição |
| 6 | Backtest | Preenche form, submit, vê equity curve | SVG renderiza + métricas |
| 7 | RBAC — viewer bloqueado | Login viewer, tenta POST /api/kill-switch | 403 |
| 8 | Rate limit | 6 POST /api/auth/login falhas seguidas | 6º retorna 429 + Retry-After |
| 9 | Watchlist CRUD | Adiciona token, vê na lista, remove | CRUD round-trip |
| 10 | SSE realtime | Abre dashboard, engine emite evento | AlertsToast aparece em <2s |

### 3.3 Exemplo Spec

```ts
// e2e/engine.spec.ts
import { test, expect } from '@playwright/test';

test('engine start/stop', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name=email]', 'trader@test.com');
  await page.fill('[name=password]', 'Test123!');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/');
  await page.click('button:has-text("Iniciar")');
  await expect(page.locator('text=Engine rodando')).toBeVisible({ timeout: 5000 });
  await page.click('button:has-text("Parar")');
  await expect(page.locator('text=Engine parada')).toBeVisible({ timeout: 5000 });
});
```

### 3.4 Scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:report": "playwright show-report"
  }
}
```

---

## 4. Codecov

```yaml
# codecov.yml
coverage:
  status:
    project:
      default:
        target: 80%
        threshold: 2%  # PR pode cair até 2% sem falhar
    patch:
      default:
        target: 70%
comment:
  layout: "reach, diff, flags, files"
  behavior: default
```

**CI step (`.github/workflows/ci.yml`):**

```yaml
- name: Run tests with coverage
  run: npm run test:coverage
- name: Upload to Codecov
  uses: codecov/codecov-action@v4
  with:
    token: ${{ secrets.CODECOV_TOKEN }}
    files: ./coverage/lcov.info
    flags: unittests
    fail_ci_if_error: false
```

Badge no `README.md`:

```md
[![codecov](https://codecov.io/gh/USER/REPO/branch/main/graph/badge.svg)](https://codecov.io/gh/USER/REPO)
```

---

## 5. CI Gate Atual vs Futuro

| Gate | Hoje (test:ci) | Futuro (com Vitest+Playwright) |
|---|---|---|
| Comando | `npm run test:ci` = 23 scripts `tsx` (637 checks) | `npm run test:coverage` + `npx playwright test` |
| Cobertura | Ad-hoc por script | `v8` provider + threshold 80% |
| E2E | Manual | Playwright 10 fluxos |
| Codecov | Não | `lcov.info` upload |
| Pre-push | `scripts/git-hooks/pre-push` → `test:ci` | Mesmo hook → `test:ci` + `test:coverage` |

**Migração:** manter `test:ci` (REG-004) até Vitest cobrir 100% dos 637 checks. Depois `test:ci` chama `vitest run` internamente.

---

## 6. Como Rodar Local

```bash
# Unit + integração (watch)
npm run test

# Single run + coverage
npm run test:coverage
open coverage/index.html

# E2E (precisa dev server)
npm run test:e2e
npm run test:e2e:ui  # modo interativo

# Gate completo (como o pre-push faz)
npm run test:ci && npm run test:coverage && npx playwright test
```
