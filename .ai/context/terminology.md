# context/terminology.md — Terminologia Técnica

> Significado dos termos utilizados neste projeto. Quando um termo
> aparecer em qualquer documento `.ai/` ou no código, seu significado
> é o definido aqui. Para termos por ordem alfabética ver
> `glossary.md`.

---

## Hardening Roadmap (fases)

### H0 — Crypto Foundation

Camada fundacional de primitivos criptográficos: KDF versionada,
audit hash-chain, key rotation. Sem H0, nada acima é confiável.

### H1 — RPC/Sim/Approval/MEV

Camada de defesa da interação com a blockchain: RPC quorum
(resiliência contra endpoint malicioso), simulation gate (simula
tx antes de broadcastar), approval hardening (rejeita approvals
ilimitados), MEV baseline (detecta sandwich opportunity).

### H2 — Contract/Liquidity/TokenAuthority/SellSim

Camada de verificação do ativo antes de trade: contract
verification (source code via Etherscan/Sourcify), liquidity
verification (LP lock, concentração), token authority (mint/freeze/
upgrade), sell simulation (honeypot detection via simulação de
sell antes de buy).

### H2.6 — Pipeline

Composição dos gates H1+H2 em sequência. `PipelineResult` é o
contrato consumido por `signer-adapter`.

### M3 — SignerAdapter / Signer RPC / Broadcaster

- **M3.1 SignerAdapter:** adaptador IPC entre engine e processo
  signer.
- **M3.2 Signer RPC:** signer isolado em processo próprio. Chave
  privada nunca sai do processo.
- **M3.3 Broadcaster:** submete tx ao RPC quorum, aguarda receipt,
  classifica erros.

### M4 — Writer Lease

Lease distribuído com fencing tokens (Kleppmann pattern). Cada
acquire recebe token monotônico. LeasedBroadcaster verifica token
antes de broadcastar.

### M5 — Production Validation

Validação operacional sem adicionar funcionalidade. 7 sub-fases:
M5.0 Runtime factory, M5.1 Dry Run, M5.5 Observability, M5.4 Chaos,
M5.2 Shadow, M5.3 Canary, M5.6 Long-Duration, M5.7 Finalização.

### M6 — Live Trading (proposto)

Transição controlada de paper para live via canaryPct ramp 1% →
5% → 10% → 25% → 100% com rollback automático.

---

## Conceitos do M4 (Writer Lease)

### Fencing token

Número monotônico estrito emitido a cada lease acquire. O
`LeasedBroadcaster` verifica o token antes de broadcastar. Writer
stale (com token antigo) é rejeitado mesmo que acredite ter a lease.

### Kleppmann pattern

