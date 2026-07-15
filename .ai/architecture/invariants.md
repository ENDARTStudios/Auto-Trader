# `architecture/invariants.md` — Garantias Arquiteturais

> Invariantes são **regras que raramente mudam** e servem como
> garantias arquiteturais. Diferem de `CORE_RULES.md` (que são regras
> de processo) e de `frozen-files.md` (que é lista de arquivos
> imutáveis). Invariantes são **propriedades do sistema** que devem
> ser verdadeiras em todos os momentos, sob todas as cargas.
>
> Toda alteração que quebra um invariante DEVE produzir ADR em
> `decisions/` e entrada em `DECISION_LOG.md` com justificativa
> estrutural.

---

## INV-001 — Pipeline sempre executa H0 → H1 → H2 → M3 → M4

A ordem das fases do hardening roadmap é canônica:

```
H0 (audit) → H1 (RPC/Sim/Approval/MEV) → H2 (Contract/Liquidity/
TokenAuthority/SellSim) → H2.6 (Pipeline composição) → M3.1
(SignerAdapter) → M3.2 (Signer RPC isolado) → M3.3 (Broadcaster)
→ M4 (Writer Lease + LeasedBroadcaster)
```

**Invariante:** o Pipeline NUNCA pula etapas. Em runtime, a
composição é:

```
Sim Gate → Contract Verify → Liquidity Verify → Token Authority
  → Sell Sim → Approval → MEV → SignerAdapter → WriterLease
  → LeasedBroadcaster → RPC Quorum
```

Qualquer falha em qualquer etapa aborta o resto da pipeline
(com classificação de erro prefixada — DEC-005). Não há "skip
por configuração" em produção; apenas em testes com harness
específico.

**Teste adversarial:** REG-XXX (pipeline skip attempt).

---

## INV-002 — Broadcaster nunca altera payload assinado

O Broadcaster (M3.3) recebe `signedTx: string` e envia para o
RPC quorum. Ele PODE:

- Aumentar gas price (gas bumping, até `gasBumpBps` limite).
- Retentar com nonce corrigido (após gap detection).
- Fazer fallback entre RPCs (quorum).

Ele NUNCA pode:

- Decodificar e re-codificar a tx (would invalidate signature).
- Substituir o `from` (would be impersonation).
- Substituir o `to` (would be re-routing attacker funds).
- Modificar `data` ou `value` (would change semantics).
- Re-assinar com outra chave (would violate SignerAdapter contract).

**Implementação:** `Broadcaster.broadcast(signedTx, opts)` recebe
apenas string serializada; não tem acesso ao objeto `TransactionRequest`
original que o signer usou.

**Teste adversarial:** REG-XXX (broadcaster tamper attempt).

---

## INV-003 — Arquivos FROZEN não podem ser modificados sem ADR

A lista canônica de arquivos FROZEN está em `frozen-files.md`.
Qualquer alteração em arquivo FROZEN requer:

1. ADR novo em `decisions/ADR-NNNN.md` justificando a mudança.
2. Entrada em `DECISION_LOG.md` (DEC-NNN) com referência ao ADR.
3. Aprovação explícita do operador registrada no ADR.
4. Atualização de `frozen-files.md` (remoção ou note de exceção).

**Exceções permitidas (sem ADR):**

- Correção de bug que **preserva** o contrato público (Regra 9
  CORE_RULES.md) — ainda assim, registrar entrada em
  `DECISION_LOG.md`.
- Atualização de comentários ou JSDoc que não altera comportamento.

---

## INV-004 — Todo erro deve preservar o motivo original

Quando um módulo wrappa o erro de outro módulo, o `cause` original
DEVE ser preservado:

```typescript
// ✅ Correto
throw new PipelineError('SIM_REJECT', 'simulation reverted', { cause: originalError });

// ❌ Proibido — perde o stack trace original
throw new PipelineError('SIM_REJECT', 'simulation reverted');

// ❌ Proibido — string matching quebrado
throw new Error('pipeline failed: ' + originalError.message);
```

