# 05 · Plano de implementação (Next.js)

Este documento conecta o conceito ao código existente: rotas, componentes, tokens e fases. Não é um RFC de backend — o foco é entregar a UI nova sem parar a operação.

---

## 1. Estado atual relevante

| Item | Hoje | Observação |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | `src/app/` |
| UI base | shadcn/Radix + Tailwind v4 | `src/components/ui/*` (48 arquivos) |
| CSS global | `src/app/globals.css` (58 KB) | Contém tokens, utilitários e estilos legados |
| Design tokens | dentro do `globals.css` | Serão movidos para `design/tokens.css` |
| Tema | dark fixo (`className="dark"` no `<html>`) | Passa a `next-themes` + `data-theme` |
| i18n | `next-intl` + store própria | 3 locales em `src/lib/i18n` |
| Dashboard | `src/app/page.tsx` (39 KB, 12 seções) | Será dividido em rotas |
| Gráficos | `recharts` + SVGs próprios | Recharts continua para casos simples |

---

## 2. Mapa de rotas

```
src/app/
├── (public)/
│   ├── page.tsx                 → /            (landing, novo)
│   ├── pricing/page.tsx         → /pricing     (reescrito)
│   ├── terms/page.tsx           → /terms
│   └── privacy/page.tsx         → /privacy
├── (auth)/
│   ├── login/page.tsx           → /login
│   ├── signup/page.tsx          → /signup      (novo)
│   ├── reset/page.tsx           → /reset       (novo)
│   └── onboarding/page.tsx      → /onboarding  (novo, fora do shell)
├── (app)/
│   ├── layout.tsx               → shell: rail + topbar + telemetry
│   ├── overview/page.tsx        → /overview
│   ├── markets/page.tsx         → /markets
│   ├── markets/[symbol]/page.tsx→ /markets/:symbol
│   ├── portfolio/page.tsx       → /portfolio
│   ├── positions/[id]/page.tsx  → /positions/:id
│   ├── strategy/page.tsx        → /strategy
│   ├── backtest/page.tsx        → /backtest
│   ├── analytics/page.tsx       → /analytics
│   ├── journal/page.tsx         → /journal
│   ├── risk/page.tsx            → /risk
│   ├── copilot/page.tsx         → /copilot
│   ├── alerts/page.tsx          → /alerts
│   ├── data/page.tsx            → /data
│   ├── settings/page.tsx        → /settings
│   ├── billing/page.tsx         → /billing
│   └── admin/page.tsx           → /admin
├── not-found.tsx                → 404
├── error.tsx                    → 500
└── maintenance/page.tsx         → manutenção
```

**Redirects:** `/` autenticado → `/overview`; `/` anônimo → landing; links legados com `?tab=` mapeados para as novas rotas.

---

## 3. Estrutura de componentes

```
src/components/
├── shell/
│   ├── app-shell.tsx           ← grid rail/main/telemetry + estado de colapso
│   ├── rail.tsx                ← grupos, item ativo, contadores
│   ├── topbar.tsx              ← breadcrumb, busca, mode-switch, engine pill
│   ├── telemetry-bar.tsx
│   └── command-palette.tsx     ← reaproveita cmdk existente
├── primitives/                 ← (evoluir src/components/ui)
│   ├── button.tsx  input.tsx  select.tsx  switch.tsx  segmented.tsx
│   ├── badge.tsx   delta.tsx  kpi.tsx  meter.tsx  ring.tsx
│   ├── card.tsx    page-header.tsx  table.tsx  tabs.tsx
│   └── empty-state.tsx  skeleton.tsx  banner.tsx
├── data/
│   ├── equity-chart.tsx        ← área + benchmark + range + tooltip
│   ├── candles.tsx
│   ├── sparkline.tsx
│   ├── donut.tsx
│   ├── heatmap.tsx
│   └── positions-table.tsx  markets-table.tsx  trades-table.tsx
├── domain/
│   ├── engine-status.tsx       ← usado em overview, strategy, topbar
│   ├── ai-decision-card.tsx
│   ├── risk-gates.tsx
│   ├── position-summary.tsx
│   ├── kill-switch-dialog.tsx
│   └── evidence-list.tsx
└── overlays/
    ├── drawer.tsx  modal.tsx  toast.tsx
```

Regra: **primitives** não conhecem domínio; **domain** conhece dados e regras; **shell** é o único lugar de navegação.

---

## 4. Tokens no Tailwind v4

`src/app/globals.css` passa a começar por:

```css
@import "tailwindcss";
@import "../../design/tokens.css"; /* gerado a partir de design/tokens.json */

@theme inline {
  --color-bg: var(--bg);
  --color-surface-1: var(--surface-1);
  --color-line: var(--line);
  --color-brand: var(--brand);
  --color-pos: var(--pos);
  --radius-card: 12px;
  --font-sans: var(--font-sans);
}
```

