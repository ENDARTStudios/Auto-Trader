# A11y Remediation Log — dashboard-wide backlog (T064)

> Fonte: CI run `35946550038` (PR #26), gate `e2e/a11y-dashboard.spec.ts` com
> evidência por nó (target + html). Escopo: só apresentação/ARIA — zero lógica
> de negócio, zero backend, zero comportamento visual alterado.

## 1. `button-name` critical ×5 → RESOLVIDO

| Nó | Causa | Fix (arquivo:linha) |
|---|---|---|
| Button `.bg-emerald-500/90` (START, texto `hidden sm:inline` some no mobile) | sem nome acessível em viewport <sm | `aria-label="Start engine"` — `workspace-header.tsx` |
| Button `.border-red-500/40` (KILL, idem) | idem | `aria-label="Kill switch"` — `workspace-header.tsx` |
| Switch `cfg` mode (unchecked+disabled) | `<Label>` sem `htmlFor`, Switch sem `id` | `id="cfg-mode"` + `htmlFor` — `config-editor.tsx` |
| Switch Scan CEX (checked) | idem | `id="cfg-scan-cex"` + `htmlFor` — `config-editor.tsx` |
| Switch Scan DEX (checked) | idem | `id="cfg-scan-dex"` + `htmlFor` — `config-editor.tsx` |

Nota: `terminal-header.tsx` tem par START/KILL idêntico mas é código morto
(nenhum import no app) — não tocado; remoção futura cabe a cleanup dedicado.

## 2. `aria-progressbar-name` serious ×1 → RESOLVIDO (defesa em profundidade)

Nó: `div[role=progressbar][data-state=indeterminate].h-2` (valor ausente no load).
Como qualquer `Progress` sem `value` cai aqui, rotulou-se todos os 4 usos
renderizados (1 prop cada, sem mudança visual):

- `market-panel.tsx` → `aria-label="Fear and greed index"`
- `strategic-panel.tsx` (stats) → `"Average capability completion"`
- `strategic-panel.tsx` (cap) → `` `Capability ${cap.title} completion` ``
- `strategic-panel.tsx` (diversity) → `"Diversity score"`

## 3. `scrollable-region-focusable` serious ×3 → RESOLVIDO

`tabIndex={0}` + `role="region"` + `aria-label` (teclado alcança o scroll):

- `.tech-strip` → `"System status"` — `workspace-header.tsx`
- portfolio `overflow-auto` → `"Open positions"` — `portfolio-panel.tsx`
- system-health `overflow-y-auto` → `"Hardening layers"` — `system-health-panel.tsx`

## 4. `color-contrast` serious ×17 (scan anterior, run `35936927008`) → JUSTIFICADO

Apareceu só no scan full-page **com o dialog da palette aberto** (backdrop
`bg-black/80` derruba contraste do conteúdo atrás). Não reproduz em scans com
escopo (dialog/S41) nem no dashboard sem modal. Artefato de overlay, não defeito
de token de cor. Reavaliar se voltar a aparecer em scan sem modal.

## 5. Validação

- Gate: `e2e/a11y-dashboard.spec.ts` (0 serious/critical) + probe log-only.
- Local: `tsc 0`, `eslint 0/0`, `vitest` verde, `test:ci` via pre-push.
- CI do PR: runs encadeados até verde (ver episodes).
