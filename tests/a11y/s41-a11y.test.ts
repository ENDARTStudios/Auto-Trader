import { describe, it, expect } from 'vitest';
import {
  expectNoSeriousOrCritical,
  type AxeSummary,
} from '../../e2e/a11y-helpers';

// T062 — unit lock on the a11y gate policy: serious/critical fail the gate,
// moderate/minor are backlog (logged, not failing). Browser scan itself runs
// in e2e/s41-a11y-axe.spec.ts (Playwright + @axe-core/playwright).

describe('a11y gate policy (expectNoSeriousOrCritical)', () => {
  it('passes on a clean scan', () => {
    const s: AxeSummary = { seriousOrCritical: [], moderateOrMinor: [] };
    expect(() => expectNoSeriousOrCritical(s, 'ctx')).not.toThrow();
  });

  it('passes when only moderate/minor violations exist (backlog)', () => {
    const s: AxeSummary = {
      seriousOrCritical: [],
      moderateOrMinor: [{ id: 'color-contrast', impact: 'moderate', nodes: 3 }],
    };
    expect(() => expectNoSeriousOrCritical(s, 'ctx')).not.toThrow();
  });

  it('fails on serious violations', () => {
    const s: AxeSummary = {
      seriousOrCritical: [{ id: 'aria-required-children', impact: 'serious', nodes: 1 }],
      moderateOrMinor: [],
    };
    expect(() => expectNoSeriousOrCritical(s, 'ctx')).toThrow(/serious\/critical/);
  });

  it('fails on critical violations', () => {
    const s: AxeSummary = {
      seriousOrCritical: [{ id: 'color-contrast', impact: 'critical', nodes: 2 }],
      moderateOrMinor: [],
    };
    expect(() => expectNoSeriousOrCritical(s, 'ctx')).toThrow(/color-contrast/);
  });
});
