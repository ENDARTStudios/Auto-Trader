# context/glossary.md — Glossário (ordem alfabética)

> Referência rápida de termos. Para contexto amplo de cada termo ver
> `terminology.md`.

---

## A

- **ADR** — Architecture Decision Record. Documento em
  `.ai/decisions/ADR-NNNN.md` registrando decisão arquitetural.
- **Approval hardening** — Gate H1.3 que rejeita approvals
  `type(uint256).max`, acima do cap, ou acima do saldo on-chain.
- **Audit hash-chain** — Sequência append-only onde cada entrada
  inclui o hash da anterior. Bug H0.3 corrigido.
- **Authority report** — Resultado do gate H2.3 (token authority).

## B

- **BroadcastError** — Tipo de erro do Broadcaster. Prefixos
  `BROADCAST_*` para classificação.
- **Broadcaster** — Módulo M3.3 que submete tx ao RPC quorum.

## C

- **Canary mode** — M5.3. Apenas `bucket = keccak256(txHash) % 100
  < canaryPct` das tx são broadcastadas.
- **CanaryPct** — Percentual de tx em canary (1% → 5% → 10% → 25%
  → 100% no M6).
- **ChaosInjector** — Classe independente M5.4 que injeta falhas.
  Interface: `before()/after()/cleanup()`.
- **Contract verification** — Gate H2.1. Source code via
  Etherscan/Sourcify.
- **Counter** — Tipo de métrica que só incrementa.

## D

- **DEC-NNN** — Identificador de decisão em `DECISION_LOG.md`.
- **Domain separator** — String constante em assinaturas para
  evitar cross-protocol reuse.
- **Dry Run** — M5.1. Testes happy-path com mocks, 1000 ops, 26/26
  pass.

## F

- **Fencing token** — Número monotônico emitido a cada lease
  acquire (M4, Kleppmann).
- **FENCING_TOKEN_STALE** — Erro do LeasedBroadcaster quando token
  apresentado é menor que o atual.
- **FROZEN** — Marca de arquivo que não deve ser alterado sem
  autorização explícita + entrada em `DECISION_LOG.md`.

## G

- **Gauge** — Tipo de métrica que pode subir ou descer.
- **Gate** — Cada estágio do Pipeline H2.6 (liquidity, authority,
  contract, simulation, mev, approval, sell-sim).
- **GateName** — Enum com nomes dos gates. Usado em
  `PipelineResult.reason` e em `gateRejects.<gate>`.

## H

- **Histogram** — Tipo de métrica que registra distribuição.
  Permite P50/P95/P99.
- **Honeypot** — Token cujo buy funciona mas sell reverte.
  Detectado via H2.4 sell simulation.
- **H0/H1/H2/H2.6** — Fases do hardening roadmap (Crypto / RPC /
  Contract / Pipeline).

## I

- **IPC** — Inter-Process Communication. Comunicação entre engine
  e signer (M3.2). Definida em `signer-protocol.ts`.

## K

- **Kleppmann pattern** — Distributed locking com fencing tokens
  monotônicos. Base do M4.

## L

- **LEASE_ACQUIRE_FAILED** — Erro wrapper do LeasedBroadcaster
  quando `LEASE_BUSY` ou `STORE_UNAVAILABLE`.
- **LEASE_BUSY** — Erro do LeaseStore quando acquire falha porque
  outro owner tem a lease.
- **LeaseOwner** — Identificador único de um writer. Gerado por
  `generateOwnerId()`.
- **LeaseStore** — Interface que persiste o estado da lease.
  `InMemoryLeaseStore` é a default.
- **LeasedBroadcaster** — Wrapper M4 sobre Broadcaster com
  pre-broadcast fencing check.
- **Long-Duration loop** — Padrão M5.6:
  `while(running) { await tick(); await sleep(); }`.

## M

- **MEV** — Maximal Extractable Value. Valor extraído por
  reordenamento de tx. Sandwich é a forma mais comum.
- **MEV baseline** — Gate H1.4 que detecta sandwich opportunity.
- **Mint authority** — Capacidade de mintar novos tokens. Se não
  renunciada, owner pode rug.
- **MockRpcTransport** — Mock de RPC para testes M5.1.

## O

- **Observability** — M5.5. Registry único + `/api/runtime/status`.

## P

- **Paper mode** — Default. Tx simuladas; nada on-chain.
- **Pipeline** — Módulo H2.6 que compõe os gates H1+H2.
- **PipelineResult** — Contrato de saída do Pipeline. Consumido
  por `signer-adapter`.
- **Proxy oculto** — Contrato que delega chamadas sem declarar.
  Permite upgrade stealth.

## Q

- **Quorum** — Conjunto de N endpoints RPC. Decisão por maioria.
  Endpoint divergente é quarantine.
- **Quarantine** — Endpoint RPC temporariamente removido do
  quorum por comportamento suspeito.

## R

- **REG-NNN** — Identificador de regressão em `SECURITY.md`.
- **Registry** — Objeto único M5.5 que acumula todas as métricas.
  Fonte de verdade.
- **Replacer-function** — Forma de `JSON.stringify` com função
  (não array) para ordenar chaves recursivamente.

## S

- **Shadow mode** — M5.2. Mesma Pipeline, fork output, compara,
  incrementa `shadowDiffs`.
- **SignerAdapter** — Módulo M3.1 que adapta chamadas ao
  protocolo IPC do signer.
- **Signer RPC** — M3.2. Signer isolado em processo próprio.
- **Simulation gate** — Gate H1.2. Simula tx via `eth_call` antes
  de broadcastar.
- **STORE_UNAVAILABLE** — Erro do LeaseStore quando o backend
  (ex.: Redis) está indisponível.
- **shadowDiffs** — Counter incrementado quando shadow path
  diverge do live.

## T

- **Token authority** — Gate H2.3. Verifica mint/freeze/upgrade
  authority.
- **TypeScript strict** — `strict: true` em `tsconfig.json`. Sem
  `any` em produção.

## W

- **Writer lease** — M4. Lease distribuído com fencing tokens.

## Y

- **Yellow flag** — Марcador no `dependencies.md` para "validado
  em M5 — não alterar sem nova entrada em DECISION_LOG.md".

## Números

- **0xcanary** — Prefixo de txHash usado em testes M5.1 para
  forçar bucket canário.
- **30 attack vectors** — Vetores defendidos pelo hardening
  roadmap (detalhes em `HARDENING-ROADMAP.md`).
- **74k ops** — Volume validado no M5.6 Long-Duration (60s, 0
  leak).
- **600 RPC reais** — Volume validado no M5.2 Shadow (BSC
  mainnet, 0 diffs).
