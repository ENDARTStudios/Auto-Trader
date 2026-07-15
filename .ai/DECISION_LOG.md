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

## DEC-006 — Project OS v2.1: MANIFEST, CHECKLIST, IDs canônicos, snapshot puro (2026-07-16)

- **Data:** 2026-07-16.
- **Motivo:** v2 do Project OS tinha três problemas estruturais:
  (1) `PROJECT_STATE.md` misturava snapshot com roadmap/decisões/
  histórico apesar de declarar "snapshot puro"; (2) `README.md`
  explicava regras em vez de apenas apontar onde cada informação
  fica, duplicando `CORE_RULES.md` e `INDEX.md`; (3) sem IDs
  canônicos por categoria, cross-links eram frágeis (baseados em
  nome de arquivo). Sem manifesto ou checklist operacional, o
  diretório corria risco de crescimento desordenado.
- **Arquivos envolvidos:**
  - **Criados:** `.ai/MANIFEST.md`, `.ai/CHECKLIST.md`,
    `.ai/decisions/ADR-0002.md`.
  - **Reescritos:** `.ai/README.md` (índice puro, ~70 linhas),
    `.ai/PROJECT_STATE.md` (snapshot puro sem roadmap/decisões/
    histórico), `.ai/INDEX.md` (adicionada seção MANIFEST &
    NAVIGATION, regra de IDs canônicos, regra de cross-links).
  - **Renomeados:** `contracts/api-contracts.md` → `contracts/api.md`,
    `contracts/database-contracts.md` → `contracts/database.md`,
    `contracts/rpc-contracts.md` → `contracts/rpc.md`,
    `contracts/event-contracts.md` → `contracts/events.md`.
  - **IDs STD-NNN adicionados:** `standards/coding-style.md`
    (STD-001 a STD-009.4), `standards/testing.md` (STD-101 a
    STD-107), `standards/security.md` (STD-201 a STD-209),
    `standards/documentation.md` (STD-301 a STD-307),
    `standards/git-workflow.md` (STD-401 a STD-408).
  - **Seção `## Relacionado` adicionada:** todos os arquivos em
    `architecture/`, `contracts/`, `standards/`, `memory/`,
    3 arquivos em `context/` (terminology, conventions, glossary),
    e `decisions/ADR-0001.md`.
- **Alternativas descartadas:**
  - Manter v2 sem mudanças — descartado: problemas estruturais
    não se resolvem sozinhos.
  - Apenas IDs e cross-links, sem MANIFEST/CHECKLIST — descartado:
    resolve consistência mas não resolve crescimento desordenado.
  - Consolidar README + INDEX em um arquivo — descartado:
    audiências diferentes (humano casual vs humano profundo +
    máquina).
  - SemVer (v2.1.0) em vez de v2.1 — descartado: SemVer é para
    código com breaking/feature/fix bem definidos; Project OS é
    governança qualitativa.
- **Justificativa:** v2.1 fecha as lacunas estruturais de v2 com
  mudanças incrementais e backwards-compatible. Não altera a
  arquitetura do projeto (H0–M5), apenas a governança do `.ai/`.
  IDs canônicos por categoria permitem cross-links sem
  ambiguidade. MANIFEST declara princípios; CHECKLIST operacionaliza
  o fluxo; README puro e PROJECT_STATE puro reduzem duplicação.
  Versionamento do Project OS permite que agentes detectem versão
  obsoleta da governança.
- **Impacto:**
  - `PROJECT_STATE.md` agora declara `Project OS: v2.1`.
  - Toda mudança estrutural futura em `.ai/` bumpa a versão e
    produz ADR + entrada em `DECISION_LOG.md` + entrada em
    `implementation-history.md`.
  - IDs STD-NNN numerados por bloco (coding=001+, testing=101+,
    security=201+, docs=301+, git=401+) para evitar colisão entre
    categorias.
  - Prefixo `FI-NNN` formalizado para ideias futuras
    (em `memory/future-ideas.md`).
  - Renomeação de `contracts/*-contracts.md` para `contracts/*.md`
    quebra eventuais links externos (mas v2 foi criado em
    2026-07-15, 1 dia antes — nenhuma referência externa
    consolidada ainda existe).
- **REG-NNN associados:** (não aplicável — mudança de governança,
  não de segurança).
- **Status:** Ativa.
- **Lição permanente:** Toda camada de governança precisa de
  (a) manifesto declarando princípios, (b) checklist operacional,
  (c) IDs canônicos por categoria, (d) cross-links obrigatórios,
  (e) versionamento explícito da própria governança. Sem estes
  5 elementos, governança tende a crescer desordenada e gerar
  duplicação. Formalizado em `MANIFEST.md`.

---

### [Entradas futuras vêm aqui — nunca sobrescrever acima]
