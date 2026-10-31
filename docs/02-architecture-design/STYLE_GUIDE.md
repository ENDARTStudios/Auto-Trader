# STYLE_GUIDE — Estilo de Código

> **Versão:** 1.0 — 2026-09-23
> **Gates:** ESLint 0 erros ([LINT.md](./LINT.md)) + `tsc --noEmit` limpo + commitlint. O estilo abaixo explica o *porquê* por trás das regras.

---

## 1. TypeScript

- **Strict sempre.** Sem `any` (usar `unknown` + narrowing); tipos explícitos em fronteiras públicas (rotas, serviços).
- **Zod nas bordas:** todo input de API/form é validado com Zod antes de tocar domínio.
- Erros de domínio tipados (`src/lib/auth/errors.ts` é o padrão de referência).

## 2. Estrutura de módulo (monolito modular)

Cada módulo segue o padrão validado no S01 ([ARCHITECTURE.md](./ARCHITECTURE.md)):

```
minha-feature/
  types.ts     # contratos públicos
  service.ts   # regra de domínio (sem Next/HTTP)
  routes.ts    # handler fino: auth → zod → service → resposta
  tests        # vitest ao lado ou em tests/
```

- **Handler fino:** route não tem regra de negócio; chama service.
- **Dependa de interfaces**, não de implementações (princípio do catálogo de apps).
- Caminho feliz sem `try/catch` decorativo — `handleApiError` no fim do handler.

## 3. Nomenclatura

| Sujeito | Convenção | Exemplo |
|---|---|---|
| Arquivo de módulo runtime | kebab-case | `paper-trader.ts`, `goplus-scanner.ts` |
| Componente React | kebab-case arquivo, PascalCase export | `market-panel.tsx` → `MarketPanel` |
| Tipos/Interfaces | PascalCase, sem prefixo `I` | `Position`, `RiskEvent` |
| Constantes de config | SCREAMING_SNAKE em env; camelCase em config TS | `SESSION_SECRET`, `kellyFractionMax` |
| Rotas de API | kebab-case plural | `/api/feature-flags`, `/api/scam-reports` |
| Testes | `tests/*.test.ts` (unit), `e2e/*.spec.ts` (E2E), `scripts/test-*.ts` (gate) | `tests/auth.test.ts` |

## 4. React/Next

- Componentes de servidor por default; `"use client"` só quando precisa (estado/evento).
- TanStack Query para fetching; nada de `useEffect` para data-fetch básico.
- Strings de UI via i18n (`messages/*.json` — ver [ACCESSIBILITY.md](./ACCESSIBILITY.md) §2).
- Skeleton + motion em painéis carregados (ver [MOTION.md](./MOTION.md), [DESIGN.md](./DESIGN.md)).

## 5. Commits e PRs

- **Conventional Commits** (`commitlint.config.cjs`): `feat:`, `fix:`, `test:`, `chore(log):`, `docs:`… no idioma do histórico (pt-BR aceito e usado).
- Um PR = uma intenção; descrição com problema/solução/validação (formato das ADRs).
- Zero arquivos frozen no diff sem ADR ([RULES.md](./RULES.md) §3).

## 6. Proibições (resumo do lint)

- `console.log` em código de produção (usar `logger.ts` / crash-logger).
- Secrets hardcoded (gitleaks bloqueia no CI).
- Import circular entre apps do monolito; import profundo de módulo alheio (usar interface pública `types.ts`).

---

**Relacionados:** [LINT.md](./LINT.md) · [CODE_REVIEW.md](./CODE_REVIEW.md) · [DEVELOPMENT.md](./DEVELOPMENT.md)
