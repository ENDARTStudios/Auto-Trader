# `contracts/rpc-contracts.md` — Contratos RPC e IPC

> **STATE: FROZEN** — Contrato RPC + IPC signer — binário breaking change requer ADR.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Cobertura dupla:
> 1. **RPC blockchain** — chamadas JSON-RPC para nodes (Ethereum,
>    BSC, L2s).
> 2. **IPC signer** — protocolo binário entre engine e processo
>    signer isolado (M3.2).

---

## 1. RPC Blockchain

### Endpoints canônicos (quorum H1.1)

```typescript
interface RpcEndpoint {
  url: string;            // ex.: https://bsc-dataseed.binance.org/
  weight: number;         // peso no quorum (default 1)
  maxRequestsPerSecond: number;
  timeout: number;        // ms
  priority: number;       // menor = mais prioritário
}
```

### Métodos JSON-RPC usados

| Método                       | Uso                                         |
| ---------------------------- | ------------------------------------------- |
| `eth_chainId`                | Verificação de rede                         |
| `eth_blockNumber`            | Block height atual                          |
| `eth_getBalance`             | Saldo de carteira                           |
| `eth_getTransactionCount`    | Nonce para nova tx                          |
| `eth_estimateGas`            | Estimativa de gas (simulação)               |
| `eth_call`                   | Call read-only (simulation gate H1.2)       |
| `eth_sendRawTransaction`     | Envia tx assinada (broadcaster M3.3)        |
| `eth_getTransactionReceipt`  | Confirmação de tx                           |
| `eth_getCode`                | Verifica se address é contract (H2.1)       |
| `eth_getStorageAt`           | Lê storage (approval check H1.3)            |
| `eth_getLogs`                | Event logs (liquidity verification H2.2)    |
| `net_version`                | Network ID                                  |

### Quorum e fallback (H1.1)

```typescript
interface RpcQuorum {
  /**
   * Executa chamada read (eth_call, eth_getBalance, etc.) com
   * quorum: 2+ endpoints concordam no resultado.
   * Em divergência, usa endpoint de maior prioridade e loga
   * warning.
   */
  read<T>(method: string, params: unknown[]): Promise<T>;

  /**
   * Executa chamada write (eth_sendRawTransaction) com fallback:
   * tenta endpoint prioritário; em falha, próximo; etc.
   * NÃO usa quorum para write (poderia causar double-broadcast).
   */
  write(method: string, params: unknown[]): Promise<string>;

  /**
   * Health check: pinga todos os endpoints, retorna status.
   */
  healthCheck(): Promise<RpcHealth[]>;
}
```

### Retry policy

- **Reads:** até 3 retries com backoff exponencial (100ms, 200ms, 400ms).
- **Writes:** até 3 retries sem backoff (imediato); em tx já no
  mempool (nonce usado), NÃO retém.
- **Timeouts:** 5s para reads, 30s para writes (espera receipt).

### Erros classificados

| Code                  | Significado                                       | Ação                |
| --------------------- | ------------------------------------------------- | ------------------- |
| `RPC_TIMEOUT`         | Endpoint não respondeu em `timeout`               | Retry com backoff   |
| `RPC_RATE_LIMIT`      | 429 do endpoint                                   | Fallback            |
| `RPC_BAD_RESPONSE`    | JSON inválido ou campo faltante                    | Retry sem backoff   |
| `RPC_DIVERGENCE`      | Quorum endpoints divergem                         | Log warning, usa prio |
| `RPC_ALL_FAILED`      | Todos endpoints falharam                          | Lança erro          |
| `RPC_TX_REVERTED`     | `eth_call` retornou revert                        | Simulation gate rejeita |
| `RPC_TX_ALREADY_SENT` | `eth_sendRawTransaction` diz "already known"      | Trata como sucesso  |

---

## 2. IPC Signer (M3.2)

### Protocolo binário

Comunicação via stdin/stdout entre engine (parent) e signer
(child process). Frame format:

```
+---------+--------+------+------------------+
| magic   | length | type | payload          |
| 4 bytes | 4 bytes| 1 byte| length bytes    |
+---------+--------+------+------------------+
```

- **Magic:** `0xGLM5` (4 bytes fixos, little-endian).
- **Length:** uint32 little-endian (tamanho do payload).
- **Type:** 1 byte (1=request, 2=response, 3=event, 4=error).
- **Payload:** JSON stringificado UTF-8.

### Tipos de mensagem

#### Requests (engine → signer)

