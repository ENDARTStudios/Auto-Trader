import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXTERNAL_SYSTEMS, EXTERNAL_LAYERS, getExternalSystem, coveredLayers,
  type ExternalLayer, type LicenseClass, type IntegrationStatus,
} from '@/lib/trading/external-systems';

const VALID_LAYERS = new Set<string>(EXTERNAL_LAYERS);
const VALID_LICENSES = new Set<string>(['permissive', 'copyleft', 'fair-code']);
const VALID_STATUS = new Set<string>(['wired', 'dependency', 'spec-only']);

describe('External systems registry (9 skills, advisory-only)', () => {
  it('registry tem exatamente 9 sistemas, ids únicos', () => {
    expect(EXTERNAL_SYSTEMS.length).toBe(9);
    const ids = EXTERNAL_SYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(9);
  });

  it('todos advisoryOnly=true (regra-mãe: ninguém decide/executa)', () => {
    for (const s of EXTERNAL_SYSTEMS) expect(s.advisoryOnly).toBe(true);
  });

  it('layers/licenses/status válidos; skillFile aponta p/ skills/ext-*.md', () => {
    for (const s of EXTERNAL_SYSTEMS) {
      expect(s.layers.length).toBeGreaterThan(0);
      for (const l of s.layers) expect(VALID_LAYERS.has(l as string)).toBe(true);
      expect(VALID_LICENSES.has(s.licenseClass as LicenseClass)).toBe(true);
      expect(VALID_STATUS.has(s.status as IntegrationStatus)).toBe(true);
      expect(s.skillFile.startsWith('skills/ext-')).toBe(true);
    }
  });

  it('arquivos de skill existem no disco', () => {
    for (const s of EXTERNAL_SYSTEMS) {
      expect(existsSync(resolve(s.skillFile))).toBe(true);
    }
    expect(existsSync(resolve('skills/EXTERNAL_SYSTEMS_INDEX.md'))).toBe(true);
  });

  it('copyleft/fair-code nunca são dependency/wired com código (só spec)', () => {
    for (const s of EXTERNAL_SYSTEMS) {
      if (s.licenseClass !== 'permissive') expect(s.status).toBe('spec-only');
    }
    // única dependência viva é CCXT (MIT, package.json)
    const deps = EXTERNAL_SYSTEMS.filter((s) => s.status === 'dependency');
    expect(deps.map((s) => s.id)).toEqual(['ccxt']);
  });

  it('cobertura: todas as 8 camadas têm ao menos um sistema; execução é S14-gated', () => {
    const covered = coveredLayers();
    for (const l of EXTERNAL_LAYERS as ExternalLayer[]) {
      expect(covered).toContain(l);
    }
    const executors = EXTERNAL_SYSTEMS.filter((s) => s.layers.includes('execution'));
    expect(executors.length).toBeGreaterThan(0);
    for (const e of executors) {
      expect(['dependency', 'spec-only']).toContain(e.status);
    }
  });

  it('getExternalSystem: hit + miss', () => {
    expect(getExternalSystem('ccxt')?.repo).toContain('ccxt/ccxt');
    expect(getExternalSystem('inexistente')).toBeNull();
  });

  it('registry não expõe superfície de execução', () => {
    const keys = EXTERNAL_SYSTEMS.flatMap((s) => Object.keys(s));
    for (const k of ['place_order', 'placeOrder', 'execute', 'submitOrder', 'trader']) {
      expect(keys).not.toContain(k);
    }
  });
});
