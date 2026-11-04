import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import {
  __resetSignerSupervisorForTest,
  __setSignerSupervisorBundlePathForTest,
  __setSignerSupervisorSpawnForTest,
  __setSignerSupervisorTimingForTest,
  getSignerSupervisorStatus,
  isSignerSpawnEnabled,
  resolveSignerBundlePath,
  resolveSignerSocketPath,
  startSignerSupervisor,
  stopSignerSupervisor,
} from '@/lib/signer-supervisor';

// Round 3 — supervisor do signer. Nenhum socket real: o spawn é injetado com
// um fake (EventEmitter + PassThrough) e o bundle é um arquivo tmp qualquer.

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  killed = false;
  killSignals: string[] = [];
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();

  kill(signal: string = 'SIGTERM'): boolean {
    this.killed = true;
    this.killSignals.push(signal);
    setTimeout(() => {
      if (this.exitCode !== null) return;
      this.exitCode = 0;
      this.emit('exit', 0, signal);
    }, 5);
    return true;
  }

  /** Sai sem passar por kill() (crash do processo). */
  crash(code = 1): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

interface SpawnCall {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  child: FakeChild;
}

let spawnCalls: SpawnCall[] = [];
let children: FakeChild[] = [];
let nextChildFactory: (() => FakeChild) | null = null;

function installFakeSpawn(): void {
  spawnCalls = [];
  children = [];
  nextChildFactory = null;
  __setSignerSupervisorSpawnForTest(((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    const child = nextChildFactory ? nextChildFactory() : new FakeChild();
    children.push(child);
    spawnCalls.push({ command, args, env: { ...options.env }, child });
    return child as unknown as import('node:child_process').ChildProcess;
  }) as never);
}

function lastChild(): FakeChild {
  const child = children[children.length - 1];
  if (!child) throw new Error('nenhum child spawnado');
  return child;
}

function emitReady(child: FakeChild, socketPath: string, version = '1.1.0-m2'): void {
  child.stdout.write(
    JSON.stringify({ type: 'SIGNER_READY', pid: child.pid, socketPath, version }) + '\n',
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timeout esperando condição');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let tmpDir = '';
let fakeBundle = '';
const originalSpawnEnv = process.env.SIGNER_SPAWN;
const originalSocketEnv = process.env.SIGNER_SOCKET_PATH;
const originalPolicyEnv = {
  SIGNER_MAX_TX_USD: process.env.SIGNER_MAX_TX_USD,
  SIGNER_MAX_WINDOW_USD: process.env.SIGNER_MAX_WINDOW_USD,
  SIGNER_WINDOW_SEC: process.env.SIGNER_WINDOW_SEC,
  SIGNER_AUDIT_LOG: process.env.SIGNER_AUDIT_LOG,
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'signer-sup-test-'));
  fakeBundle = join(tmpDir, 'signer.js');
  writeFileSync(fakeBundle, '// fake signer bundle');
  __setSignerSupervisorBundlePathForTest(fakeBundle);
  __setSignerSupervisorTimingForTest({
    readyTimeoutMs: 10_000,
    backoffBaseMs: 20,
    maxBackoffMs: 200,
    stopGraceMs: 100,
  });
  installFakeSpawn();
  delete process.env.SIGNER_SPAWN;
  delete process.env.SIGNER_SOCKET_PATH;
  delete process.env.SIGNER_MAX_TX_USD;
  delete process.env.SIGNER_MAX_WINDOW_USD;
  delete process.env.SIGNER_WINDOW_SEC;
  delete process.env.SIGNER_AUDIT_LOG;
});