```typescript
type SignerRequest =
  | { type: 'wallet_list' }
  | { type: 'wallet_add'; mnemonic: string; path?: string }
  | { type: 'wallet_remove'; pubkey: string }
  | { type: 'sign'; pubkey: string; message: string; method: SignMethod; auditContext: AuditContext }
  | { type: 'audit_snapshot'; sinceHash?: string }
  | { type: 'health_check' };

type SignMethod = 'personal_sign' | 'eth_signTypedData_v4' | 'eth_signTransaction';

interface AuditContext {
  requestId: string;
  ip: string;
  quota: string;       // ex.: "10/hour"
  reason: string;      // ex.: "execute_buy_order"
}
```

#### Responses (signer → engine)

```typescript
type SignerResponse =
  | { type: 'ok'; payload: unknown; auditHash: string }
  | { type: 'error'; code: SignerErrorCode; message: string; auditHash: string };

type SignerErrorCode =
  | 'SIGNER_WALLET_NOT_FOUND'
  | 'SIGNER_INVALID_MNEMONIC'
  | 'SIGNER_QUOTA_EXCEEDED'
  | 'SIGNER_METHOD_UNSUPPORTED'
  | 'SIGNER_INTERNAL_ERROR'
  | 'SIGNER_AUDIT_FAILED';
```

#### Events (signer → engine, unidirecional)

```typescript
type SignerEvent =
  | { type: 'ready' }                    // signer inicializado
  | { type: 'wallet_added'; pubkey: string }
  | { type: 'wallet_removed'; pubkey: string }
  | { type: 'audit_appended'; hash: string; seq: number }
  | { type: 'shutdown' };                // signer está terminando
```

### Lifecycle

```
1. Engine: spawn('tsx', ['src/signer/main.ts'])
2. Engine: espera evento 'ready' no stdout
3. Engine: passa a aceitar SignerAdapter.submit()
4. Cada submit():
   a. Engine envia SignerRequest frame em stdin
   b. Signer valida, executa, grava audit
   c. Signer envia SignerResponse frame em stdout
   d. Engine resolve/rejeita a Promise
5. Em crash do signer: EOF no stdout
   a. Engine marca SignerAdapter como 'unavailable'
   b. Novos submit() rejeitam com SIGNER_UNAVAILABLE
   c. Engine NÃO tenta restartar (responsabilidade do operador)
```

### Invariantes do protocolo (INV-006)

- A chave privada NUNCA aparece em qualquer frame.
- O signer nunca lê de stdin mensagens que não sejam SignerRequest
  válidas (validação estrita com zod antes de processar).
- O engine nunca envia SignerRequest antes de receber evento `ready`.
- Em caso de payload maior que 1MB, o signer rejeita com
  `SIGNER_INVALID_REQUEST` (proteção contra DoS).

### Testes adversariais

| REG-NNN   | O que testa                                             |
| --------- | ------------------------------------------------------- |
| REG-XXX   | Signer rejeita SignerRequest com magic inválido         |
| REG-XXX   | Signer rejeita payload > 1MB                            |
| REG-XXX   | Signer rejeita `wallet_add` com mnemonic inválido       |
| REG-XXX   | Signer rejeita `sign` com pubkey inexistente            |
| REG-XXX   | Signer nunca loga mnemonic em stderr                    |
| REG-XXX   | Signer mantém audit chain mesmo após restart            |
| REG-XXX   | Engine detecta EOF no stdout e marca unavailable        |
| REG-XXX   | Quorum divergência logada mas não derruba engine        |

---

## 3. RPC interno do Next.js (server actions, route handlers)

Rotas Next.js App Router usam `Request`/`Response` padrão Web APIs.
Não há "RPC" customizado entre cliente e servidor — é REST sobre
HTTP. Ver `api-contracts.md` para detalhes.

---

## Evolução

1. **Adicionar método JSON-RPC:** sem breaking change. Documentar
   aqui.
2. **Adicionar tipo de SignerRequest/Response:** sem breaking
   change. Engine e signer devem ser atualizados simultaneamente
   (deploy coordinated).
3. **Mudar formato do frame (magic/length/type):** breaking change
   CRÍTICO — requer ADR + coordinated deploy + período de
   compatibilidade.
4. **Mudar SignMethod enum:** breaking change — adicionar novo é
   ok; remover existente requer ADR.

---

## Relacionado

- `architecture/interfaces.md` — SignerSink e SignerProtocol.
- `architecture/invariants.md` INV-006 — signer nunca expõe chave privada.
- `standards/security.md` STD-204 — signer isolation.
- `DECISION_LOG.md` DEC-002 — signer isolado em processo próprio.
- `decisions/ADR-0001.md` — arquitetura que justifica o protocolo IPC.
- `docs/signer-isolation-design.md` (raiz do projeto) — design detalhado.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

