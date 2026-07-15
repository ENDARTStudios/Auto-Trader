# `architecture/interfaces.md` — Contratos Públicos

> Apenas assinaturas públicas (sem implementação). Reduz a
> necessidade de abrir múltiplos arquivos para entender integrações.
> Para detalhes de IPC/RPC, veja `contracts/rpc-contracts.md`.
> Para schemas de banco, veja `contracts/database-contracts.md`.

---

## Pipeline (H2.6)

```typescript
interface Pipeline {
  /**
   * Executa o fluxo canônico: gate → verify → approve → sign → broadcast.
   * Lança PipelineError em qualquer falha; NUNCA retorna silenciosamente.
   * Idempotente para o mesmo txHash (após M4).
   */
  process(input: PipelineInput): Promise<PipelineResult>;
}

interface PipelineInput {
  token: Address;
  amount: bigint;
  slippageBps: number;
  deadline: number;       // unix seconds
  canaryPct?: number;     // 0-100; default 0 (paper only)
}

interface PipelineResult {
  txHash: Hash;
  status: 'confirmed' | 'reverted' | 'sim-rejected' | 'lease-busy';
  receipt?: TransactionReceipt;
  auditId: string;        // hash-chain entry ID
}
```

---

## SignerSink (M3.1 — SignerAdapter)

```typescript
interface SignerSink {
  /**
   * Submete uma mensagem para assinatura pelo processo signer isolado.
   * Bloqueia até receber a assinatura ou timeout (default 5s).
   * A chave privada nunca sai do processo signer.
   */
  submit(request: SignRequest): Promise<SignResponse>;
}

interface SignRequest {
  method: 'personal_sign' | 'eth_signTypedData_v4' | 'eth_sendTransaction';
  params: unknown[];
  auditContext: AuditContext;   // quota, ip, requestId
}

interface SignResponse {
  signature: string;
  signerPubkey: string;
  auditHash: string;            // hash-chain entry ID no signer audit
}
```

---

## Broadcaster (M3.3)

```typescript
interface Broadcaster {
  /**
   * Envia tx assinada para o RPC quorum. Lida com retries, nonce gap,
   * gas bumping. NUNCA altera o payload assinado.
   * Erros do signer são prefixados `BROADCAST_SIGNER_*` (DEC-005).
   */
  broadcast(signedTx: string, opts?: BroadcastOpts): Promise<BroadcastResult>;
}

interface BroadcastOpts {
  maxRetries?: number;          // default 3
  gasBumpBps?: number;          // default 50 (0.5%)
  timeoutMs?: number;           // default 30_000
}

interface BroadcastResult {
  txHash: Hash;
  confirmed: boolean;
  receipt?: TransactionReceipt;
  attempts: number;
}
```

---

## WriterLease (M4 — Kleppmann fencing)

```typescript
interface WriterLease {
  /**
   * Adquire lease exclusiva. Retorna fencing token monotônico.
   * Rejeita se outra lease está ativa (LEASE_BUSY).
   */
  acquire(holder: string, ttlMs: number): Promise<LeaseToken>;

  /**
   * Renova lease existente. Mesmo fencing token (novo expiresAt).
   * Falha se a lease já expirou ou foi roubada.
   */
  renew(token: LeaseToken, ttlMs: number): Promise<LeaseToken>;

  /**
   * Libera lease voluntariamente antes do TTL expirar.
   * Idempotente — chamar com token já expirado é no-op.
   */
  release(token: LeaseToken): Promise<void>;

  /**
   * Verifica se um token é válido (não expirado, não revogado).
   * Usado pelo LeasedBroadcaster antes de cada broadcast.
   */
  verifyToken(token: LeaseToken): boolean;
}

interface LeaseToken {
  fence: number;                // monotônico crescente
  holder: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;            // HMAC do signer para evitar forja
}
```

REG-015 (fence monotônico), REG-016 (exclusividade), REG-017 (renew),
REG-018 (reconnect não reanima lease stale).

---

## Registry (M5.5 — Observability)

```typescript
interface Registry {
  /**
   * Counter: incrementa em 1 (default) ou N. Nunca decrementa.
   * Use para: tx count, error count, request count.
   */
  counter(name: string, labels?: Labels): Counter;

  /**
   * Gauge: set absoluto ou inc/dec. Use para: heap used, active leases,
   * canaryPct atual.
   */
  gauge(name: string, labels?: Labels): Gauge;

  /**
   * Histogram: observa valores com buckets configuráveis.
   * Use para: latência de RPC, duração de broadcast, tick duration.
   */
  histogram(name: string, buckets?: number[], labels?: Labels): Histogram;

  /**
   * Snapshot read-only de todas as métricas no instante T.
   * Consumido por `/api/runtime/status` e pelos harnesses M5.
   */
  snapshot(): MetricsSnapshot;
}

interface Counter {
  inc(n?: number): void;
  value(): number;
}

interface Gauge {
  set(v: number): void;
  inc(n?: number): void;
  dec(n?: number): void;
  value(): number;
}

interface Histogram {
  observe(v: number): void;
  snapshot(): { count: number; sum: number; buckets: Record<string, number> };
}
```

> **Invariante (DEC-004):** todos os harnesses M5 (Chaos, Shadow,
> Canary, Long-Duration) consomem o MESMO Registry — nunca criam
> coleta própria de métricas. Ver `architecture/invariants.md`.

---

## Runtime (M5.0 — factory)

```typescript
interface Runtime {
  /**
   * Tick único do loop principal. Idempotente após M4 (lease-aware).
   * Lança `LeaseBusyError` se não houver lease ativa.
   */
  tick(): Promise<void>;

  /**
   * Inicia loop `while(running) { await tick(); await sleep(period); }`.
   * NÃO usa setInterval (motivo: Long-Duration harness precisa de
   * controle granular do sleep entre ticks).
   */
  start(periodMs: number): Promise<void>;

  /**
   * Sinaliza stop. O próximo tick NÃO é executado; loop termina limpo.
   */
  stop(): void;

  /**
   * Snapshot de estado interno para diagnóstico.
   */
  status(): RuntimeStatus;
}

function buildRuntime(opts: RuntimeOpts): Runtime;
```

---

## Signer protocol (M3.2 — IPC binário)

```typescript
// Contrato do protocolo binário entre engine e processo signer.
// Definido em src/lib/signer-protocol.ts. FROZEN — qualquer mudança
// é breaking change (Regra 9 CORE_RULES.md).

interface SignerProtocol {
  // Frame header: 4 bytes magic + 4 bytes length + 1 byte type + payload
  encode(request: SignerRequest): Buffer;
  decode(buffer: Buffer): SignerResponse;
}

type SignerRequest =
  | { type: 'wallet_list'; }
  | { type: 'wallet_add'; mnemonic: string; }
  | { type: 'sign'; message: string; method: SignMethod; }
  | { type: 'audit_snapshot'; sinceHash?: string; };

type SignerResponse =
  | { type: 'ok'; payload: unknown; auditHash: string; }
  | { type: 'error'; code: string; message: string; auditHash: string; };
```

---

## Notas de uso

- **NUNCA** referenciar métodos privados (`#name`, `_name`) em
  código externo ao módulo dono.
- Toda adição de método público aqui DEVE ser refletida no código
  real antes do merge (Regra 3 CORE_RULES.md — não inventar APIs).
- Toda remoção/renomeação de método público é breaking change
  (Regra 9 CORE_RULES.md) — requer entrada em `DECISION_LOG.md`.
