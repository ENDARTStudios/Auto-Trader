# DESIGN — Design System do Dashboard

> **Versão:** 1.0 — 2026-09-23
> **Stack visual:** Tailwind CSS + shadcn/ui (Radix) + motion guidelines ([MOTION.md](./MOTION.md)). Tokens via CSS variables (`src/app/globals.css`, `components.json`).

---

## 1. Princípios

1. **Densidade a serviço da decisão:** operador precisa ler estado (saldo, P&L, posições, risco) em segundos — dados primeiro, ornamento depois.
2. **Risco é sempre visível:** estado do sistema (`mode.json`) e kill switch são elementos de primeira classe, nunca escondidos em menu.
3. **Ações destrutivas pedem atrito:** kill switch/config com `AlertDialog` de confirmação (Radix).
4. **Escuro por padrão** (dashboard de trading), legível em claro.

## 2. Componentes (shadcn/ui — donos do código)

- Biblioteca: `src/components/ui/*` geradas via shadcn sobre Radix (`components.json`).
- Layout com dnd-kit para áreas configuráveis (`@dnd-kit/*`).
- Formulários: react-hook-form + `@hookform/resolvers` + Zod.
- Ícones: `lucide-react`.
- TanStack Query para estados de loading/erro padronizados.

## 3. Painéis do dashboard (inventário visual)

| Painel | Conteúdo | Estado vazio/erro |
|---|---|---|
| Saldo/Reserve | `TradingBalance`, split 50/50 | Skeleton + mensagem |
| Posições | `Position` abertas, P&L corrente | Skeleton; RLS filtra por dono |
| Equity/Performance | `PerformanceSnapshot` curve | Skeleton |
| Market | `MarketPanel` — snapshots, SSE | Skeleton + `fadeInUp` (motion padrão) |
| Scam Audit | `ScamReport` por candidato | Lista vazia = "nenhum candidato hoje" |
| Logs | `AppLog` stream | Scroll area |
| Kill Switch | botão crítico + confirmação | Sempre visível |
| Config Editor | limites (leitura; escrita = envelope humano) | Aviso de permissão por papel |

## 4. Motion (resumo — regras completas em [MOTION.md](./MOTION.md))

- Entrada de dados: `fadeInUp` sutil; nada de bounce em dados financeiros.
- Transições de estado (ok→degraded): mudança de cor + ícone + texto, animada < 300ms.
- `prefers-reduced-motion` respeitado ([ACCESSIBILITY.md](./ACCESSIBILITY.md) §1.4).

## 5. Cores e semântica

| Significado | Uso |
|---|---|
| Verde | Lucro, `ok`, ação confirmada |
| Âmbar | Degradado (`lang_degraded`), aviso, atenção |
| Vermelho | Perda, risco, kill switch, `crisis_lock` — **sempre com ícone+texto**, nunca cor sozinha |
| Cinza | Neutro/desabilitado |

Contraste AA (WCAG) — checklist em [ACCESSIBILITY.md](./ACCESSIBILITY.md).

## 6. Regras para novos componentes

1. Comece do shadcn/Radix existente; só crie componente novo se nenhum se encaixa.
2. String de UI via i18n ([CONTENT.md](./CONTENT.md) §2); label de input sempre associado.
3. Loading = skeleton (não spinner solto); erro = ErrorBoundary do painel + retry.
4. Números de dinheiro: fonte mono/tabular, locale correto, sinal explícito (+/-).
5. Responsivo: verificado no Playwright `mobile` (Pixel 7).

---

**Relacionados:** [MOTION.md](./MOTION.md) · [ACCESSIBILITY.md](./ACCESSIBILITY.md) · [CONTENT.md](./CONTENT.md) · [STYLE_GUIDE.md](./STYLE_GUIDE.md)
