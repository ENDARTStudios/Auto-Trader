# DECISION_LOG.md — Registro de Decisões Arquiteturais

> **Regra:** toda decisão arquitetural relevante deve ser registrada aqui
> com os campos abaixo. Apenas adicionar — nunca remover entradas antigas
> (mesmo que a decisão tenha sido revertida; registre a reversão como
> nova entrada).

---

## Template de entrada

```markdown
### DEC-NNN — <Título curto> (YYYY-MM-DD)

- **Data:** YYYY-MM-DD
- **Motivo:** <por que a decisão foi necessária>
- **Arquivos envolvidos:** <lista de caminhos>
- **Alternativas descartadas:** <lista, com motivo de descarte>
- **Justificativa:** <por que esta foi escolhida>
- **Impacto:** <o que muda no sistema — dependências, contratos, performance, segurança>
- **REG-NNN associados:** <se aplicável, regressões em SECURITY.md>
- **Status:** Ativa | Revertida por DEC-XXX | Depreciada
```

---

## DEC-001 — Audit hash-chain com replacer-array corrigido (H0.3)

- **Data:** 2026-07-XX (fase H0.3)
- **Motivo:** O `JSON.stringify(entry, sortedKeysArray)` (forma replacer-array)
  silenciosamente dropava chaves nested dentro de `payload` do hash. Um
  atacante podia modificar o payload sem quebrar a cadeia.
- **Arquivos envolvidos:** `src/lib/audit/audit-log.ts`
- **Alternativas descartadas:**
  - Hash manual concatenando campos — descartado por ordem não-determinística.
  - `JSON.stringify(entry, sortedReplacerFunction)` — adotado (replacer
    function recursivo que ordena chaves em todos os níveis).
- **Justificativa:** Replacer function recursivo é a única forma de
  garantir determinismo em nested objects sem depender de ordenação
  manual de campos.
- **Impacto:** Toda entrada de audit log passa a ter hash determinístico
  mesmo com nested payload. Hashes antigos NÃO retroagem — entradas
  pré-correção usam versão legada (sem version field).
- **REG-NNN associados:** REG-XXX (audit tamper-detection adversarial).
- **Status:** Ativa.
- **Lição permanente:** Todo primitivo criptográfico deve vir com teste
  adversarial que tenta quebrar a propriedade prometida. Esta lição está
  formalizada em `ENGINEERING_RULES.md` > "Princípio de teste adversarial".

---

## DEC-002 — Signer isolado em processo próprio (M3.2)

- **Data:** fase M3.2.
- **Motivo:** Manter o signer (que manipula chaves privadas) no mesmo
  processo que o trading engine expõe toda a memória do processo a
  qualquer RCE no engine. Isolamento por processo é defesa em profundidade.
- **Arquivos envolvidos:** `src/signer/main.ts`, `src/signer/wallet-methods.ts`,
  `src/signer/sign-methods.ts`, `src/signer/audit.ts`,
  `src/lib/chain/signer-adapter.ts`, `src/lib/signer-protocol.ts`,
  `docs/signer-isolation-design.md`.
- **Alternativas descartadas:**
  - Signer in-process com sandbox `vm` — descartado: vm não é isolamento
    de segurança real.
  - Worker thread — descartado: compartilha heap com thread principal.
  - WASM sandbox — descartado: complexidade alta, sem benefício sobre
    processo separado.
- **Justificativa:** Processo separado com IPC estrito é o padrão
  industry (cf. design de wallets hardware, KMS). Mensagens assinadas
  trafegam por canal dedicado; chave privada nunca sai do processo signer.
- **Impacto:** Adiciona latência de IPC (~1ms round-trip). Engine principal
  nunca carrega a chave privada. Protocolo de comunicação definido em
  `signer-protocol.ts` é contrato frozen.
- **REG-NNN associados:** REG-XXX (signer isolation).
- **Status:** Ativa.

---

## DEC-003 — Writer Lease com fencing tokens Kleppmann (M4)

- **Data:** fase M4.
- **Motivo:** Em cenários de failover/reconnect, múltiplos writers podem
  acreditar ter a lease. Sem fencing tokens, um writer stale pode
  broadcastar tx com nonce já usado — causando double-spend ou stuck tx.
- **Arquivos envolvidos:** `src/lib/chain/writer-lease.ts`,
  `src/lib/chain/leased-broadcaster.ts`.
- **Alternativas descartadas:**
  - Lock distribuído via Redis — descartado: adiciona dependência e SPOF.
  - Eleição Paxos/Raft custom — descartado: complexidade desproporcional.
  - Time-based sem fencing — descartado: não protege contra clock skew.
- **Justificativa:** Padrão Kleppmann ("How to do distributed locking")
  com fencing tokens monotônicos: cada lease acquire recebe um token
  estritamente maior que o anterior. O `LeasedBroadcaster` verifica o
  token ANTES de broadcastar. Writer stale com token antigo é rejeitado
  pelo broadcaster, mesmo que acredite ter a lease.