**Motivo:** diagnóstico de incidente depende de poder rastrear a
causa raiz através das camadas. Sem `cause`, um erro `LEASE_ACQUIRE_FAILED`
pode esconder a verdadeira causa (ex.: `STORE_UNAVAILABLE` em Redis).

**Aplicação:** válido para todos os módulos da camada de chain.
O `LeasedBroadcaster` em particular DEVE preservar o cause quando
wrappa erros do `Broadcaster` ou do `WriterLease`.

---

## INV-005 — Audit é exatamente uma vez

Toda operação sensível gera **exatamente uma** entrada no audit log.
Não zero (silencioso). Não múltiplas (duplicação).

| Operação                 | Entradas esperadas                                |
| ------------------------ | ------------------------------------------------- |
| `Pipeline.process()`     | 1× `PIPELINE_START` + 1× `PIPELINE_RESULT`        |
| `SignerAdapter.submit()` | 1× `SIGN_REQUEST` + 1× `SIGN_RESPONSE`            |
| `WriterLease.acquire()`  | 1× `LEASE_ACQUIRE` (sucesso) ou 0 (falha)         |
| `Broadcaster.broadcast()`| 1× `BROADCAST_ATTEMPT` por tentativa + 1× `BROADCAST_RESULT` |
| `ChaosInjector.inject()` | 1× `CHAOS_INJECT`                                  |
| `ShadowHarness.diff()`   | 1× `SHADOW_DIFF` por divergência detectada         |

**Implementação:** a entrada de audit é gravada ANTES do return
do método, em bloco `finally` quando aplicável. Se a gravação falhar,
a operação DEVE falhar (não silenciar) — melhor não fazer que
fazer sem rastro.

**Teste adversarial:** REG-XXX (audit dedup attempt), REG-XXX
(audit silent failure attempt).

---

## INV-006 — Signer nunca expõe chave privada

O processo signer (M3.2) segura a chave privada. Esta chave NUNCA:

- Sai do processo signer via IPC, stdout, stderr ou arquivo.
- É logada em qualquer nível (debug, info, error).
- Aparece em stack traces ou error messages.
- É serializada em JSON, BSON ou qualquer formato.

O signer expõe apenas:

- `signerPubkey` (chave pública derivada) — para verificação.
- `signature` (resultado de `personal_sign`, `eth_signTypedData_v4`,
  etc.) — para inclusão na tx.
- `auditHash` (hash da entrada de audit interna) — para correlação.

**Implementação:** o tipo `KeyMaterial` em `src/signer/wallet-methods.ts`
não tem método `toString()`, `toJSON()`, ou accessor público do
private key. Acesso é restrito ao método `sign()` interno.

**Teste adversarial:** REG-XXX (signer leak attempt via IPC, via
toString, via JSON.stringify).

---

## INV-007 — WriterLease fencing token é monotônico crescente

O `LeaseToken.fence` é um inteiro estritamente crescente a cada
`acquire()` bem-sucedido. Jamais:

- Decresce entre leases consecutivas.
- Repete valor (mesmo após restart do processo).
- É reutilizado após `release()`.

**Implementação:** o `LeaseStore` (interface) persiste o último
fence emitido. `InMemoryLeaseStore` mantém em variável de módulo;
produção deve usar `PostgresLeaseStore` ou `RedisLeaseStore` com
`SELECT ... FOR UPDATE` para atomicidade.

**Motivo:** em cenário de failover, writer stale pode acreditar
ter a lease (clock skew, network partition). O fencing token
permite que o `LeasedBroadcaster` rejeite a tx mesmo sem saber
quem é o writer atual.

**Teste adversarial:** REG-015 (fence monotônico), REG-016
(exclusividade), REG-017 (renew), REG-018 (reconnect não
reanima lease stale).