E os tokens existentes em `:root` são substituídos pelos do design system. Utilitários semânticos (`bg-surface-1`, `text-text-2`, `border-line`) evitam `slate-800`/`zinc-900` no JSX.

**Tema claro:** `data-theme="light"` no `<html>` via `next-themes` (já instalado). A rail, topbar e gráficos usam apenas tokens — nenhum componente deve declarar cor literal.

---

## 5. Dados e estado

| Necessidade | Solução |
|---|---|
| Listas e detalhe | TanStack Query (`/api/positions`, `/api/market`, `/api/rounds`) |
| Streaming de preço | `src/app/api/stream` (SSE) + `useSyncExternalStore` |
| Estado de UI | Zustand local por página (não global) |
| Preferências | `localStorage` (`at.theme`, `at.density`, `at.rail`) + `PATCH /api/preferences` |
| Deep link | URL como fonte de verdade para filtros, abas e seleção |

**Contrato de estados por tela:** `loading → ready | empty | error | degraded`. Cada um tem componente próprio; nenhuma tela pode renderizar `null` durante o fetch.

---

## 6. Fases de entrega

### Fase 0 — Fundação (1 sprint)
- `tokens.css` + `@theme` + tema claro/escuro.
- Shell (`app-shell`, `rail`, `topbar`, `telemetry`) e primitives de botão/input/card/badge/table.
- Command palette ligada às novas rotas.
- Critério: `/overview` renderiza no shell novo com dados mockados; axe sem violações críticas.

### Fase 1 — Operate (1–2 sprints)
- `/overview` (substitui `page.tsx`), `/markets`, `/markets/[symbol]`, `/portfolio`, `/positions/[id]`.
- Extrair lógica de `page.tsx` em hooks por domínio, sem alterar APIs.
- Critério: paridade funcional com a home atual + deep links + estados vazios.

### Fase 2 — Guard & Analyze (1–2 sprints)
- `/risk`, `/copilot`, `/strategy`, `/backtest`, `/analytics`, `/journal`.
- Kill switch com confirmação tipada e auditoria.
- Critério: kill switch testado em E2E; copilot com fontes obrigatórias.

### Fase 3 — Sistema & público (1 sprint)
- `/alerts`, `/data`, `/settings`, `/billing`, `/admin`.
- Landing, pricing, signup, reset, onboarding.
- Critério: onboarding persistido; landing com preview real; pricing com comparação.

### Fase 4 — Polimento (contínuo)
- Densidade compacta, tema claro completo, `aria-live`, virtualização de tabelas grandes (> 200 linhas), i18n 100% traduzido, testes visuais.

---

## 7. Testes e qualidade

- **Visual:** Playwright screenshots por rota nos 3 breakpoints (1440, 900, 390) contra baseline.
- **Acessibilidade:** `@axe-core/playwright` em todas as rotas; falha em `serious|critical`.
- **E2E críticos:** login, onboarding, start/pause engine, kill switch (HALT), fechar posição, exportar CSV.
- **Contrato:** snapshot de `tokens.json` nos testes para impedir cor hardcoded.
- **Performance:** LCP < 2,5 s no overview; chart em < 100 ms após dados.

---

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Perda de funcionalidade ao dividir `page.tsx` | Inventário de cada painel → rota de destino (tabela em `02-CONCEPT.md`) |
| `globals.css` com 58 KB de legado | Tokens novos primeiro; remover blocos mortos por seção, com screenshot diff |
| i18n incompleto | Congelar strings novas em `en-US` e exigir chave em PR |
| Gráficos pesados no mobile | Recharts → SVG próprio para área/candle (já no protótipo), virtualização |
| Tema claro com cores literais | Lint rule proibindo hex em `className`; tokens obrigatórios |
| Papel do Copilot gerar expectativa de execução | Aviso fixo “advisory only” + permissões no backend |

---

## 9. Checklist de aceitação

- [ ] 17 rotas autenticadas com URL, breadcrumb e `document.title` corretos.
- [ ] Rail e paleta cobrem 100% das rotas.
- [ ] Nenhuma cor literal em componentes de app.
- [ ] Contraste ≥ 4.5:1 em texto e ≥ 3:1 em ícones/bordas de foco.
- [ ] 390 px sem overflow horizontal em todas as rotas.
- [ ] 7 estados implementados nas 8 telas de dados.
- [ ] Kill switch exige `HALT` e registra em `AuditLog`.
- [ ] `tokens.json` = `tokens.css` = arquivo FigCraft.
- [ ] Testes E2E e axe verdes no CI.
- [ ] Zero strings PT hardcoded em componentes `en-US`.
