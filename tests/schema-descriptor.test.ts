import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import {
  DEFAULT_DESCRIPTOR, loadDescriptor,
} from '@/lib/trading/schema-descriptor';

describe('Fase 4.1 — schema descriptor (B-fim por design)', () => {
  it('default usa só keys ALTA do core; debate MÉDIO presente mas marcado', () => {
    expect(DEFAULT_DESCRIPTOR.prosa_keys.technical).toBe('market_report');
    expect(DEFAULT_DESCRIPTOR.prosa_keys.fundamental).toBe('fundamentals_report');
    expect(DEFAULT_DESCRIPTOR.prosa_keys.macro).toBe('news_report'); // derivado
    expect(DEFAULT_DESCRIPTOR.decision_keys.final).toBe('final_trade_decision');
    expect(DEFAULT_DESCRIPTOR.json_mode_detected).toBe(false);
  });

  it('sem path → default; path inexistente → default (nunca crash)', () => {
    expect(loadDescriptor()).toEqual(DEFAULT_DESCRIPTOR);
    expect(loadDescriptor('/nonexistent/descriptor.json')).toEqual(DEFAULT_DESCRIPTOR);
  });

  it('merge defensivo: só aceita keys não-null do manifest', () => {
    const tmp = '/tmp/desc-test.json';
    writeFileSync(tmp, JSON.stringify({
      prosa_keys: { technical: 'custom_tech', sentiment: null },
      debate_keys: { bull: 'bull_argument' },
    }), 'utf8');
    try {
      const d = loadDescriptor(tmp);
      expect(d.prosa_keys.technical).toBe('custom_tech'); // manifest confirmou
      expect(d.prosa_keys.sentiment).toBe('social_media_report'); // null → default
      expect(d.debate_keys.bull).toBe('bull_argument');
      expect(d.debate_keys.bear).toBe('bear_history'); // default
    } finally {
      unlinkSync(tmp);
    }
  });
});
