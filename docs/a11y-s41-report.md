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

## 4. Results (pending PR CI — updated after green run)

- [ ] dashboard+news: 0 serious/critical
- [ ] palette-open: 0 serious/critical
- [ ] wizard-step-0: 0 serious/critical
- [ ] pricing: 0 serious/critical
- [ ] moderate/minor backlog triaged (none hidden)

## 5. Fixes applied for violations (if any)

_(none yet — filled from CI evidence; prod fixes only for proven ARIA/focus/contrast violations)_