- **Impacto:**
  - Adiciona 1 verificação de token antes de cada broadcast (~microseconds).
  - `LeaseStore` é interface; `InMemoryLeaseStore` é a implementação
    default (produção pode usar Redis/Postgres backend).
  - Erros classificados: `LEASE_BUSY`/`STORE_UNAVAILABLE` → wrap com
    `LEASE_ACQUIRE_FAILED`; outros → pass-through.
- **REG-NNN associados:** REG-015 (fencing token monotônico),
  REG-016 (lease acquire exclusivo), REG-017 (lease renew após timeout),
  REG-018 (reconnect não reanima lease stale).
- **Status:** Ativa.

---

## DEC-004 — Ordem corrigida das sub-fases M5 (Observability primeiro)

- **Data:** 2026-07-15.
- **Motivo:** Desenvolvimento paralelo de Shadow/Chaos/Observability/
  Long-Duration causaria cada harness implementar sua própria coleta de
  métricas, criando duplicação e divergência.
- **Arquivos envolvidos:** (planejados) `src/lib/observability/{metrics,
  registry, snapshot, exporter}.ts`, `src/lib/runtime/{canary,shadow,
  chaos,long-duration}.ts`, `src/app/api/runtime/status/route.ts`.
- **Alternativas descartadas:**
  - Desenvolvimento paralelo via subagents — descartado: causa duplicação
    de coleta de métricas.
  - Observability depois de Chaos — descartado: chaos precisa de métricas
    para validar resiliência; sem Registry, cada teste chaos reinventa
    contadores.
- **Justificativa:** Observability é fundação. Uma vez que existe um
  Registry único com Histograms/Counters/Gauges e um endpoint
  `/api/runtime/status` read-only, cada harness (chaos, shadow, canary,
  long-duration) consome o mesmo Registry. Testes ficam comparáveis e
  métricas ficam consistentes.
- **Impacto:**
  - Ordem canônica de execução M5: M5.0 ✓ → M5.1 ✓ → **M5.5 Observability**
    → M5.4 Chaos → M5.2 Shadow → M5.3 Canary → M5.6 Long-Duration → M5.7.
  - Arquivos já criados em `src/lib/observability/` e `src/lib/runtime/`
    durante a fase paralela precisam ser **revisados/refatorados** contra
    a especificação corrigida — não necessariamente reescritos do zero.
  - Padrões obrigatórios:
    - **Shadow:** compartilhar a MESMA Pipeline, fork do output para
      Live + Shadow, comparar, incrementar `shadowDiffs`.
    - **Canary:** `bucket = keccak256(txHash) % 100; bucket < canaryPct`
      (determinístico por txHash, não por campos da tx).
    - **Chaos:** ChaosInjector classes independentes com
      `before()/after()/cleanup()` — sem `if (chaos)` espalhado.
    - **Long-Duration:** loop `while (running) { await runtime.tick();
      await sleep(period); }` — não `setInterval`.
- **REG-NNN associados:** (a definir após implementação).
- **Status:** Ativa.

---

## DEC-005 — Prefixo `BROADCAST_*` em erros do signer (correção M5.4)

- **Data:** durante M5.4 (correção de bug em M3.3).
- **Motivo:** `LeasedBroadcaster` classifica erros do Broadcaster
  distinguindo `BROADCAST_*` (pass-through) de `LEASE_*` (wrap com
  `LEASE_ACQUIRE_FAILED`). O `Broadcaster` original emitia erros do
  signer sem prefixo, fazendo o `LeasedBroadcaster` misclassificá-los
  como lease errors.
- **Arquivos envolvidos:** `src/lib/chain/broadcaster.ts`,
  `src/lib/chain/leased-broadcaster.ts`.
- **Alternativas descartadas:**
  - `LeasedBroadcaster` fazer introspecção da mensagem — descartado:
    frágil, baseado em string matching.
  - Adicionar novo tipo de erro — descartado: breaking change no
    contrato público do Broadcaster (viola Regra 9 de CORE_RULES.md).
- **Justificativa:** Prefixar erros do signer com `BROADCAST_SIGNER_*`
  preserva o contrato público (continua string), permite
  `LeasedBroadcaster` classificar corretamente, e é backwards-compatible
  (consumidores que faziam matching por string continuam funcionando se
  atualizarem o prefixo esperado).
- **Impacto:** Mensagens de erro de signer agora começam com
  `BROADCAST_SIGNER_*`. Logs antigos (pré-correção) têm formato antigo;
  não há migração retroativa.
- **REG-NNN associados:** (a adicionar — teste adversarial de
  classificação de erro no LeasedBroadcaster).
- **Status:** Ativa.

---

### [Entradas futuras vêm aqui — nunca sobrescrever acima]
