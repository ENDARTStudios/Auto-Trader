/**
 * Fase 4 — Envelope operacional.
 * Skill v1.6. Guardrail central: "evolucao nunca afrouxa risco" (§5.5/§7)
 * implementado como WRITE-FENCE: o learner so escreve em paths permitidos.
 * Qualquer tentativa de escrever em risk_config / dag_edges vivo / mode.json
 * LANCA e e logada para auditoria (5.14).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface RiskConfig {
  learner_forbidden_paths: string[];
  learner_writable_paths: string[];
  sla_days: number;
  n_min_forward: number;
  forward_deadline_days: number;
  t_lang_days: number;
  dag_fail_rate_limit: number;
  canary_stages_pct: number[];
}

export interface Envelope {
  risk: Record<string, unknown>;
  riskMeta: { learner_writable: boolean; version: string };
  dagEdges: { nodes: string[]; edges: { from: string; to: string; mechanism: string }[] };
  mode: { state: string; reason: string | null; timestamp: number };
  cfg: RiskConfig;
}

/** Carrega o envelope. Falha = abort (nao opera sem risk-limits, §1). */
export function loadEnvelope(root: string): Envelope {
  const riskPath = resolve(root, 'config/risk_config.json');
  const dagPath = resolve(root, 'config/dag_edges.json');
  const modePath = resolve(root, 'state/mode.json');

  if (!existsSync(riskPath) || !existsSync(dagPath)) {
    throw new Error('ENVELOPE_INCOMPLETE: risk_config/dag_edges ausentes — abort (nao opera sem limites)');
  }

  const risk = JSON.parse(readFileSync(riskPath, 'utf8'));
  const dagEdges = JSON.parse(readFileSync(dagPath, 'utf8'));
  const mode = existsSync(modePath)
    ? { ...JSON.parse(readFileSync(modePath, 'utf8')), timestamp: Date.parse(JSON.parse(readFileSync(modePath, 'utf8')).timestamp) }
    : { state: 'ok', reason: null, timestamp: Date.now() };

  const env = risk.evolution_envelope as RiskConfig;
  if (env.learner_forbidden_paths?.includes('config/risk_config.json') === false) {
    throw new Error('ENVELOPE_MISCONFIG: risk_config nao se autoproibiu ao learner — abort');
  }
  return {
    risk,
    riskMeta: { learner_writable: risk._meta.learner_writable, version: risk._meta.version },
    dagEdges,
    mode,
    cfg: env,
  };
}

/**
 * WRITE-FENCE: unico ponto de escrita do learner.
 * Se o path cair em forbidden -> lanca + loga escalacao (5.14).
 * E a materializacao de "o learner so mexe em pesos/prompts/quarentena".
 */
export function learnerWrite(
  env: Envelope,
  relPath: string,
  content: string,
  auditLog: (msg: string) => void,
): void {
  const norm = relPath.replace(/^\.\//, '');
  const forbidden = env.cfg.learner_forbidden_paths.some((p) => matchGlob(p, norm));
  const allowed = env.cfg.learner_writable_paths.some((p) => matchGlob(p, norm));

  if (forbidden) {
    auditLog(`RISK_FENCE_VIOLATION: learner tentou escrever em ${norm} (forbidden). Bloqueado + escalado.`);
    throw new Error(`RISK_FENCE_VIOLATION: ${norm}`);
  }
  if (!allowed) {
    auditLog(`RISK_FENCE_UNKNOWN_PATH: ${norm} nao esta em writable nem forbidden. Bloqueado por default-deny.`);
    throw new Error(`RISK_FENCE_UNKNOWN_PATH: ${norm}`);
  }
  writeFileSync(resolve(norm), content, 'utf8');
  auditLog(`LEARNER_WRITE: ${norm}`);
}

/**
 * Escrita de modo (state machine) e SO do runtime/cron, nunca do learner.
 * Aplica precedencia monotonica em conservadorismo (8c).
 */
export function runtimeSetMode(
  env: Envelope,
  next: { state: string; reason: string },
  severity: Record<string, number>,
  auditLog: (msg: string) => void,
): void {
  const cur = env.mode.state;
  // crisis_lock absorvente: nao escala p/ frozen (8b).
  if (cur === 'crisis_lock' && next.state === 'frozen_autonomy') {
    auditLog('MODE_BLOCK: crisis_lock absorvente — frozen nao se aplica (8b).');
    return;
  }
  const resolved = (severity[next.state] ?? 0) >= (severity[cur] ?? 0) ? next.state : cur;
  if (resolved !== cur) {
    env.mode = { state: resolved, reason: next.reason, timestamp: Date.now() };
    writeFileSync(resolve('state/mode.json'), JSON.stringify({
      state: resolved, reason: next.reason, timestamp: new Date().toISOString(),
    }, null, 2), 'utf8');
    auditLog(`MODE_TRANSITION: ${cur} -> ${resolved} (${next.reason})`);
  }
}

/** glob simples: "a/**" casa "a/b/c"; "a/b.json" casa exato. */
function matchGlob(pattern: string, path: string): boolean {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3));
  return pattern === path;
}
