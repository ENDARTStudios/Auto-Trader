import { describe, it, expect } from 'vitest';
import {
  BRIDGE_HINT,
  evaluateBypassRole,
  isPostgresUrl,
} from '../scripts/lib/require-bypass-rls.mjs';
import {
  RLS_TABLES,
  classifyPolicy,
  evaluateStrictness,
} from '../scripts/verify-rls-enforcement.mjs';

describe('rls guard — decisão de role (puro)', () => {
  it('BYPASSRLS permite manutenção', () => {
    const r = evaluateBypassRole({ currentUser: 'owner', rolsuper: false, rolbypassrls: true });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe('OK');
    expect(r.reason).toContain('BYPASSRLS');
  });

  it('SUPERUSER permite manutenção', () => {
    const r = evaluateBypassRole({ currentUser: 'postgres', rolsuper: true, rolbypassrls: false });
    expect(r.allowed).toBe(true);
    expect(r.reason).toContain('SUPERUSER');
  });

  it('app role (NOBYPASSRLS, não-superuser) BLOQUEIA com motivo acionável', () => {
    const r = evaluateBypassRole({ currentUser: 'autotrader_app', rolsuper: false, rolbypassrls: false });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('RLS_BYPASS_REQUIRED');
    expect(r.reason).toContain('autotrader_app');
    expect(r.reason).toContain('falhar silenciosamente');
    expect(BRIDGE_HINT).toContain('withSystemRls');
  });

  it('sem atributos (undefined) falha fechado', () => {
    expect(evaluateBypassRole(undefined).allowed).toBe(false);
    expect(evaluateBypassRole({}).allowed).toBe(false);
  });

  it('isPostgresUrl distingue postgres de sqlite/outros', () => {
    expect(isPostgresUrl('postgresql://u:p@h:5432/db')).toBe(true);
    expect(isPostgresUrl('postgres://u@h/db')).toBe(true);
    expect(isPostgresUrl('file:./db/custom.db')).toBe(false);
    expect(isPostgresUrl('mysql://h/db')).toBe(false);
    expect(isPostgresUrl(undefined)).toBe(false);
  });
});

describe('verify-rls — classificação STRICT/PERMISSIVE (catálogo)', () => {
  const permissiveQual =
    "((current_setting('app.rls_bypass'::text, true) = 'on'::text) OR (NULLIF(current_setting('app.user_id'::text, true), ''::text) IS NULL) OR (\"ownerId\" = current_setting('app.user_id'::text, true)))";
  const strictQual =
    "((current_setting('app.rls_bypass'::text, true) = 'on'::text) OR (\"ownerId\" = current_setting('app.user_id'::text, true)))";

  it('policy com NULLIF(current_setting(app.user_id)) = PERMISSIVE', () => {
    const c = classifyPolicy({ qual: permissiveQual });
    expect(c.mode).toBe('PERMISSIVE');
    expect(c.hasContextClause).toBe(true);
  });

  it('policy sem a cláusula = STRICT', () => {
    expect(classifyPolicy({ qual: strictQual }).mode).toBe('STRICT');
  });

  it('policy ausente/sem qual é tratada como STRICT (fail-safe do classificador)', () => {
    expect(classifyPolicy({}).mode).toBe('STRICT');
    expect(classifyPolicy(null).mode).toBe('STRICT');
  });

  it('evaluateStrictness agrega as 4 tabelas: ALL_STRICT / PARTIAL / NONE', () => {
    const all = Object.fromEntries(RLS_TABLES.map((t) => [t, [{ qual: strictQual }]]));
    expect(evaluateStrictness(all).verdict).toBe('ALL_STRICT');

    const partial = { ...all, Position: [{ qual: permissiveQual }], NotificationChannel: [{ qual: permissiveQual }] };
    const p = evaluateStrictness(partial);
    expect(p.verdict).toBe('PARTIAL_STRICT');
    expect(p.permissiveTables).toEqual(['Position', 'NotificationChannel']);

    const none = Object.fromEntries(RLS_TABLES.map((t) => [t, [{ qual: permissiveQual }]]));
    expect(evaluateStrictness(none).verdict).toBe('NONE_STRICT');

    // tabela sem policy nenhuma conta como não-strict (MISSING)
    const missing = { ...all };
    delete missing.ExchangeConnection;
    const m = evaluateStrictness(missing);
    expect(m.verdict).toBe('PARTIAL_STRICT');
    expect(m.permissiveTables).toContain('ExchangeConnection');
  });
});
