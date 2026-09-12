import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXTERNAL_SYSTEMS, EXTERNAL_LAYERS, getExternalSystem, coveredLayers, byCategory,
  type ExternalLayer, type LicenseClass, type IntegrationStatus, type SystemCategory,
} from '@/lib/trading/external-systems';

const VALID_LAYERS = new Set<string>(EXTERNAL_LAYERS);
const VALID_LICENSES = new Set<string>(['permissive', 'copyleft', 'fair-code', 'unverified']);
const VALID_STATUS = new Set<string>(['wired', 'dependency', 'spec-only']);
const VALID_CATEGORIES = new Set<string>(['trading', 'agent-infra']);

describe('External systems registry (19 skills, advisory-only)', () => {
  it('registry tem 19 sistemas (9 trading + 10 agent-infra), ids únicos', () => {
    expect(EXTERNAL_SYSTEMS.length).toBe(19);
    const ids = EXTERNAL_SYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(19);
    expect(byCategory('trading').length).toBe(9);
    expect(byCategory('agent-infra').length).toBe(10);
  });

  it('todos advisoryOnly=true (regra-mãe: ninguém decide/executa)', () => {
    for (const s of EXTERNAL_SYSTEMS) expect(s.advisoryOnly).toBe(true);
  });

  it('layers/licenses/status/categorias válidos; skillFile em skills/', () => {
    for (const s of EXTERNAL_SYSTEMS) {
      expect(s.layers.length).toBeGreaterThan(0);
      for (const l of s.layers) expect(VALID_LAYERS.has(l as string)).toBe(true);
      expect(VALID_LICENSES.has(s.licenseClass as LicenseClass)).toBe(true);
      expect(VALID_STATUS.has(s.status as IntegrationStatus)).toBe(true);
      expect(VALID_CATEGORIES.has(s.category as SystemCategory)).toBe(true);
      expect(s.skillFile.startsWith('skills/')).toBe(true);
    }
    // convenção de prefixo por categoria
    for (const s of byCategory('trading')) expect(s.skillFile.startsWith('skills/ext-')).toBe(true);
    for (const s of byCategory('agent-infra')) expect(s.skillFile.startsWith('skills/agent-')).toBe(true);
  });

  it('arquivos de skill existem no disco', () => {
    for (const s of EXTERNAL_SYSTEMS) {
      expect(existsSync(resolve(s.skillFile))).toBe(true);
    }
    expect(existsSync(resolve('skills/EXTERNAL_SYSTEMS_INDEX.md'))).toBe(true);
  });

  it('copyleft/fair-code/unverified nunca são dependency/wired com código (só spec)', () => {
    for (const s of EXTERNAL_SYSTEMS) {
      if (s.licenseClass !== 'permissive') expect(s.status).toBe('spec-only');
    }
    // única dependência viva é CCXT (MIT, package.json)
    const deps = EXTERNAL_SYSTEMS.filter((s) => s.status === 'dependency');
    expect(deps.map((s) => s.id)).toEqual(['ccxt']);
  });

  it('cobertura: todas as 9 camadas têm ao menos um sistema; execução é S14-gated', () => {
    const covered = coveredLayers();
    for (const l of EXTERNAL_LAYERS as ExternalLayer[]) {
      expect(covered).toContain(l);
    }
    const executors = EXTERNAL_SYSTEMS.filter((s) => s.layers.includes('execution'));
    expect(executors.length).toBeGreaterThan(0);
    for (const e of executors) {
      expect(['dependency', 'spec-only']).toContain(e.status);
    }
    // camada docs coberta por agent-infra (diagram-design)
    expect(byCategory('agent-infra').some((s) => s.layers.includes('docs'))).toBe(true);
  });

  it('getExternalSystem: hit trading + hit agent-infra + miss', () => {
    expect(getExternalSystem('ccxt')?.repo).toContain('ccxt/ccxt');
    expect(getExternalSystem('strix')?.repo).toContain('usestrix/strix');
    expect(getExternalSystem('inexistente')).toBeNull();
  });

  it('registry não expõe superfície de execução', () => {
    const keys = EXTERNAL_SYSTEMS.flatMap((s) => Object.keys(s));
    for (const k of ['place_order', 'placeOrder', 'execute', 'submitOrder', 'trader']) {
      expect(keys).not.toContain(k);
    }
  });
});
