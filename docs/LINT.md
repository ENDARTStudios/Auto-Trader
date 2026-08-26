# Lint & Qualidade — Arch, Biome, Commitlint, Knip, Stryker

> **Versão:** 1.0 — 2026-08-26
> **Princípio:** Qualidade é gate, não sugestão. CI falha se qualquer ferramenta falha.

---

## 1. Stack

| Ferramenta | O que faz | Comando | Gate |
|---|---|---|---|
| **ESLint + eslint-plugin-security** | Bugs, anti-patterns, security (detect-object-injection etc) | `npm run lint` | CI falha |
| **Biome** (ou Prettier + ESLint) | Formatação + lint rápido (alternativa a Prettier) | `npx biome check .` | CI falha |
| **TypeScript** | Tipos — `strict: true` | `npx tsc --noEmit` | CI falha |
| **Commitlint** | Conventional Commits (`feat:`, `fix:` etc) | `npx commitlint --from=HEAD~1` | Hook `commit-msg` |
| **Knip** | Código morto — arquivos, exports, deps não usados | `npx knip` | CI warn → fail após SPRINT |
| **Stryker** | Mutation testing — qualidade dos testes | `npx stryker run` | Nightly (não bloqueia PR) |
| **Arch contract** | Regras de dependência entre módulos (DAG) | `npx dependency-cruiser src` | CI falha se ciclo |
| **Gitleaks** | Segredos vazados | `gitleaks detect --no-git` | Pre-commit + CI falha |
| **npm audit** | Vulnerabilidades | `npm audit --audit-level=high` | CI falha |

---

## 2. ESLint — Security Hardened

```js
// eslint.config.mjs — SPRINT endurece o atual (que hoje desliga tudo)
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import security from 'eslint-plugin-security';

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: { security },
    rules: {
      // Security — nunca desligar
      'security/detect-object-injection': 'error',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-eval-with-expression': 'error',
      // TS — reativar gradualmente
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  { ignores: ['node_modules/**', '.next/**', 'out/**', 'coverage/**'] },
];
```

**Migração:** o `eslint.config.mjs` atual tem tudo `off` (tech debt). SPRINT reativa `security/*` primeiro, depois `no-explicit-any` como `warn`, depois `error` quando codebase limpo.

---

## 3. Biome (alternativa rápida)

```json
// biome.json — se adotar Biome em vez de Prettier+ESLint
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizer": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": { "recommended": true, "security": { "noDangerouslySetInnerHtml": "error" } }
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 }
}
```

```bash
npx biome check --write .   # format + lint + organize imports
npx biome ci .              # CI — falha se precisa formatar
```

**Decisão:** manter ESLint (já usado) + Prettier, ou migrar para Biome (mais rápido, 1 tool). Registrar em `DECISOES.md`. Para MVP, ESLint endurecido é suficiente.

---

## 4. Commitlint

```js
// commitlint.config.js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat','fix','docs','style','refactor','perf','test','build','ci','chore','revert','security']],
    'subject-case': [0], // permite qualquer case
  },
};
```

```bash
npm install -D @commitlint/cli @commitlint/config-conventional
# Hook commit-msg (scripts/git-hooks/commit-msg):
# npx commitlint --edit $1
```

---

## 5. Knip — Código Morto

```bash
npm install -D knip
npx knip
# Saída:
# Unused files: src/lib/trading/old-scanner.ts
# Unused exports: src/lib/trading/helpers.ts: unusedExport
# Unused dependencies: lodash (package.json mas não importado)
```

**CI:**

```yaml
- name: Knip — dead code
  run: npx knip --no-exit-code  # warn por enquanto
  # SPRINT após limpeza: npx knip (fail se morto)
```

**Plano de limpeza (ver Skill de Limpeza):**

1. Rodar `npx knip` + `npx ts-prune` + `npx unimported`
2. Classificar por risco (arquivo órfão > export não usado > dep não usada)
3. Abrir `chore` por grupo (ex: `[CHORE] remover 3 arquivos órfãos — knip`)
4. Verificar com `npm run test:ci` + `npm run build` após cada remoção

---

## 6. Stryker — Mutation Testing

```js
// stryker.config.mjs
export default {
  mutate: ['src/lib/trading/**/*.ts', 'src/lib/chain/**/*.ts', '!src/**/*.test.ts'],
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress'],
  thresholds: { high: 80, low: 60, break: 50 },
};
```

```bash
npx stryker run
# Saída: Mutation score 72% — 120 survived, 340 killed, 10 timeout
# "Survived" = teste não pegou mutação → teste fraco → melhorar
```

Stryker é nightly, não bloqueia PR (lento). Mas score <50% bloqueia.

---

## 7. Arch Contract — Dependency Cruiser

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    {
      name: 'no-cycle',
      severity: 'error',
      from: {}, to: { circular: true },
    },
    {
      name: 'chain-no-trading-import',
      severity: 'error',
      comment: 'H1/H2 primitives não podem importar trading (folhas)',
      from: { path: '^src/lib/chain' },
      to: { path: '^src/lib/trading' },
    },
    {
      name: 'ui-no-db',
      severity: 'error',
      from: { path: '^src/components' },
      to: { path: '^src/lib/db' },
    },
  ],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.json' } },
};
```

```bash
npx dependency-cruiser --validate .dependency-cruiser.cjs src
```

---

## 8. CI — Tudo Junto

```yaml
# .github/workflows/ci.yml — quality job
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npx knip --no-exit-code
      - run: npx dependency-cruiser --validate .dependency-cruiser.cjs src
      - run: gitleaks detect --source . --no-git -v
      - run: npm audit --audit-level=high
```

---

## 9. Verificação Local

```bash
npx tsc --noEmit
npm run lint
npx knip
npx dependency-cruiser --validate .dependency-cruiser.cjs src
gitleaks detect --source . --no-git -v
npm audit --audit-level=high
npx biome check .  # se Biome adotado
```
