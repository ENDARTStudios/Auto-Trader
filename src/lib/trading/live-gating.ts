// src/lib/trading/live-gating.ts — gate FAIL-CLOSED para execução LIVE.
//
// A execução real de ordens só pode acontecer quando TODAS as condições abaixo
// são verdadeiras. Qualquer ausência/valeu diferente → negado (não lança):
//
//   1. cfg.mode === "live"
//   2. cfg.graduatedToLive === true
//   3. cfg.killSwitchActive !== true
//   4. env LIVE_TRADING_ENABLED === "true"   (opt-in explícito de infra)
//   5. env S14_APPROVED === "true"           (aprovação humana de envelope)
//   6. feature flag "enable_live_trading"    (isEnabled)
//
// O default do repositório/produção é NÃO ter 4/5 e ter 6 desligado: live fica
// desligado mesmo que alguém ligue mode=live no DB. O gate retorna um resultado
// tipado; quem executa deve tratar { allowed: false } como falha terminal (nunca
// cair para paper, nunca inventar fill).

import { isEnabled } from "./feature-flags";

export const LIVE_TRADING_FLAG_KEY = "enable_live_trading";

export type LiveGateResult =
  | { allowed: true }
  | { allowed: false; code: "LIVE_DISABLED"; reason: string };

export class LiveExecutionDisabledError extends Error {
  readonly code = "LIVE_DISABLED" as const;
  readonly reason: string;
  constructor(reason: string) {
    super(`LIVE_DISABLED: ${reason}`);
    this.name = "LiveExecutionDisabledError";
    this.reason = reason;
  }
}

export interface LiveGateConfig {
  mode: string;
  graduatedToLive: boolean;
  killSwitchActive?: boolean;
}

export interface LiveGateDeps {
  /** Default: process.env. Injetável para testes determinísticos. */
  env?: Record<string, string | undefined>;
  /** Default: isEnabled do feature-flags. Injetável para testes. */
  isFlagEnabled?: (key: string) => Promise<boolean>;
}

function denied(reason: string): LiveGateResult {
  return { allowed: false, code: "LIVE_DISABLED", reason };
}

/**
 * Pure evaluation once the feature flag has been resolved. Exposed for the test
 * matrix (all 2^6 combinations are cheap to assert here).
 */
export function evaluateLiveGate(
  cfg: LiveGateConfig,
  env: Record<string, string | undefined>,
  flagEnabled: boolean
): LiveGateResult {
  if (cfg.mode !== "live") {
    return denied(`mode='${String(cfg.mode)}' (exige 'live')`);
  }
  if (cfg.graduatedToLive !== true) {
    return denied("graduatedToLive=false (graduação paper→live não concluída)");
  }
  if (cfg.killSwitchActive === true) {
    return denied("killSwitchActive=true");
  }
  if (env.LIVE_TRADING_ENABLED !== "true") {
    return denied("env LIVE_TRADING_ENABLED !== 'true'");
  }
  if (env.S14_APPROVED !== "true") {
    return denied("env S14_APPROVED !== 'true'");
  }
  if (flagEnabled !== true) {
    return denied(`feature flag '${LIVE_TRADING_FLAG_KEY}' desligada`);
  }
  return { allowed: true };
}

/** Async gate used by the execution path. Never throws; never defaults to on. */
export async function checkLiveGate(
  cfg: LiveGateConfig,
  deps: LiveGateDeps = {}
): Promise<LiveGateResult> {
  const env = deps.env ?? process.env;
  const flagResolver = deps.isFlagEnabled ?? isEnabled;

  // Cheap checks first — avoid touching the feature-flag store/DB when live is
  // obviously disabled (the common production state).
  const preFlag = evaluateLiveGate(cfg, env, true);
  if (!preFlag.allowed) return preFlag;

  let flagEnabled = false;
  try {
    flagEnabled = (await flagResolver(LIVE_TRADING_FLAG_KEY)) === true;
  } catch {
    // Flag store unavailable => fail closed.
    flagEnabled = false;
  }
  return evaluateLiveGate(cfg, env, flagEnabled);
}

/** Throwing variant for adapters. Callers that need a typed error use this. */
export async function assertLiveAllowed(
  cfg: LiveGateConfig,
  deps: LiveGateDeps = {}
): Promise<void> {
  const gate = await checkLiveGate(cfg, deps);
  if (!gate.allowed) throw new LiveExecutionDisabledError(gate.reason);
}