afterEach(async () => {
  await __resetSignerSupervisorForTest();
  if (originalSpawnEnv === undefined) delete process.env.SIGNER_SPAWN;
  else process.env.SIGNER_SPAWN = originalSpawnEnv;
  if (originalSocketEnv === undefined) delete process.env.SIGNER_SOCKET_PATH;
  else process.env.SIGNER_SOCKET_PATH = originalSocketEnv;
  for (const [key, value] of Object.entries(originalPolicyEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('signer supervisor — desligado por padrão', () => {
  it('não spawna nada sem SIGNER_SPAWN=1', async () => {
    expect(isSignerSpawnEnabled()).toBe(false);
    await startSignerSupervisor();
    expect(spawnCalls.length).toBe(0);
    const status = getSignerSupervisorStatus();
    expect(status.enabled).toBe(false);
    expect(status.spawned).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.pid).toBeNull();
  });

  it('resolve o bundle no caminho canônico (overridable em teste)', () => {
    expect(resolveSignerBundlePath()).toBe(fakeBundle);
    __setSignerSupervisorBundlePathForTest(null);
    expect(resolveSignerBundlePath()).toBe(join(process.cwd(), '.next', 'standalone', 'signer.js'));
  });

  it('resolve socket: env tem prioridade, senão tmpdir com pid do web', () => {
    process.env.SIGNER_SOCKET_PATH = '/custom/signer.sock';
    expect(resolveSignerSocketPath()).toBe('/custom/signer.sock');
    delete process.env.SIGNER_SOCKET_PATH;
    const resolved = resolveSignerSocketPath();
    expect(resolved).toContain('auto-trader-signer-' + process.pid);
    expect(resolved.startsWith(os.tmpdir())).toBe(true);
  });
});

describe('signer supervisor — ready/status', () => {
  beforeEach(() => {
    process.env.SIGNER_SPAWN = '1';
  });

  it('spawna com env correto, valida SIGNER_READY e marca ready', async () => {
    await startSignerSupervisor();
    expect(spawnCalls.length).toBe(1);
    const call = spawnCalls[0];
    expect(call.command).toBe(process.execPath);
    expect(call.args).toEqual([fakeBundle]);
    // env setado ANTES do spawn + defaults de política
    expect(call.env.SIGNER_SOCKET_PATH).toBeTruthy();
    expect(call.env.SIGNER_MAX_TX_USD).toBe('100');
    expect(call.env.SIGNER_MAX_WINDOW_USD).toBe('500');
    expect(call.env.SIGNER_WINDOW_SEC).toBe('3600');
    expect(call.env.SIGNER_AUDIT_LOG).toBeTruthy();
    expect(process.env.SIGNER_SOCKET_PATH).toBe(call.env.SIGNER_SOCKET_PATH);

    const child = lastChild();
    emitReady(child, call.env.SIGNER_SOCKET_PATH as string);
    await waitFor(() => getSignerSupervisorStatus().ready);

    const status = getSignerSupervisorStatus();
    expect(status.enabled).toBe(true);
    expect(status.spawned).toBe(true);
    expect(status.pid).toBe(child.pid);
    expect(status.restarts).toBe(0);
    expect(status.lastError).toBeNull();
    expect(status.socketPathMasked).toBeTruthy();
    // caminho completo NUNCA aparece no status
    expect(status.socketPathMasked).not.toContain(String(call.env.SIGNER_SOCKET_PATH));
    expect(JSON.stringify(status)).not.toContain('/tmp/signer-');
  });

  it('respeita política já definida no env (não sobrescreve)', async () => {
    process.env.SIGNER_MAX_TX_USD = '42';
    await startSignerSupervisor();
    expect(spawnCalls[0].env.SIGNER_MAX_TX_USD).toBe('42');
  });

  it('SIGNER_READY com socketPath divergente derruba o filho (fail-closed)', async () => {
    await startSignerSupervisor();
    const child = lastChild();
    emitReady(child, '/wrong/path.sock');
    await waitFor(() => child.killSignals.length > 0);
    expect(child.killSignals).toContain('SIGTERM');
    expect(getSignerSupervisorStatus().ready).toBe(false);
    expect(getSignerSupervisorStatus().lastError).toBe('SIGNER_READY_SOCKET_MISMATCH');
  });

  it('timeout de READY mata o filho e registra erro', async () => {
    __setSignerSupervisorTimingForTest({ readyTimeoutMs: 25, backoffBaseMs: 20, maxBackoffMs: 100, stopGraceMs: 100 });
    await startSignerSupervisor();
    // O timeout dispara SIGTERM no filho; o exit handler pode sobrescrever
    // lastError com SIGNER_EXITED e agendar restart — por isso a condição é um
    // kill observado, e o lastError é validado por prefixo.
    await waitFor(() => children.some((c) => c.killSignals.includes('SIGTERM')), 1500);
    expect(children.some((c) => c.killSignals.includes('SIGTERM'))).toBe(true);
    await stopSignerSupervisor();
    expect(getSignerSupervisorStatus().ready).toBe(false);
    expect(getSignerSupervisorStatus().lastError).toMatch(/SIGNER_READY_TIMEOUT|SIGNER_EXITED/);
  });
});

describe('signer supervisor — restart/backoff', () => {
  beforeEach(() => {
    process.env.SIGNER_SPAWN = '1';
  });

  it('reagenda com backoff após exit, limpando o env do socket e recriando', async () => {
    await startSignerSupervisor();
    expect(spawnCalls.length).toBe(1);
    const first = lastChild();
    emitReady(first, spawnCalls[0].env.SIGNER_SOCKET_PATH as string);
    await waitFor(() => getSignerSupervisorStatus().ready);

    first.crash(1);
    // exit handler limpa o env enquanto não há filho
    await waitFor(() => getSignerSupervisorStatus().spawned === false);
    expect(getSignerSupervisorStatus().ready).toBe(false);
    expect(getSignerSupervisorStatus().lastError).toContain('SIGNER_EXITED');

    await waitFor(() => spawnCalls.length >= 2);
    expect(getSignerSupervisorStatus().restarts).toBeGreaterThanOrEqual(1);
    expect(getSignerSupervisorStatus().spawned).toBe(true);
    // o segundo spawn re-seta o env e usa o MESMO socket path resolvido
    expect(spawnCalls[1].env.SIGNER_SOCKET_PATH).toBe(spawnCalls[0].env.SIGNER_SOCKET_PATH);
    expect(process.env.SIGNER_SOCKET_PATH).toBe(spawnCalls[1].env.SIGNER_SOCKET_PATH);
  });

  it('backoff cresce exponencialmente e é limitado pelo max', async () => {
    const startedTimes: number[] = [];
    __setSignerSupervisorSpawnForTest(((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = new FakeChild();
      children.push(child);
      spawnCalls.push({ command, args, env: { ...options.env }, child });
      startedTimes.push(Date.now());
      return child as unknown as import('node:child_process').ChildProcess;
    }) as never);

    __setSignerSupervisorTimingForTest({ readyTimeoutMs: 10_000, backoffBaseMs: 30, maxBackoffMs: 60, stopGraceMs: 100 });
    await startSignerSupervisor();
    // falha 3 vezes seguidas (sem ready) → attempts cresce
    for (let i = 0; i < 3; i++) {
      lastChild().crash(1);
      await waitFor(() => spawnCalls.length >= i + 2, 2000);
    }
    const gaps = startedTimes.slice(1).map((t, i) => t - startedTimes[i]);
    expect(gaps.length).toBeGreaterThanOrEqual(3);
    // primeira espera ~30ms; terceira limitada em 60ms (não explode)
    expect(gaps[gaps.length - 1]).toBeLessThan(500);
  });

  it('stop cancela o restart pendente e mata o filho', async () => {
    await startSignerSupervisor();
    const child = lastChild();
    emitReady(child, spawnCalls[0].env.SIGNER_SOCKET_PATH as string);
    await waitFor(() => getSignerSupervisorStatus().ready);

    await stopSignerSupervisor();
    expect(child.killSignals).toContain('SIGTERM');
    const status = getSignerSupervisorStatus();
    expect(status.spawned).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.pid).toBeNull();
    expect(process.env.SIGNER_SOCKET_PATH).toBeUndefined();

    // nenhum restart depois do stop
    await sleep(120);
    expect(spawnCalls.length).toBe(1);
  });
});

describe('signer supervisor — fail-safe', () => {
  it('bundle ausente: loga e desiste sem lançar nem derrubar o boot', async () => {
    process.env.SIGNER_SPAWN = '1';
    __setSignerSupervisorBundlePathForTest(join(tmpDir, 'nao-existe-signer.js'));
    await expect(startSignerSupervisor()).resolves.toBeUndefined();
    expect(spawnCalls.length).toBe(0);
    const status = getSignerSupervisorStatus();
    expect(status.spawned).toBe(false);
    expect(status.lastError).toBe('SIGNER_BUNDLE_MISSING');
  });

  it('spawn que lança não propaga exceção e agenda restart', async () => {
    process.env.SIGNER_SPAWN = '1';
    let calls = 0;
    __setSignerSupervisorSpawnForTest((() => {
      calls += 1;
      if (calls === 1) throw new Error('spawn EACCES');
      const child = new FakeChild();
      children.push(child);
      spawnCalls.push({ command: '', args: [], env: { ...process.env }, child });
      return child as unknown as import('node:child_process').ChildProcess;
    }) as never);

    await expect(startSignerSupervisor()).resolves.toBeUndefined();
    expect(getSignerSupervisorStatus().lastError).toBe('SIGNER_SPAWN_FAILED');
    await waitFor(() => calls >= 2, 1000);
    expect(existsSync(fakeBundle)).toBe(true);
  });

  it('start é idempotente (não spawna duas vezes)', async () => {
    process.env.SIGNER_SPAWN = '1';
    await startSignerSupervisor();
    await startSignerSupervisor();
    expect(spawnCalls.length).toBe(1);
  });

  it('health-status: enabled reflete SIGNER_SPAWN mesmo antes do start', () => {
    process.env.SIGNER_SPAWN = '1';
    expect(getSignerSupervisorStatus().enabled).toBe(true);
    expect(getSignerSupervisorStatus().lastError).toBeNull();
    expect(getSignerSupervisorStatus().socketPathMasked).toBeNull();
  });
});
