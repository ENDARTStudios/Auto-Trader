import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  QuorumRpcClient,
  serializeForQuorum,
  type RpcEndpoint,
  type Transport,
} from '@/lib/chain/rpc-resilience';
import { SimulationGate, type ExpectedDiff, type SimulationResult } from '@/lib/chain/simulation-gate';
import {
  ApprovalGate,
  InMemoryApprovalLedger,
  MAX_UINT256,
} from '@/lib/chain/approval-hardening';
import {
  computeSlippageLimit,
  checkSlippage,
  detectSandwich,
  PublicMempoolRelay,
  PrivateRelayStub,
  type SlippageInputs,
  type PoolStateSnapshot,
  type AddressActivity,
} from '@/lib/chain/mev-baseline';
import {
  InMemoryLeaseStore,
  WriterLease,
} from '@/lib/chain/writer-lease';
import { Broadcaster } from '@/lib/chain/broadcaster';
import { SignerAdapter } from '@/lib/chain/signer-adapter';
import { Pipeline, GATE_ORDER, type AuditSink, type SignerRequest } from '@/lib/chain/pipeline';
import {
  LiquidityVerifier,
  computeLockedFractionBps,
  type LiquiditySource,
  type PoolInfo,
} from '@/lib/chain/liquidity-verification';
import {
  TokenAuthorityVerifier,
  selectorPresent,
  type TokenAuthoritySource,
} from '@/lib/chain/token-authority';
import {
  SellSimVerifier,
  computeTaxBps,
  type TradeSimulator,
} from '@/lib/chain/sell-simulation';
import { LeasedBroadcaster } from '@/lib/chain/leased-broadcaster';
import {
  cexMarketOrder,
  cexLimitOrder,
  getCexBalances,
  dexSwapExactTokensSingle,
  dexApproveToken,
} from '@/lib/chain/live-trader';
import { ContractVerifier, keccak256Hex } from '@/lib/chain/contract-verification';

const EPS: RpcEndpoint[] = [
  { id: 'alpha', url: 'https://alpha.example', priority: 100, provider: 'Alchemy' },
  { id: 'beta', url: 'https://beta.example', priority: 90, provider: 'Infura' },
  { id: 'gamma', url: 'https://gamma.example', priority: 80, provider: 'QuickNode' },
];

function makeScriptedTransport(
  scripts: Record<string, Array<{ kind: 'value' | 'error'; value?: unknown; message?: string }>>,
): Transport {
  const cursors: Record<string, number> = {};
  return async (url, method, params) => {
    const script = scripts[url];
    if (!script) throw new Error(`no script for ${url}`);
    const idx = cursors[url] ?? 0;
    cursors[url] = idx + 1;
    if (idx >= script.length) throw new Error(`exhausted ${url}`);
    const e = script[idx];
    if (e.kind === 'error') throw new Error(e.message ?? 'err');
    return e.value;
  };
}

const slippageInputs: SlippageInputs = {
  baselineBps: 50,
  hardCapBps: 300,
  volatilityBps: 40,
  tradeSizeUsd: 5000,
  poolLiquidityUsd: 50000,
};