Padrão de distributed locking descrito por Martin Kleppmann ("How to
do distributed locking"): lease + fencing token monotônico. Sem
fencing, time-based locks são vulneráveis a clock skew e GC pauses.

### LeaseStore

Interface que persiste o estado da lease. `InMemoryLeaseStore` é a
default. Produção pode usar Redis/Postgres backend sem tocar a
interface.

### LeaseOwner

Identificador único de um writer. Gerado por `generateOwnerId()`
combinando `hostname + pid + random`.

### FENCING_TOKEN_STALE

Erro emitido pelo `LeasedBroadcaster` quando o token apresentado é
menor que o token atual do LeaseStore. Indica que o writer está
stale e sua lease foi revogada.

---

## Conceitos do M5 (Production Validation)

### Registry

Objeto único que acumula todas as métricas do runtime. Fonte de
verdade para todos os harnesses (dry-run, chaos, shadow, canary,
long-duration) e para o endpoint `/api/runtime/status`.

### Histogram

Tipo de métrica que registra distribuição de valores (ex.:
latência em ms). Permite calcular P50/P95/P99. Usado para
`signerLatencyMs`, `pipelineLatencyMs`, `broadcastLatencyMs`,
`leaseAcquireMs`.

### Counter

Tipo de métrica que só incrementa (ex.: contagem de erros, rounds
sucedidos). `rpcErrors`, `signerErrors`, `broadcastErrors`,
`gateRejects.*`, `canaryAccepted`, `canarySkipped`, `shadowDiffs`,
`roundsStarted/Succeeded/Failed`.

### Gauge

Tipo de métrica que pode subir ou descer (ex.: owner ativo da
lease, uptime em segundos). `activeLeaseOwner`, `uptimeSeconds`.

### Shadow Mode

Modo onde a MESMA Pipeline é executada, mas o output é forkado
para Live + Shadow. Shadow compara com Live; em divergência,
incrementa `shadowDiffs`. Não roda duas pipelines paralelas.

### Canary Mode

Modo onde apenas uma fração das tx (determinística por txHash) é
broadcastada. `bucket = keccak256(txHash) % 100; bucket < canaryPct`.
Permite ramp gradual de paper → live.

### ChaosInjector

Classe independente que injeta falhas em um componente específico
(RPC, signer, lease, broadcaster, rede). Interface: `before()`,
`after()`, `cleanup()`. Sem `if (chaos)` espalhado no código.

### Long-Duration loop

Padrão de execução contínua `while (running) { await
runtime.tick(); await sleep(period); }`. Não usar `setInterval`
(pois este não aguarda o tick completar e pode acumular em background).

---

## Conceitos do H1 (RPC/Sim/Approval/MEV)

### Quorum

Conjunto de N endpoints RPC. Chamada é feita a todos; resposta é
validada por maioria. Endpoint em desacordo é quarantine.

### Quarantine

Endpoint RPC temporariamente removido do quorum por comportamento
suspeito (chain id errado, block stale, balance errado).

### Simulation gate

Gate que simula a tx via `eth_call` antes de broadcastar. Se a
simulação reverte, broadcast é bloqueado.

### MEV (Maximal Extractable Value)

Valor que miner/validator pode extrair reordenando txs. Sandwich
attack é a forma mais comum em DEX: attacker compra antes da vítima
e vende depois, capturando o slippage.

### Approval hardening

Gate que rejeita approvals de ERC-20 que sejam `type(uint256).max`
(ilimitado), maiores que o cap configurado, ou maiores que o saldo
on-chain do approver.

---

## Conceitos do H2 (Contract/Liquidity/TokenAuthority/SellSim)

### LP lock

Token lock do liquidity provider. Se expirado ou inexistente, LP
pode ser removido a qualquer momento (rug pull).

### Mint authority

Capacidade de mintar novos tokens. Se não renunciada, owner pode
inflar supply e dumpar.

### Freeze authority

Capacidade de congelar saldos de holders. Se ativa, owner pode
impedir sells (honeypot variant).

### Honeypot

Token cuja buy funciona mas sell reverte. Detectado via sell
simulation antes de buy.

### Proxy oculto

Contrato que delega chamadas para outro (implementação). Se não
declarado, permite upgrade stealth que muda a lógica.

---

## Conceitos do M3 (SignerAdapter / Signer RPC / Broadcaster)

### IPC (Inter-Process Communication)

Comunicação entre processo engine e processo signer. Definida em
`src/lib/signer-protocol.ts`. Mensagens serializadas com reqId
para correlação.

### Domain separator

String constante usada em assinaturas para evitar cross-protocol
signature reuse. Definida em `src/signer/sign-methods.ts`.

### BroadcastError

Tipo de erro do Broadcaster. Prefixos `BROADCAST_*` permitem
classificação pelo LeasedBroadcaster sem introspecção de mensagem.
`BROADCAST_SIGNER_*` para erros do signer, `BROADCAST_RPC_*` para
erros do RPC, etc.

---

## Conceitos de Audit (H0.3)

### Hash-chain

Sequência de entradas onde cada entrada inclui o hash da anterior.
Permite detectar tampering: modificar qualquer entrada quebra a
cadeia a partir dali.

### Replacer-function (JSON.stringify)

Forma de `JSON.stringify` que usa função (não array) como segundo
argumento. Permite ordenar chaves recursivamente em todos os
níveis, garantindo determinismo. Bug H0.3: forma replacer-array
silenciosamente dropava nested keys.

### REG-NNN

Identificador de regressão em `SECURITY.md`. Cada REG é um teste
que pinna um invariant de segurança. REG adversarial = teste que
tenta explicitamente quebrar o invariant.

---

## Conceitos operacionais

### Paper mode

Modo onde tx são simuladas; nada vai on-chain. Default do sistema.

### Live mode

Modo onde tx são broadcastadas para a blockchain. Controlado por
canaryPct em M6.

### Kill switch

Botão de parada global. Ativa via `/api/kill-switch`. Toda
atividade de trading para imediatamente.

### Canary ramp

Estratégia de rollout gradual: 1% → 5% → 10% → 25% → 100% das tx
em live mode. Se taxa de falha > threshold, rollback automático
para o nível anterior via `setCanaryPct`.

---

## Termos de processo (governança)

### FROZEN

Marca de arquivo que não deve ser alterado sem autorização
explícita + entrada em `DECISION_LOG.md`. Ver
`architecture/frozen-files.md` para lista completa.

### ADR (Architecture Decision Record)

Documento em `.ai/decisions/ADR-NNNN.md` que registra uma
decisão arquitetural. Formato: Data, Título, Contexto,
Alternativas, Escolha, Motivação, Impacto, Arquivos, Rollback.

### DEC-NNN

Identificador de decisão em `DECISION_LOG.md`. Mesmo conceito que
ADR mas com formato mais compacto.

### Project OS

Conceito desta pasta `.ai/`: camada permanente de memória,
governança, arquitetura e documentação viva que acompanha o
projeto durante todo o seu ciclo de desenvolvimento.