---

## INV-008 — Canary bucketing é determinístico por txHash

O `bucket = keccak256(txHash) % 100` é determinístico: a mesma
txHash sempre cai no mesmo bucket, independente de:

- Quando a tx é processada.
- Qual instância do runtime está rodando.
- Qual RPC endpoint respondeu primeiro.

**Implicação:** uma vez que uma tx cai no bucket canary
(`bucket < canaryPct`), ela PERMANECE no canary mesmo se o
operador muda `canaryPct` depois. Não há re-bucketing retroativo.

**Motivo:** se o bucket fosse não-determinístico (ex.: aleatório
por tick), uma tx could ser roteada para Live em um tick e para
Shadow em outro, mascarando regressões. Determinismo garante
reprodutibilidade de incidentes.

**Implementação:** `CanaryBroadcaster` em `src/lib/runtime/canary.ts`
computa o bucket ANTES de consultar `canaryPct`. Não há cache —
o cálculo é barato (keccak256 + mod).

---

## INV-009 — Shadow compartilha a MESMA Pipeline

O Shadow harness (M5.2) NÃO tem pipeline própria. Ele reutiliza
a MESMA instância de `Pipeline` que o Live path usa, mas forka
o output:

```
Pipeline.process(input)
  ├── output.live    → LeasedBroadcaster → Blockchain (Live)
  └── output.shadow  → LeasedBroadcaster (com RPC mock) → Shadow diff
```

**Motivo:** se a Pipeline fosse duplicada, qualquer divergência
poderia ser atribuída a "implementação diferente" em vez de bug.
Compartilhar a Pipeline garante que a única diferença é o destino
do output.

**Teste adversarial:** REG-XXX (shadow pipeline divergence
detection). 600 RPC reais BSC mainnet com 0 diffs validaram
este invariante em M5.2.

---

## INV-010 — Observability Registry é singleton injetado

Existe exatamente **um** Registry por processo runtime. Ele é:

- Criado por `buildRuntime()` (M5.0).
- Injetado em todos os harnesses (Chaos, Shadow, Canary, Long-Duration).
- Acessível read-only via `/api/runtime/status`.

**Proibido:**

- Criar Registry adicional em harness ou módulo (viola DEC-004).
- Acessar o Registry via global/singleton pattern (use injeção).
- Mutar métricas diretamente sem passar pela interface
  (`Counter.inc()`, `Gauge.set()`, etc.).

**Motivo:** se cada harness tivesse seu próprio coletor, métricas
seriam incomparáveis entre harnesses. Com Registry único, o
operador pode comparar latência de broadcast no Chaos vs. no
Shadow vs. no Long-Duration diretamente.

---

## Manutenção desta lista

- Toda adição de invariante DEVE vir acompanhada de:
  - Teste adversarial REG-NNN em `SECURITY.md`.
  - Entrada em `DECISION_LOG.md` referenciando o novo INV-NNN.
- Toda remoção/deprecação de invariante DEVE produzir ADR
  justificando a mudança estrutural.
- Invariantes não são "best practices" — são garantias. Quebrar
  uma é incidente de segurança, não dívida técnica.

---

## Relacionado

- `architecture/interfaces.md` — contratos públicos que implementam os invariantes.
- `architecture/frozen-files.md` — arquivos cuja alteração exigiria quebrar um invariante.
- `standards/security.md` STD-203 a STD-205 — implementação técnica dos invariantes.
- `standards/testing.md` STD-102 — testes adversariais validam cada invariante.
- `DECISION_LOG.md` DEC-001 a DEC-005 — decisões que estabeleceram invariantes.
- `decisions/ADR-0001.md` — arquitetura cujos invariantes são garantidos por H0–M5.
- `SECURITY.md` (raiz do projeto) — REG-NNN adversariais que testam os invariantes.
- `memory/known-problems.md` KP-001 a KP-011 — bugs que expuseram invariantes.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