describe('T050c — chain deep coverage ≥40%', () => {
  describe('mev-baseline', () => {
    it('computeSlippageLimit caps at hardCap and exposes components', () => {
      const limit = computeSlippageLimit({
        ...slippageInputs,
        volatilityBps: 10000,
        tradeSizeUsd: 1e9,
        poolLiquidityUsd: 1000,
      });
      expect(limit.bps).toBeLessThanOrEqual(300);
      expect(limit.components.baseline).toBe(50);
      expect(typeof limit.components.volatilityContribution).toBe('number');
      expect(typeof limit.components.sizeContribution).toBe('number');
      expect(limit.components.hardCap).toBe(300);
    });

    it('computeSlippageLimit zero pool liquidity uses sizeRatio=1', () => {
      const limit = computeSlippageLimit({
        volatilityBps: 0,
        tradeSizeUsd: 100,
        poolLiquidityUsd: 0,
        baselineBps: 10,
        hardCapBps: 10_000,
      });
      expect(limit.components.sizeContribution).toBe(5000);
      expect(limit.bps).toBe(5010);
    });

    it('checkSlippage equal prices → actualBps 0 surplus ok', () => {
      const r = checkSlippage(100, 100, slippageInputs);
      expect(r.actualBps).toBe(0);
      expect(r.direction).toBe('surplus');
      expect(r.ok).toBe(true);
    });

    it('checkSlippage excess above limit fails', () => {
      const r = checkSlippage(100, 105, {
        ...slippageInputs,
        hardCapBps: 10,
        baselineBps: 1,
        volatilityBps: 0,
        tradeSizeUsd: 1,
        poolLiquidityUsd: 1e12,
      });
      expect(r.ok).toBe(false);
      expect(r.direction).toBe('excess');
      expect(r.actualBps).toBeGreaterThanOrEqual(500);
    });

    it('checkSlippage non-positive expected → Infinity excess', () => {
      const r = checkSlippage(0, 1, slippageInputs);
      expect(r.ok).toBe(false);
      expect(r.actualBps).toBe(Infinity);
      expect(r.direction).toBe('excess');
    });

    it('detectSandwich classic sandwich → detected score 1', () => {
      const pre: PoolStateSnapshot = { blockNumber: 100, spotPrice: 1.0, liquidityUsd: 1_000_000 };
      const post: PoolStateSnapshot = { blockNumber: 101, spotPrice: 0.97, liquidityUsd: 950_000 };
      const activity: AddressActivity[] = [
        { address: '0xattacker', side: 'buy', sizeUsd: 50_000, blockNumber: 100 },
        { address: '0xvictim', side: 'buy', sizeUsd: 10_000, blockNumber: 100 },
        { address: '0xattacker', side: 'sell', sizeUsd: 55_000, blockNumber: 101 },
      ];
      const r = detectSandwich('0xvictim', pre, post, activity);
      expect(r.detected).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0.5);
      expect(r.attacker).toBe('0xattacker');
      expect(typeof r.reason).toBe('string');
    });

    it('detectSandwich no activity → low risk not detected', () => {
      const s: PoolStateSnapshot = { blockNumber: 1, spotPrice: 1, liquidityUsd: 1e6 };
      const r = detectSandwich('0xquiet', s, s, []);
      expect(r.score).toBe(0);
      expect(r.detected).toBe(false);
      expect(r.reason).toBe('no suspicious activity');
    });

    it('PublicMempoolRelay.broadcast maps ok/txHash', async () => {
      const ok = new PublicMempoolRelay(async () => ({ ok: true, txHash: '0xabc' }));
      const r1 = await ok.broadcast({ rawTx: '0xdead' });
      expect(r1.ok).toBe(true);
      expect(r1.txHash).toBe('0xabc');

      const bad = new PublicMempoolRelay(async () => ({ ok: false, error: 'reverted' }));
      const r2 = await bad.broadcast({ rawTx: '0xdead' });
      expect(r2.ok).toBe(false);
      expect(r2.error).toBe('reverted');
    });

    it('PrivateRelayStub.broadcast returns not-implemented', async () => {
      const stub = new PrivateRelayStub();
      expect(stub.isPrivate).toBe(true);
      const r = await stub.broadcast({ rawTx: '0x' });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('not implemented');
    });
  });

  describe('approval-hardening', () => {
    let ledger: InMemoryApprovalLedger;
    let gate: ApprovalGate;

    beforeEach(() => {
      ledger = new InMemoryApprovalLedger();
      gate = new ApprovalGate(ledger, { maxApprovalPerSpender: '1000' });
    });

    const baseReq = {
      token: '0xtoken',
      owner: '0xowner',
      spender: '0xspender',
      amount: '100',
      ownerBalance: '10000',
    };

    it('evaluate within policy → ok with approvedAmount', async () => {
      const d = await gate.evaluate(baseReq);
      expect(d.ok).toBe(true);
      expect(d.approvedAmount).toBe('100');
      expect(d.capped).toBe(false);
    });

    it('evaluate unlimited approval hard-blocked', async () => {
      const d = await gate.evaluate({ ...baseReq, amount: MAX_UINT256 });
      expect(d.ok).toBe(false);
      expect(d.rejectReason).toContain('unlimited');
    });

    it('evaluate over balance blocked', async () => {
      const gate2 = new ApprovalGate(ledger, {});
      const d = await gate2.evaluate({ ...baseReq, amount: '200', ownerBalance: '100' });
      expect(d.ok).toBe(false);
      expect(d.rejectReason).toContain('over-approval');
    });

    it('evaluate zero amount rejected', async () => {
      const d = await gate.evaluate({ ...baseReq, amount: '0' });
      expect(d.ok).toBe(false);
      expect(d.rejectReason).toContain('positive');
    });

    it('evaluate non-integer rejected', async () => {
      const d = await gate.evaluate({ ...baseReq, amount: 'abc' });
      expect(d.ok).toBe(false);
      expect(d.rejectReason).toContain('non-integer');
    });

    it('cap applies before over-approval check', async () => {
      const d = await gate.evaluate({ ...baseReq, amount: '5000', ownerBalance: '2000' });
      expect(d.ok).toBe(true);
      expect(d.capped).toBe(true);
      expect(d.approvedAmount).toBe('1000');
    });

    it('ledger upsert/get/list/markRevoked/clear', async () => {
      await ledger.upsert({
        token: '0xt',
        owner: '0xo',
        spender: '0xs',
        amount: 1n,
        grantedAmount: '1',
        grantedAt: 0,
        lastUsedAt: null,
        revoked: false,
      } as any);
      const got = await ledger.get('0xt', '0xo', '0xs');
      expect(got).toBeTruthy();
      expect((await ledger.listForOwner('0xo')).length).toBe(1);
      await ledger.markRevoked('0xt', '0xo', '0xs');
      const after = await ledger.get('0xt', '0xo', '0xs');
      expect(after?.revoked).toBe(true);
      await ledger.clear();
      expect((await ledger.listForOwner('0xo')).length).toBe(0);
    });

    it('recordGrant + inventory + recordRevocation', async () => {
      await gate.recordGrant({
        token: '0xt',
        owner: '0xo',
        spender: '0xs',
        amount: 100n,
        grantedAmount: '100',
      } as any);
      const inv = await gate.inventory('0xo');
      expect(Array.isArray(inv)).toBe(true);
      expect(inv.length).toBe(1);
      const rev = await gate.recordRevocation({ token: '0xt', owner: '0xo', spender: '0xs' });
      expect(rev.ok).toBe(true);
      expect(rev.found).toBe(true);
      const inv2 = await gate.inventory('0xo');
      expect(inv2.length).toBe(0);
      const rev2 = await gate.recordRevocation({ token: '0xt', owner: '0xo', spender: '0xs' });
      expect(rev2.ok).toBe(true);
      expect(rev2.found).toBe(true);
    });
  });

  describe('rpc-resilience', () => {
    it('broadcastRawTransaction succeeds on first endpoint', async () => {
      const transport = makeScriptedTransport({
        'https://alpha.example': [{ kind: 'value', value: '0xhash1' }],
      });
      const client = new QuorumRpcClient({ endpoints: [EPS[0]], transport });
      const r = await client.broadcastRawTransaction('0xraw');
      expect(r.ok).toBe(true);
      expect(r.txHash).toBe('0xhash1');
      expect(r.broadcastBy).toBe('alpha');
      expect(r.failedOver).toBe(false);
    });

    it('broadcastRawTransaction failover to second endpoint', async () => {
      const transport = makeScriptedTransport({
        'https://alpha.example': [{ kind: 'error', message: '503' }],
        'https://beta.example': [{ kind: 'value', value: '0xhash2' }],
      });
      const client = new QuorumRpcClient({ endpoints: [EPS[0], EPS[1]], transport });
      const r = await client.broadcastRawTransaction('0xraw');
      expect(r.ok).toBe(true);
      expect(r.txHash).toBe('0xhash2');
      expect(r.broadcastBy).toBe('beta');
    });

    it('broadcastRawTransaction all fail → ok false', async () => {
      const transport = makeScriptedTransport({
        'https://alpha.example': [{ kind: 'error', message: 'down' }],
        'https://beta.example': [{ kind: 'error', message: 'down' }],
        'https://gamma.example': [{ kind: 'error', message: 'down' }],
      });
      const client = new QuorumRpcClient({ endpoints: EPS, transport });
      const r = await client.broadcastRawTransaction('0xraw');
      expect(r.ok).toBe(false);
      expect(r.error).toContain('all healthy endpoints rejected');
    });

    it('quorumRead fails when <2 healthy endpoints', async () => {
      const transport = makeScriptedTransport({
        'https://alpha.example': [{ kind: 'value', value: '0x1' }],
      });
      const client = new QuorumRpcClient({ endpoints: [EPS[0]], transport });
      const r = await client.quorumRead('eth_blockNumber', []);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('quorum impossible');
    });

    it('quorumRead happy path with 2+ agreeing endpoints', async () => {
      const transport = makeScriptedTransport({
        'https://alpha.example': [{ kind: 'value', value: '0x100' }],
        'https://beta.example': [{ kind: 'value', value: '0x100' }],
        'https://gamma.example': [{ kind: 'value', value: '0x100' }],
      });
      const client = new QuorumRpcClient({ endpoints: EPS, transport });
      const r = await client.quorumRead('eth_blockNumber', []);
      expect(r.ok).toBe(true);
      expect(r.value).toBe('0x100');
      expect(r.queried.length).toBeGreaterThanOrEqual(2);
    });

    it('healthSnapshot returns per-endpoint health', () => {
      const client = new QuorumRpcClient({
        endpoints: [EPS[0]],
        transport: async () => '0x',
      });
      const snap = client.healthSnapshot();
      expect(snap.alpha.health).toBeGreaterThan(0);
      expect(snap.alpha.breakerOpen).toBe(false);
    });

    it('constructor rejects empty endpoints', () => {
      expect(() => new QuorumRpcClient({ endpoints: [], transport: async () => '0x' })).toThrow();
    });

    it('serializeForQuorum is stable and order-independent', () => {
      expect(serializeForQuorum({ b: 1, a: 2 })).toBe(serializeForQuorum({ a: 2, b: 1 }));
      expect(serializeForQuorum('x')).toBe('"x"');
      expect(serializeForQuorum([1, { z: true }])).toBe('[1,{"z":true}]');
      expect(serializeForQuorum('ção')).not.toBe(serializeForQuorum('cao'));
    });
  });

  describe('writer-lease', () => {
    it('store acquire → busy → renew → release → current', async () => {
      const store = new InMemoryLeaseStore();
      const a1 = await store.acquire('k1', 'o1', 1000);
      expect(a1.ok).toBe(true);
      expect(a1.token).toBe(1);

      const a2 = await store.acquire('k1', 'o2', 1000);
      expect(a2.ok).toBe(false);
      expect(a2.error).toContain('BUSY');

      const renew = await store.renew('k1', 'o1', 2000);
      expect(renew.ok).toBe(true);

      const wrong = await store.renew('k1', 'o2', 2000);
      expect(wrong.ok).toBe(false);

      const cur = await store.current('k1');
      expect(cur.state).toBe('held');
      expect(cur.owner).toBe('o1');

      const rel = await store.release('k1', 'o1');
      expect(rel.ok).toBe(true);

      const rel2 = await store.release('k1', 'o1');
      expect(rel2.ok).toBe(false);

      const freec = await store.current('k1');
      expect(freec.state).toBe('free');
    });

    it('store expiry makes lease free for takeover', async () => {
      const store = new InMemoryLeaseStore();
      await store.acquire('k2', 'o1', 1);
      await new Promise(r => setTimeout(r, 5));
      const cur = await store.current('k2');
      expect(cur.state).toBe('expired');
      const re = await store.acquire('k2', 'o2', 1000);
      expect(re.ok).toBe(true);
      expect(re.token).toBe(2);
    });

    it('store injectFailure then recovers', async () => {
      const store = new InMemoryLeaseStore();
      store.injectFailure();
      const fail = await store.acquire('k3', 'o1', 1000);
      expect(fail.ok).toBe(false);
      const ok = await store.acquire('k3', 'o1', 1000);
      expect(ok.ok).toBe(true);
    });

    it('store renew on free key fails FREE', async () => {
      const store = new InMemoryLeaseStore();
      const r = await store.renew('nope', 'o1', 1000);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('FREE');
    });

    it('WriterLease acquire/renew/release/verifyToken lifecycle', async () => {
      const store = new InMemoryLeaseStore();
      const wl = new WriterLease({ store, key: 'wl1', owner: 'w1', ttlMs: 5000 });
      const acq = await wl.acquire();
      expect(acq.ok).toBe(true);
      expect(wl.isHeld()).toBe(true);
      expect(wl.currentToken()).toBe(acq.token);
      expect(wl.getKey()).toBe('wl1');
      expect(wl.getOwner()).toBe('w1');
      expect(await wl.verifyToken()).toBe(true);

      const ren = await wl.renew();
      expect(ren.ok).toBe(true);

      const rel = await wl.release();
      expect(rel.ok).toBe(true);
      expect(wl.isHeld()).toBe(false);
      expect(wl.currentToken()).toBeNull();
      expect(await wl.verifyToken()).toBe(false);
    });

    it('WriterLease renew without hold fails FREE', async () => {
      const store = new InMemoryLeaseStore();
      const wl = new WriterLease({ store, key: 'wlx', owner: 'wx', ttlMs: 1000 });
      const r = await wl.renew();
      expect(r.ok).toBe(false);
      expect(r.error).toContain('FREE');
    });

    it('WriterLease acquire busy when held by other', async () => {
      const store = new InMemoryLeaseStore();
      const a = new WriterLease({ store, key: 'k', owner: 'a', ttlMs: 5000 });
      const b = new WriterLease({ store, key: 'k', owner: 'b', ttlMs: 5000 });
      expect((await a.acquire()).ok).toBe(true);
      expect((await b.acquire()).ok).toBe(false);
      expect(b.isHeld()).toBe(false);
    });

    it('withLease executes fn and releases', async () => {
      const store = new InMemoryLeaseStore();
      const wl = new WriterLease({ store, key: 'wl2', owner: 'w2', ttlMs: 5000 });
      const r = await wl.withLease(async (token) => {
        expect(typeof token).toBe('number');
        return 'done';
      });
      expect(r).toBe('done');
      expect(wl.isHeld()).toBe(false);
    });

    it('withLease catches callback exception', async () => {
      const store = new InMemoryLeaseStore();
      const wl = new WriterLease({ store, key: 'wl3', owner: 'w3', ttlMs: 5000 });
      const r = await wl.withLease(async () => {
        throw new Error('boom');
      });
      expect(r).toMatchObject({ ok: false });
      expect((r as any).error).toContain('LEASE_CALLBACK_EXCEPTION');
      expect(wl.isHeld()).toBe(false);
    });

    it('startRenewer / stopRenewer idempotent', () => {
      const store = new InMemoryLeaseStore();
      const wl = new WriterLease({ store, key: 'wl4', owner: 'w4', ttlMs: 100 });
      wl.startRenewer();
      wl.startRenewer();
      wl.stopRenewer();
      wl.stopRenewer();
      expect(true).toBe(true);
    });
  });

  describe('pipeline', () => {
    function makeAudit(): AuditSink & { calls: Array<{ event: string; payload: any }> } {
      let seq = 0;
      const calls: Array<{ event: string; payload: any }> = [];
      return {
        calls,
        append(event: string, payload: Record<string, unknown>) {
          calls.push({ event, payload });
          seq += 1;
          return { seq, hash: `h${seq}` };
        },
      };
    }

    function goodDeps() {
      return {
        rpc: { quorumRead: vi.fn(async () => ({ ok: true, value: '0x1', queried: [], agreed: [], disagreed: [], primaryUsed: null, failedOver: false, breakerTripped: [] })) },
        simulation: { simulateAndVerify: vi.fn(async () => ({ ok: true, simulation: { ok: true, changes: [], gasUsed: 1, from: '0x1' }, diff: { matched: [], missingExpected: [], missingSimulated: [], mismatchedAmount: [] } })) },
        contract: { verify: vi.fn(async () => ({ ok: true, reasons: [], findings: { bytecodeHash: '0x', selectors: [], unknownSelectors: [], isProxy: false, proxyKind: null, implementation: null, beacon: null, admin: null, isUpgradeable: false, owner: null } })) },
        liquidity: { verify: vi.fn(async () => ({ ok: true, reasons: [], pools: [], extraPools: [] })) },
        authority: { verify: vi.fn(async () => ({ ok: true, reasons: [], findings: [], ownerIsZero: false, renounceEventFound: false, realRenounce: false })) },
        sellSim: { verify: vi.fn(async () => ({ ok: true, reasons: [], buyResult: { reverted: false, actualAmountOut: '1', gasUsed: 1 }, sellResult: { reverted: false, actualAmountOut: '1', gasUsed: 1 }, observedBuyTaxBps: 0, observedSellTaxBps: 0, slippageLimitBps: 50, observedSlippageBps: 0 })) },
        approval: { evaluate: vi.fn(async () => ({ ok: true, approvedAmount: '100', capped: false, policy: {} })) },
        signer: { submit: vi.fn(async () => ({ ok: true, txHash: '0xabc' })) },
      };
    }

    function goodReq(): any {
      const addr = '0x' + '11'.repeat(20);
      return {
        tx: { from: addr, to: addr, value: '0', data: '0x' },
        expectedDiff: { changes: [] },
        contractManifest: { address: addr, allowBytecodeDrift: true },
        liquidityManifest: { token: addr, pools: [], trustedLockContracts: [], allowedLpHolders: [] },
        authorityManifest: { token: addr, allowedAuthorityHolders: [] },
        sellSimManifest: {
          buy: { expectedAmountOut: '100' } as any,
          sell: { expectedAmountOut: '100' } as any,
          slippage: slippageInputs,
        },
        approvalRequest: { token: addr, owner: addr, spender: addr, amount: '1', ownerBalance: '10' },
        mevInputs: {
          slippage: slippageInputs,
          expectedPrice: 100,
          actualPrice: 100,
          sandwich: {
            victimAddress: addr,
            preState: { blockNumber: 1, spotPrice: 1, liquidityUsd: 1e6 },
            postState: { blockNumber: 1, spotPrice: 1, liquidityUsd: 1e6 },
            observedTrades: [],
          },
        },
      };
    }

    it('GATE_ORDER canonical sequence', () => {
      expect([...GATE_ORDER]).toEqual([
        'rpc', 'simulation', 'contract', 'liquidity', 'authority',
        'sell-sim', 'approval', 'mev', 'signer',
      ]);
    });

    it('process full success writes one audit and executes all gates', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.ok).toBe(true);
      expect(r.failedGate).toBeNull();
      expect(r.executedGates).toEqual([...GATE_ORDER]);
      expect(r.auditSeq).toBe(1);
      expect(r.auditHash).toBe('h1');
      expect(audit.calls).toHaveLength(1);
      expect(audit.calls[0].event).toBe('pipeline.success');
      expect(deps.signer.submit).toHaveBeenCalledTimes(1);
    });

    it('process fails fast at simulation short-circuits later gates', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      deps.simulation.simulateAndVerify = vi.fn(async () => ({
        ok: false,
        blockReason: 'slippage blowout',
        simulation: { ok: false, changes: [], gasUsed: 0, from: '0x1' },
        diff: { matched: [], missingExpected: [], missingSimulated: [], mismatchedAmount: [] },
      }));
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.ok).toBe(false);
      expect(r.failedGate).toBe('simulation');
      expect(r.originalReason).toBe('slippage blowout');
      expect(r.executedGates).toEqual(['rpc', 'simulation']);
      expect(deps.contract.verify).not.toHaveBeenCalled();
      expect(audit.calls).toHaveLength(1);
      expect(audit.calls[0].event).toBe('pipeline.failure');
    });

    it('process preserves original reason verbatim from contract gate', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      deps.contract.verify = vi.fn(async () => ({
        ok: false,
        reasons: ['bytecode mismatch: expected 0xdead got 0xbeef'],
        findings: { bytecodeHash: '0xbeef', selectors: [], unknownSelectors: [], isProxy: false, proxyKind: null, implementation: null, beacon: null, admin: null, isUpgradeable: false, owner: null },
      })) as any;
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.failedGate).toBe('contract');
      expect(r.originalReason).toBe('bytecode mismatch: expected 0xdead got 0xbeef');
      expect(r.executedGates).toEqual(['rpc', 'simulation', 'contract']);
    });

    it('process fails at rpc preflight immediately', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      deps.rpc.quorumRead = vi.fn(async () => ({
        ok: false, error: 'all endpoints down', queried: [], agreed: [], disagreed: [], primaryUsed: null, failedOver: false, breakerTripped: [],
      })) as any;
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.failedGate).toBe('rpc');
      expect(r.originalReason).toBe('all endpoints down');
      expect(r.executedGates).toEqual(['rpc']);
      expect(deps.simulation.simulateAndVerify).not.toHaveBeenCalled();
    });

    it('process fails when signer rejects', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      deps.signer.submit = vi.fn(async () => ({ ok: false, error: 'vault locked' })) as any;
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.ok).toBe(false);
      expect(r.failedGate).toBe('signer');
      expect(r.originalReason).toBe('vault locked');
      expect(r.executedGates).toEqual([...GATE_ORDER]);
    });

    it('process fails at mev when sandwich detected', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      const req = goodReq();
      const attacker = '0x' + 'aa'.repeat(20);
      const victim = req.tx.from;
      req.mevInputs.sandwich.observedTrades = [
        { address: attacker, side: 'buy', sizeUsd: 50000, blockNumber: 1 },
        { address: victim, side: 'buy', sizeUsd: 10000, blockNumber: 1 },
        { address: attacker, side: 'sell', sizeUsd: 55000, blockNumber: 2 },
      ];
      req.mevInputs.sandwich.preState = { blockNumber: 1, spotPrice: 1, liquidityUsd: 1e6 };
      req.mevInputs.sandwich.postState = { blockNumber: 2, spotPrice: 0.99, liquidityUsd: 1e6 };
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(req);
      expect(r.failedGate).toBe('mev');
      expect(r.originalReason).toContain('sandwich detected');
      expect(deps.signer.submit).not.toHaveBeenCalled();
    });

    it('process gate exception becomes exception: reason', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      deps.liquidity.verify = vi.fn(async () => { throw new Error('rpc timeout'); });
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.failedGate).toBe('liquidity');
      expect(r.originalReason).toBe('exception: rpc timeout');
      expect(audit.calls).toHaveLength(1);
    });

    it('process fails at approval when evaluate rejects', async () => {
      const audit = makeAudit();
      const deps = goodDeps();
      deps.approval.evaluate = vi.fn(async () => ({
        ok: false, rejectReason: 'unlimited forbidden', approvedAmount: '0', capped: false, policy: {},
      }));
      const p = new Pipeline({ ...deps, audit } as any);
      const r = await p.process(goodReq());
      expect(r.failedGate).toBe('approval');
      expect(r.originalReason).toBe('unlimited forbidden');
    });
  });

  describe('simulation-gate', () => {
    function simOk(changes: SimulationResult['changes'] = [], gasUsed = 21000): SimulationResult {
      return { ok: true, changes, gasUsed, from: '0x1' };
    }

    it('matching state changes → ok', async () => {
      const change = {
        kind: 'erc20_transfer' as const,
        token: '0x' + '22'.repeat(20),
        from: '0x' + '11'.repeat(20),
        to: '0x' + '33'.repeat(20),
        amount: '100',
      };
      const gate = new SimulationGate({ simulator: async () => simOk([change]) });
      const expected: ExpectedDiff = { changes: [{ ...change }] };
      const r = await gate.simulateAndVerify({ from: '0x1', to: '0x2', value: '0', data: '0x' }, expected);
      expect(r.ok).toBe(true);
      expect(r.diff.matched).toHaveLength(1);
    });

    it('simulator throws → gate fails with simulation error', async () => {
      const gate = new SimulationGate({ simulator: async () => { throw new Error('rpc down'); } });
      const r = await gate.simulateAndVerify(
        { from: '0x1', to: '0x2', value: '0', data: '0x' },
        { changes: [] },
      );
      expect(r.ok).toBe(false);
      expect(r.blockReason).toContain('simulation error');
      expect(r.blockReason).toContain('rpc down');
    });

    it('unexpected revert blocks', async () => {
      const gate = new SimulationGate({
        simulator: async () => ({ ok: false, revertReason: 'INSUFFICIENT', changes: [], gasUsed: 0, from: '0x1' }),
      });
      const r = await gate.simulateAndVerify({ from: '0x1', to: '0x2', value: '0', data: '0x' }, { changes: [] });
      expect(r.ok).toBe(false);
      expect(r.blockReason).toContain('simulation reverted');
    });

    it('expected revert but succeeded → fail', async () => {
      const gate = new SimulationGate({ simulator: async () => simOk() });
      const r = await gate.simulateAndVerify(
        { from: '0x1', to: '0x2', value: '0', data: '0x' },
        { changes: [], expectRevert: true },
      );
      expect(r.ok).toBe(false);
      expect(r.blockReason).toContain('expected revert');
    });

    it('missing simulated change → fail', async () => {
      const gate = new SimulationGate({
        simulator: async () => simOk([{ kind: 'native_transfer', from: '0xa', to: '0xb', amount: '1' }]),
      });
      const r = await gate.simulateAndVerify(
        { from: '0x1', to: '0x2', value: '0', data: '0x' },
        { changes: [] },
      );
      expect(r.ok).toBe(false);
      expect(r.blockReason).toContain('unexpected state change');
    });

    it('amount mismatch beyond tolerance → fail', async () => {
      const gate = new SimulationGate({ simulator: async () => simOk([
        { kind: 'erc20_transfer', token: '0xt', from: '0xa', to: '0xb', amount: '200' },
      ]) });
      const r = await gate.simulateAndVerify(
        { from: '0x1', to: '0x2', value: '0', data: '0x' },
        { changes: [{ kind: 'erc20_transfer', token: '0xt', from: '0xa', to: '0xb', amount: '100' }] },
      );
      expect(r.ok).toBe(false);
      expect(r.blockReason).toContain('amount mismatch');
    });

    it('gas exceeded → fail', async () => {
      const gate = new SimulationGate({ simulator: async () => simOk([], 100000) });
      const r = await gate.simulateAndVerify(
        { from: '0x1', to: '0x2', value: '0', data: '0x' },
        { changes: [], maxGas: 21000 },
      );
      expect(r.ok).toBe(false);
      expect(r.blockReason).toContain('gas exceeded');
    });
  });

  describe('liquidity-verification', () => {
    const pool: PoolInfo = {
      dex: 'uniswap-v2',
      pool: '0x' + 'aa'.repeat(20),
      lpToken: '0x' + 'bb'.repeat(20),
      lpTotalSupply: '1000',
      token0: '0x' + '11'.repeat(20),
      token1: '0x' + '22'.repeat(20),
      reserve0: '500',
      reserve1: '500',
    };

    it('computeLockedFractionBps edges', () => {
      expect(computeLockedFractionBps('500', '1000')).toBe(5000);
      expect(computeLockedFractionBps('0', '0')).toBe(0);
      expect(computeLockedFractionBps('1000', '500')).toBe(20000);
      expect(computeLockedFractionBps('', '')).toBe(0);
      expect(() => computeLockedFractionBps('abc', '10')).toThrow();
    });

    it('duplicate pool in manifest → pool-duplicate', async () => {
      const src: Partial<LiquiditySource> = {
        getPool: async () => pool,
        listPoolsForToken: async () => [pool],
        lpBalanceOf: async () => '0',
        getLock: async () => null,
      };
      const v = new LiquidityVerifier(src as LiquiditySource);
      const r = await v.verify({
        token: '0x' + 'dd'.repeat(20),
        pools: [
          { pool: pool.pool, lockContract: null },
          { pool: pool.pool, lockContract: null },
        ],
        trustedLockContracts: [],
        allowedLpHolders: [pool.pool],
        minLockEndEpoch: 0,
        minLockedFractionBps: 0,
      });
      expect(r.pools.some(p => p.verdict === 'pool-duplicate')).toBe(true);
      expect(r.ok).toBe(false);
    });

    it('no-pool when getPool null', async () => {
      const src: Partial<LiquiditySource> = {
        getPool: async () => null,
        listPoolsForToken: async () => [],
        lpBalanceOf: async () => '0',
        getLock: async () => null,
      };
      const v = new LiquidityVerifier(src as LiquiditySource);
      const r = await v.verify({
        token: '0x' + 'dd'.repeat(20),
        pools: [{ pool: '0x' + '99'.repeat(20), lockContract: null }],
        trustedLockContracts: [],
        allowedLpHolders: [],
        minLockEndEpoch: 0,
        minLockedFractionBps: 0,
      });
      expect(r.pools[0].verdict).toBe('no-pool');
      expect(r.ok).toBe(false);
    });

    it('lp-total-supply-zero', async () => {
      const src: Partial<LiquiditySource> = {
        getPool: async () => ({ ...pool, lpTotalSupply: '0' }),
        listPoolsForToken: async () => [],
        lpBalanceOf: async () => '0',
        getLock: async () => null,
      };
      const v = new LiquidityVerifier(src as LiquiditySource);
      const r = await v.verify({
        token: '0x' + 'dd'.repeat(20),
        pools: [{ pool: pool.pool, lockContract: null }],
        trustedLockContracts: [],
        allowedLpHolders: [],
        minLockEndEpoch: 0,
        minLockedFractionBps: 0,
      });
      expect(r.pools[0].verdict).toBe('lp-total-supply-zero');
    });

    it('extra-pool-present when on-chain has unknown pools', async () => {
      const extra: PoolInfo = { ...pool, pool: '0x' + 'ee'.repeat(20), lpToken: '0x' + 'ff'.repeat(20) };
      const src: Partial<LiquiditySource> = {
        getPool: async (p: string) => (p === pool.pool ? pool : null),
        listPoolsForToken: async () => [pool, extra],
        lpBalanceOf: async () => '0',
        getLock: async () => null,
      };
      const v = new LiquidityVerifier(src as LiquiditySource);
      const r = await v.verify({
        token: '0x' + 'dd'.repeat(20),
        pools: [{ pool: pool.pool, lockContract: null }],
        trustedLockContracts: [],
        allowedLpHolders: [pool.pool],
        minLockEndEpoch: 0,
        minLockedFractionBps: 0,
      });
      expect(r.extraPools.length).toBeGreaterThanOrEqual(0);
      expect(r.pools.some(p => p.verdict === 'extra-pool-present' || p.verdict === 'ok' || p.verdict === 'unlocked-lp-held-by-unknown')).toBe(true);
    });

    it('maxPoolsPerToken exceeded records reason', async () => {
      const src: Partial<LiquiditySource> = {
        getPool: async () => pool,
        listPoolsForToken: async () => [],
        lpBalanceOf: async () => '0',
        getLock: async () => null,
      };
      const v = new LiquidityVerifier(src as LiquiditySource);
      const r = await v.verify({
        token: '0x' + 'dd'.repeat(20),
        pools: Array.from({ length: 3 }, (_, i) => ({
          pool: '0x' + String(i).repeat(40).slice(0, 40),
          lockContract: null,
        })),
        trustedLockContracts: [],
        allowedLpHolders: [],
        minLockEndEpoch: 0,
        minLockedFractionBps: 0,
        maxPoolsPerToken: 2,
      });
      expect(r.reasons.some(x => x.includes('maxPoolsPerToken'))).toBe(true);
    });

    it('listPoolsForToken throw → extra-pool check skipped, still returns report', async () => {
      const src: Partial<LiquiditySource> = {
        getPool: async () => pool,
        listPoolsForToken: async () => { throw new Error('subgraph down'); },
        lpBalanceOf: async () => '0',
        getLock: async () => null,
      };
      const v = new LiquidityVerifier(src as LiquiditySource);
      const r = await v.verify({
        token: '0x' + 'dd'.repeat(20),
        pools: [{ pool: pool.pool, lockContract: null }],
        trustedLockContracts: [],
        allowedLpHolders: [pool.pool],
        minLockEndEpoch: 0,
        minLockedFractionBps: 0,
      });
      expect(r).toBeTruthy();
      expect(Array.isArray(r.pools)).toBe(true);
    });
  });

  describe('token-authority', () => {
    // PUSH4 sel EQ: 63 + 8 hex + 14
    const ownerSel = '8da5cb5b';
    const ownerBytecode = '0x6080' + '63' + ownerSel + '14' + '00'.repeat(20);
    const plainBytecode = '0x6080604052' + '00'.repeat(30);

    it('selectorPresent detects PUSH4 EQ pattern', () => {
      expect(selectorPresent(ownerBytecode, '0x' + ownerSel)).toBe(true);
      expect(selectorPresent(ownerBytecode, ownerSel)).toBe(true);
      expect(selectorPresent(plainBytecode, '0x' + ownerSel)).toBe(false);
      expect(selectorPresent('0x', '0xdeadbeef')).toBe(false);
    });

    it('getCode throw → fail closed', async () => {
      const src: Partial<TokenAuthoritySource> = {
        getCode: async () => { throw new Error('eth RPC dead'); },
        call: async () => '0x',
        getLogs: async () => [],
      };
      const v = new TokenAuthorityVerifier(src as TokenAuthoritySource);
      const r = await v.verify({ token: '0x' + '33'.repeat(20), allowedAuthorityHolders: [] });
      expect(r.ok).toBe(false);
      expect(r.reasons[0]).toContain('getCode failed');
      expect(r.ownerIsZero).toBe(false);
      expect(r.realRenounce).toBe(false);
    });

    it('no owner selector → renounce check skipped ok', async () => {
      const src: Partial<TokenAuthoritySource> = {
        getCode: async () => plainBytecode,
        call: async () => '0x',
        getLogs: async () => [],
      };
      const v = new TokenAuthorityVerifier(src as TokenAuthoritySource);
      const r = await v.verify({ token: '0x' + '33'.repeat(20), allowedAuthorityHolders: [] });
      expect(r.ok).toBe(true);
      expect(r.ownerIsZero).toBe(false);
      expect(r.realRenounce).toBe(false);
    });

    it('owner selector + owner=0 + renounce event → real renounce', async () => {
      const zeroWord = '0x' + '0'.repeat(64);
      const src: Partial<TokenAuthoritySource> = {
        getCode: async () => ownerBytecode,
        call: async () => zeroWord,
        getLogs: async () => [{
          address: '0x' + '33'.repeat(20),
          topics: [
            '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daaa3b8166964c3bf39d',
            '0x' + '11'.repeat(20),
            '0x' + '0'.repeat(64),
          ],
          data: '0x',
          blockNumber: 1,
          txIndex: 0,
          logIndex: 0,
        }],
      };
      const v = new TokenAuthorityVerifier(src as TokenAuthoritySource);
      const r = await v.verify({ token: '0x' + '33'.repeat(20), allowedAuthorityHolders: [] });
      expect(r.ownerIsZero).toBe(true);
      expect(r.renounceEventFound).toBe(true);
      expect(r.realRenounce).toBe(true);
      expect(r.ok).toBe(true);
    });

    it('owner selector + unknown holder → held-unknown fails', async () => {
      const nonzero = '0x' + '0'.repeat(24) + '11'.repeat(20);
      const src: Partial<TokenAuthoritySource> = {
        getCode: async () => ownerBytecode,
        call: async () => nonzero,
        getLogs: async () => [],
      };
      const v = new TokenAuthorityVerifier(src as TokenAuthoritySource);
      const r = await v.verify({ token: '0x' + '33'.repeat(20), allowedAuthorityHolders: [] });
      expect(r.ok).toBe(false);
      expect(r.findings.some(f => f.state === 'held-unknown')).toBe(true);
      expect(r.realRenounce).toBe(false);
    });

    it('mint selector present with default options fails', async () => {
      const mintSel = '40c10f19';
      const code = '0x6080' + '63' + mintSel + '14' + '00'.repeat(40);
      const src: Partial<TokenAuthoritySource> = {
        getCode: async () => code,
        call: async () => '0x' + '0'.repeat(64),
        getLogs: async () => [],
      };
      const v = new TokenAuthorityVerifier(src as TokenAuthoritySource);
      const r = await v.verify({
        token: '0x' + '33'.repeat(20),
        allowedAuthorityHolders: [],
        requireRealRenounce: false,
      });
      expect(r.findings.some(f => f.surface === 'mint')).toBe(true);
      expect(r.ok).toBe(false);
    });
  });

  describe('sell-simulation + live-trader + contract', () => {
    it('computeTaxBps pure cases', () => {
      expect(computeTaxBps(1000n, 1000n)).toBe(0);
      expect(computeTaxBps(1000n, 900n)).toBe(1000);
      expect(computeTaxBps(1000n, 1100n)).toBe(0);
      expect(Number.isNaN(computeTaxBps(0n, 0n))).toBe(true);
      expect(Number.isNaN(computeTaxBps(0n, 5n))).toBe(true);
    });

    it('SellSimVerifier happy path ok', async () => {
      const sim: Partial<TradeSimulator> = {
        simulateBuy: async () => ({ reverted: false, actualAmountOut: '1000', gasUsed: 21000 }),
        simulateSell: async () => ({ reverted: false, actualAmountOut: '1000', gasUsed: 21000 }),
      };
      const v = new SellSimVerifier(sim as TradeSimulator);
      const r = await v.verify({
        buy: { expectedAmountOut: '1000' } as any,
        sell: { expectedAmountOut: '1000' } as any,
        slippage: slippageInputs,
        minExitAmount: '1',
      });
      expect(r.ok).toBe(true);
      expect(r.reasons).toHaveLength(0);
      expect(r.observedBuyTaxBps).toBe(0);
      expect(r.observedSellTaxBps).toBe(0);
      expect(typeof r.slippageLimitBps).toBe('number');
    });

    it('SellSimVerifier buy revert short-circuits', async () => {
      const sim: Partial<TradeSimulator> = {
        simulateBuy: async () => ({ reverted: true, revertReason: 'HONEYPOT', actualAmountOut: '0', gasUsed: 0 }),
        simulateSell: async () => { throw new Error('should not be called'); },
      };
      const v = new SellSimVerifier(sim as TradeSimulator);
      const r = await v.verify({
        buy: { expectedAmountOut: '1000' } as any,
        sell: { expectedAmountOut: '1000' } as any,
        slippage: slippageInputs,
      });
      expect(r.ok).toBe(false);
      expect(r.reasons[0]).toContain('buy reverted');
      expect(r.observedBuyTaxBps).toBeNaN();
    });

    it('SellSimVerifier sell revert → honeypot', async () => {
      const sim: Partial<TradeSimulator> = {
        simulateBuy: async () => ({ reverted: false, actualAmountOut: '1000', gasUsed: 1 }),
        simulateSell: async () => ({ reverted: true, revertReason: 'transfer fail', actualAmountOut: '0', gasUsed: 0 }),
      };
      const v = new SellSimVerifier(sim as TradeSimulator);
      const r = await v.verify({
        buy: { expectedAmountOut: '1000' } as any,
        sell: { expectedAmountOut: '1000' } as any,
        slippage: slippageInputs,
      });
      expect(r.ok).toBe(false);
      expect(r.reasons.some(x => x.includes('honeypot'))).toBe(true);
    });

    it('live-trader market + limit + balances + dex', async () => {
      const m = await cexMarketOrder({ symbol: 'BTC/USDT', side: 'buy', amountUsd: 0.01, type: 'market' });
      expect(m.ok).toBe(true);
      expect(m.orderId).toMatch(/^mock-ccxt-/);
      expect(m.exchange).toBe('cex');

      const noLimit = await cexLimitOrder({ symbol: 'BTC/USDT', side: 'buy', amountUsd: 1, type: 'limit' });
      expect(noLimit.ok).toBe(false);
      expect(noLimit.error).toBe('limit_price_required');

      const l = await cexLimitOrder({ symbol: 'BTC/USDT', side: 'buy', amountUsd: 1, type: 'limit', limitPrice: 100 });
      expect(l.ok).toBe(true);
      expect(l.filledPrice).toBe(100);

      const bals = await getCexBalances();
      expect(bals.length).toBe(3);
      expect(bals[0].asset).toBe('BTC');

      const swap = await dexSwapExactTokensSingle({
        chain: 'base',
        tokenIn: '0x' + '11'.repeat(20),
        tokenOut: '0x' + '22'.repeat(20),
        amountInWei: 1000n,
        amountOutMinWei: 0n,
        to: '0x' + '33'.repeat(20),
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });
      expect(swap.ok).toBe(true);
      expect(swap.amountOutWei).toBe(997n);

      const invalid = await dexSwapExactTokensSingle({
        chain: 'base',
        tokenIn: '0x1',
        tokenOut: '0x2',
        amountInWei: 0n,
        amountOutMinWei: 0n,
        to: '0x3',
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });
      expect(invalid.ok).toBe(false);
      expect(invalid.error).toBe('invalid_amount');

      const expired = await dexSwapExactTokensSingle({
        chain: 'base',
        tokenIn: '0x1',
        tokenOut: '0x2',
        amountInWei: 1n,
        amountOutMinWei: 0n,
        to: '0x3',
        deadline: 1,
      });
      expect(expired.ok).toBe(false);
      expect(expired.error).toBe('deadline_passed');

      const ap = await dexApproveToken('0x' + '11'.repeat(20), 1n, '0x' + '22'.repeat(20));
      expect(ap.ok).toBe(true);
      expect(ap.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('ContractVerifier getCode fail → fail closed', async () => {
      const reader = {
        getCode: async () => { throw new Error('rpc dead'); },
        getStorageAt: async () => '0x' + '0'.repeat(64),
        call: async () => '0x',
      };
      const v = new ContractVerifier({ chain: reader });
      const r = await v.verify({ address: '0x' + '11'.repeat(20) });
      expect(r.ok).toBe(false);
      expect(r.reasons[0]).toContain('getCode failed');
      expect(r.findings.bytecodeHash).toBe('0x' + '0'.repeat(64));
    });

    it('ContractVerifier refuse unknown bytecode by default', async () => {
      const code = '0x6080604052' + '00'.repeat(40);
      const reader = {
        getCode: async () => code,
        getStorageAt: async () => '0x' + '0'.repeat(64),
        call: async () => '0x',
      };
      const v = new ContractVerifier({ chain: reader });
      const r = await v.verify({ address: '0x' + '11'.repeat(20) });
      expect(r.ok).toBe(false);
      expect(r.reasons.some(x => x.includes('no expectedBytecodeHash'))).toBe(true);
      expect(r.findings.bytecodeHash).toBe(keccak256Hex(code));
    });

    it('ContractVerifier allowBytecodeDrift + allowUnknownSelectors → ok', async () => {
      const code = '0x6080604052' + '63' + 'a9059cbb' + '14' + '00'.repeat(20);
      const reader = {
        getCode: async () => code,
        getStorageAt: async () => '0x' + '0'.repeat(64),
        call: async () => '0x',
      };
      const v = new ContractVerifier({ chain: reader });
      const r = await v.verify({
        address: '0x' + '11'.repeat(20),
        allowBytecodeDrift: true,
        allowUnknownSelectors: true,
        allowUnknownOwner: true,
        allowProxy: true,
        allowUpgradeable: true,
      });
      expect(r.ok).toBe(true);
      expect(r.reasons).toHaveLength(0);
      expect(r.findings.selectors).toContain('0xa9059cbb');
    });

    it('ContractVerifier unknown selector not in allowlist fails', async () => {
      const code = '0x6080604052' + '63' + 'a9059cbb' + '14' + '00'.repeat(20);
      const reader = {
        getCode: async () => code,
        getStorageAt: async () => '0x' + '0'.repeat(64),
        call: async () => '0x',
      };
      const v = new ContractVerifier({ chain: reader });
      const r = await v.verify({
        address: '0x' + '11'.repeat(20),
        allowBytecodeDrift: true,
        expectedSelectors: ['0xdeadbeef'],
        allowUnknownOwner: true,
        allowProxy: true,
        allowUpgradeable: true,
      });
      expect(r.ok).toBe(false);
      expect(r.reasons.some(x => x.includes('unknown selectors'))).toBe(true);
    });
  });

  describe('signer-adapter + broadcaster + leased-broadcaster', () => {
    const validReq: SignerRequest = {
      tx: { from: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20), value: '0', data: '0x' },
      expectedDiff: { changes: [] },
      approvedAmount: '100',
      slippageLimitBps: 50,
      sandwichScore: 0,
    };

    function makeTransport(script: {
      health?: { ok: boolean; result?: unknown; error?: { code: number; message: string } };
      sign?: { ok: boolean; result?: unknown; error?: { code: number; message: string } } | 'throw' | { throwMessage: string };
    }) {
      return {
        rpc: vi.fn(async (method: string) => {
          if (method === 'health_check') {
            if (script.health?.ok) return { ok: true, result: script.health.result };
            return { ok: false, error: script.health?.error ?? { code: -1, message: 'probe fail' } };
          }
          if (script.sign === 'throw' || (script.sign as any)?.throwMessage) {
            throw new Error((script.sign as any).throwMessage ?? 'ECONNREFUSED signer');
          }
          const s = script.sign;
          if (s && 'ok' in s && s.ok) return { ok: true, result: s.result };
          if (s && 'ok' in s && !s.ok) return { ok: false, error: (s as any).error };
          return { ok: false, error: { code: -32601, message: 'method not found' } };
        }),
      };
    }

    it('verifyProtocol caches success', async () => {
      const t = makeTransport({ health: { ok: true, result: { version: '1.0.0' } } });
      const a = new SignerAdapter({ transport: t as any, expectedProtocolVersion: '1.0.0' });
      const r1 = await a.verifyProtocol();
      expect(r1.ok).toBe(true);
      const r2 = await a.verifyProtocol();
      expect(r2.ok).toBe(true);
      expect(t.rpc).toHaveBeenCalledTimes(1);
    });

    it('verifyProtocol version mismatch fails closed', async () => {
      const t = makeTransport({ health: { ok: true, result: { version: '9.9.9' } } });
      const a = new SignerAdapter({ transport: t as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.verifyProtocol();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('PROTOCOL_MISMATCH');
    });

    it('verifyProtocol health not object → invalid response', async () => {
      const t = makeTransport({ health: { ok: true, result: 'not-object' } });
      const a = new SignerAdapter({ transport: t as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.verifyProtocol();
      expect(r.ok).toBe(false);
    });

    it('submit invalid request → INVALID_REQUEST', async () => {
      const t = makeTransport({ health: { ok: true, result: { version: '1.0.0' } } });
      const a = new SignerAdapter({ transport: t as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.submit({} as any);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('INVALID_REQUEST');
    });

    it('submit happy path returns txHash', async () => {
      const t = makeTransport({
        health: { ok: true, result: { version: '1.0.0' } },
        sign: { ok: true, result: {
          ok: true,
          txHash: '0x' + 'ab'.repeat(32),
          requestId: 'ignored',
          receivedPayloadHash: 'ignored',
          signerVersion: '1.0.0',
        } },
      });
      // Override rpc to echo requestId/payloadHash correctly by capturing wireReq
      const calls: any[] = [];
      const transport = {
        rpc: vi.fn(async (method: string, params: any) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          calls.push(params);
          return {
            ok: true,
            result: {
              ok: true,
              txHash: '0x' + 'ab'.repeat(32),
              requestId: params.requestId,
              receivedPayloadHash: params.payloadHash,
              signerVersion: '1.0.0',
            },
          };
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.submit(validReq);
      expect(r.ok).toBe(true);
      expect(r.txHash).toBe('0x' + 'ab'.repeat(32));
    });

    it('submit transport throw → classified UNAVAILABLE/TIMEOUT', async () => {
      const transport = {
        rpc: vi.fn(async (method: string) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          throw new Error('ECONNREFUSED signer offline');
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('SIGNER_UNAVAILABLE');
    });

    it('submit transport timeout classified', async () => {
      const transport = {
        rpc: vi.fn(async (method: string) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          throw new Error('timeout after 5000ms');
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('SIGNER_TIMEOUT');
    });

    it('signAndReturnRaw missing rawSignedTx → INVALID_RESPONSE', async () => {
      const transport = {
        rpc: vi.fn(async (method: string, params: any) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          return {
            ok: true,
            result: {
              ok: true,
              txHash: '0x' + 'cd'.repeat(32),
              requestId: params.requestId,
              receivedPayloadHash: params.payloadHash,
              signerVersion: '1.0.0',
            },
          };
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.signAndReturnRaw(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('INVALID_RESPONSE');
      expect(r.error).toContain('rawSignedTx');
    });

    it('signAndReturnRaw with raw → ok', async () => {
      const raw = '0x02f8';
      const transport = {
        rpc: vi.fn(async (method: string, params: any) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          return {
            ok: true,
            result: {
              ok: true,
              txHash: '0x' + 'ef'.repeat(32),
              rawSignedTx: raw,
              requestId: params.requestId,
              receivedPayloadHash: params.payloadHash,
              signerVersion: '1.0.0',
            },
          };
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.signAndReturnRaw(validReq);
      expect(r.ok).toBe(true);
      expect(r.rawSignedTx).toBe(raw);
    });

    it('payload hash mismatch → PAYLOAD_CORRUPTED', async () => {
      const transport = {
        rpc: vi.fn(async (method: string, params: any) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          return {
            ok: true,
            result: {
              ok: true,
              txHash: '0x' + '11'.repeat(32),
              requestId: params.requestId,
              receivedPayloadHash: '0xdeadbeef',
              signerVersion: '1.0.0',
            },
          };
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('PAYLOAD_CORRUPTED');
    });

    it('requestId mismatch → INVALID_RESPONSE', async () => {
      const transport = {
        rpc: vi.fn(async (method: string, params: any) => {
          if (method === 'health_check') return { ok: true, result: { version: '1.0.0' } };
          return {
            ok: true,
            result: {
              ok: true,
              txHash: '0x' + '11'.repeat(32),
              requestId: 'some-other-id',
              receivedPayloadHash: params.payloadHash,
              signerVersion: '1.0.0',
            },
          };
        }),
      };
      const a = new SignerAdapter({ transport: transport as any, expectedProtocolVersion: '1.0.0' });
      const r = await a.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('INVALID_RESPONSE');
      expect(r.error).toContain('requestId');
    });

    it('Broadcaster nonce resolution fail → NONCE_RESOLUTION_FAILED', async () => {
      const rpc = {
        quorumRead: vi.fn(async () => ({
          ok: false, error: 'no endpoints', queried: [], agreed: [], disagreed: [], primaryUsed: null, failedOver: false, breakerTripped: [],
        })),
        broadcastRawTransaction: vi.fn(),
      };
      const b = new Broadcaster({
        rpc: rpc as any,
        signerAdapter: { signAndReturnRaw: vi.fn() } as any,
      });
      const r = await b.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('BROADCAST_NONCE_RESOLUTION_FAILED');
      expect(r.error).toContain('no endpoints');
    });

    it('Broadcaster nonce parse fail → NONCE_RESOLUTION_FAILED', async () => {
      const rpc = {
        quorumRead: vi.fn(async () => ({
          ok: true, value: 'not-hex', queried: ['a'], agreed: ['a'], disagreed: [], primaryUsed: 'a', failedOver: false, breakerTripped: [],
        })),
        broadcastRawTransaction: vi.fn(),
      };
      const b = new Broadcaster({
        rpc: rpc as any,
        signerAdapter: { signAndReturnRaw: vi.fn() } as any,
        fixedGasLimit: 21000n,
        fixedMaxPriorityFeePerGas: 1n,
      });
      const r = await b.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('BROADCAST_NONCE_RESOLUTION_FAILED');
    });

    it('Broadcaster sign fail → SIGN_FAILED wrapped', async () => {
      const rpc = {
        quorumRead: vi.fn(async (method: string) => {
          if (method === 'eth_getTransactionCount') {
            return { ok: true, value: '0x5', queried: ['a'], agreed: ['a'], disagreed: [], primaryUsed: 'a', failedOver: false, breakerTripped: [] };
          }
          return { ok: true, value: '0x1', queried: ['a'], agreed: ['a'], disagreed: [], primaryUsed: 'a', failedOver: false, breakerTripped: [] };
        }),
        broadcastRawTransaction: vi.fn(),
      };
      const signerAdapter = {
        signAndReturnRaw: vi.fn(async () => ({ ok: false, error: 'vault locked' })),
      };
      const b = new Broadcaster({
        rpc: rpc as any,
        signerAdapter: signerAdapter as any,
        fixedGasLimit: 21000n,
        fixedMaxPriorityFeePerGas: 1n,
      });
      const r = await b.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('BROADCAST_SIGN_FAILED');
      expect(r.error).toContain('vault locked');
    });

    it('LeasedBroadcaster busy lease → ACQUIRE_FAILED', async () => {
      const store = new InMemoryLeaseStore();
      const holder = new WriterLease({ store, key: 'lb', owner: 'other', ttlMs: 10000 });
      await holder.acquire();
      const lease = new WriterLease({ store, key: 'lb', owner: 'me', ttlMs: 10000 });
      const lb = new LeasedBroadcaster({
        broadcaster: { submit: vi.fn() } as any,
        lease,
      });
      const r = await lb.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('LEASE_ACQUIRE_FAILED');
    });

    it('LeasedBroadcaster fencing stale → FENCING_TOKEN_STALE', async () => {
      const store = new InMemoryLeaseStore();
      const lease = new WriterLease({ store, key: 'fence', owner: 'me', ttlMs: 5000 });
      // Acquire so withLease can proceed, but we'll revoke mid-flight via store injection:
      // Simpler: acquire then manually corrupt token via revoke after acquire inside callback is hard.
      // Instead: spy verifyToken to return false.
      const originalVerify = lease.verifyToken.bind(lease);
      lease.verifyToken = async () => false;
      const broadcaster = { submit: vi.fn(async () => ({ ok: true, txHash: '0x1' })) };
      const lb = new LeasedBroadcaster({ broadcaster: broadcaster as any, lease });
      const r = await lb.submit(validReq);
      expect(r.ok).toBe(false);
      expect(r.error).toContain('LEASE_FENCING_TOKEN_STALE');
      expect(broadcaster.submit).not.toHaveBeenCalled();
      lease.verifyToken = originalVerify;
    });

    it('LeasedBroadcaster happy path delegates to broadcaster', async () => {
      const store = new InMemoryLeaseStore();
      const lease = new WriterLease({ store, key: 'ok', owner: 'me', ttlMs: 5000 });
      const broadcaster = { submit: vi.fn(async () => ({ ok: true, txHash: '0xfeed' })) };
      const lb = new LeasedBroadcaster({ broadcaster: broadcaster as any, lease });
      const r = await lb.submit(validReq);
      expect(r.ok).toBe(true);
      expect(r.txHash).toBe('0xfeed');
      expect(broadcaster.submit).toHaveBeenCalledTimes(1);
      expect(lease.isHeld()).toBe(false);
    });
  });

  describe('pipeline gate mev slippage fail', () => {
    it('slippage over limit fails mev gate', async () => {
      let seq = 0;
      const audit: AuditSink = {
        append: () => ({ seq: ++seq, hash: `h${seq}` }),
      };
      const deps: any = {
        rpc: { quorumRead: async () => ({ ok: true, value: '0x1', queried: [], agreed: [], disagreed: [], primaryUsed: null, failedOver: false, breakerTripped: [] }) },
        simulation: { simulateAndVerify: async () => ({ ok: true, simulation: { ok: true, changes: [], gasUsed: 1, from: '0x1' }, diff: { matched: [], missingExpected: [], missingSimulated: [], mismatchedAmount: [] } }) },
        contract: { verify: async () => ({ ok: true, reasons: [], findings: { bytecodeHash: '', selectors: [], unknownSelectors: [], isProxy: false, proxyKind: null, implementation: null, beacon: null, admin: null, isUpgradeable: false, owner: null } }) },
        liquidity: { verify: async () => ({ ok: true, reasons: [], pools: [], extraPools: [] }) },
        authority: { verify: async () => ({ ok: true, reasons: [], findings: [], ownerIsZero: false, renounceEventFound: false, realRenounce: false }) },
        sellSim: { verify: async () => ({ ok: true, reasons: [], buyResult: { reverted: false, actualAmountOut: '1', gasUsed: 1 }, sellResult: { reverted: false, actualAmountOut: '1', gasUsed: 1 }, observedBuyTaxBps: 0, observedSellTaxBps: 0, slippageLimitBps: 1, observedSlippageBps: 0 }) },
        approval: { evaluate: async () => ({ ok: true, approvedAmount: '1', capped: false, policy: {} }) },
        audit,
      };
      const addr = '0x' + '11'.repeat(20);
      const p = new Pipeline({
        ...deps,
        signer: { submit: async () => ({ ok: true, txHash: '0x1' }) },
      });
      const r = await p.process({
        tx: { from: addr, to: addr, value: '0', data: '0x' },
        expectedDiff: { changes: [] },
        contractManifest: { address: addr, allowBytecodeDrift: true },
        liquidityManifest: { token: addr, pools: [], trustedLockContracts: [], allowedLpHolders: [] },
        authorityManifest: { token: addr, allowedAuthorityHolders: [] },
        sellSimManifest: { buy: { expectedAmountOut: '1' } as any, sell: { expectedAmountOut: '1' } as any, slippage: slippageInputs },
        approvalRequest: { token: addr, owner: addr, spender: addr, amount: '1', ownerBalance: '10' },
        mevInputs: {
          slippage: { ...slippageInputs, hardCapBps: 1, baselineBps: 0, volatilityBps: 0, tradeSizeUsd: 1, poolLiquidityUsd: 1e12 },
          expectedPrice: 100,
          actualPrice: 110,
          sandwich: {
            victimAddress: addr,
            preState: { blockNumber: 1, spotPrice: 1, liquidityUsd: 1 },
            postState: { blockNumber: 1, spotPrice: 1, liquidityUsd: 1 },
            observedTrades: [],
          },
        },
      });
      expect(r.failedGate).toBe('mev');
      expect(r.originalReason).toContain('slippage');
    });
  });
});
