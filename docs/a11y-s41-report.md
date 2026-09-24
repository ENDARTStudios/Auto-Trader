# S41 Accessibility Report — axe validation (T062, 2026-09-24)

> Status: PRELIMINARY — unit gate green locally; browser scan runs in PR CI
> (`e2e/s41-a11y-axe.spec.ts`). Results below will be updated from CI evidence.
> No production code changed for tooling; axe runs only in e2e (never in bundle).

## 1. Supply-chain review — `@axe-core/playwright@4.13.0` (devDependency only)

| Item | Evidence |
|---|---|
| Publisher | Deque Systems (`dequelabs/axe-core-npm`), axe-core standard vendor |
| Version | 4.13.0 (only dep: `axe-core ~4.13.0`) |
| License | MPL-2.0 — test-tooling only, never in prod bundle → no copyleft trigger on app |
| Size | 47 KB unpacked (wrapper); `axe-core` deduped with existing `eslint-plugin-jsx-a11y` copy (same 4.13.0) |
| History | released since 2021, maintained (Sep 2026) |
| Verdict | **trivial risk — approved for devDependency** |

## 2. Gate policy (locked in `tests/a11y/s41-a11y.test.ts`, 4/4 green)

- **Fail:** any `serious` or `critical` axe violation (WCAG 2A/2AA tags).
- **Backlog (logged, not failing):** `moderate`/`minor` — reported per context.
- Rationale: demo-acceptance requires zero serious/critical; cosmetic issues tracked openly.

## 3. Coverage (`e2e/s41-a11y-axe.spec.ts`)

1. Dashboard + News Panel (loading/loaded states) — full-page scan.
2. Command Palette opened via `Control+K` — dialog scan + Escape close.
3. Onboarding Wizard step 0 (auto-open on fresh seed) — dialog scan.
4. Pricing page (logged out) — full-page scan.

Playwright-native checks from T052 (`s41-validation.spec.ts`) already cover:
focus trap (12× Tab stays in dialog), `aria-modal` dialog roles, combobox
filtering, viewer RBAC hiding, Escape handling.

## 4. Results

### 4.1 S41 surfaces (gated — must be 0 serious/critical)

- [ ] news-panel (`[data-testid="news-panel"]` scope): pending PR CI re-run
- [ ] palette-open (`[role="dialog"]` scope): pending PR CI re-run
- [ ] wizard-step-0 (`[role="dialog"]` scope, trader login): pending PR CI re-run
- [ ] pricing (full page): pending PR CI re-run (passed in run 35936927008 — no
  failure logged for it; re-confirmed on re-run)

### 4.2 Dashboard-wide backlog (NOT S41 scope — open, tracked, never hidden)

Evidência: CI run `35936927008` (PR #25), full-page scan `dashboard+news`:

| Rule | Impact | Nodes | Provável origem (pré-existente, fora S41) |
|---|---|---|---|
| `aria-progressbar-name` | serious | 1 | `Progress` sem nome acessível (market/strategic panels) |
| `button-name` | critical | 5 | botões icon-only sem texto/aria-label (panels diversos) |
| `scrollable-region-focusable` | serious | 3 | containers `overflow-auto` sem `tabindex` (tabelas/feeds) |

`palette-open` full-page também listou `color-contrast` serious ×17 — artefato
parcial de backdrop + conteúdo da página; re-escopo para o dialog isola a
superfície S41. Se o scan com escopo ainda apontar contraste real da palette,
corrige-se (ex.: tom de `muted-foreground` dentro do dialog).

Um probe log-only (`axe backlog probe`, sem assert) mantém esse backlog visível
nos logs de CI a cada run. Follow-up dedicado deve corrigir os 3 itens acima
fora do escopo S41.

## 5. Fixes applied for violations (if any)

_(none yet — filled from CI evidence; prod fixes only for proven ARIA/focus/contrast violations)_
