# `architecture/frozen-files.md` — Lista Canônica de Arquivos FROZEN

> **STATE: ACTIVE** — Lista canônica — transições FROZEN↔ACTIVE registradas em DEC-NNN.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Arquivos FROZEN são imutáveis por padrão (Regra 8 de
> `CORE_RULES.md`). Qualquer alteração requer ADR + entrada em
> `DECISION_LOG.md` + aprovação explícita do operador.
>
> Exceção: correção de bug que **preserva** o contrato público
> (Regra 9 e Regra 10 de `CORE_RULES.md`) — mesmo assim, registrar
> entrada em `DECISION_LOG.md` antes do merge.

---

## Camada de Audit (H0)

| Arquivo                          | Módulo           | Congelado em | ADR/DEC                |
| -------------------------------- | ---------------- | ------------ | ---------------------- |
| `src/lib/audit/audit-log.ts`     | Audit hash-chain | H0.3         | DEC-001 (hash-chain fix)|

**Por que FROZEN:** o audit log é a fonte de verdade para
forensics. Qualquer alteração no hash algorithm ou schema de
entrada invalida a cadeia histórica e é breaking change para
qualquer consumer que faz verificação de integridade.

---

## Camada de Chain — hardening H1 (RPC/Sim/Approval/MEV)

| Arquivo                                      | Módulo                | Congelado em |
| -------------------------------------------- | --------------------- | ------------ |
| `src/lib/chain/rpc-resilience.ts`            | RPC quorum            | H1.1         |
| `src/lib/chain/simulation-gate.ts`           | Simulation gate       | H1.2         |
| `src/lib/chain/approval-hardening.ts`        | Approval hardening    | H1.3         |
| `src/lib/chain/mev-baseline.ts`              | MEV baseline          | H1.4         |

**Por que FROZEN:** estes módulos implementam gates de segurança
que protegem contra vectors canônicos (revert em simulação,
approval rug, sandwich MEV). Modificações podem introduzir bypass
silencioso. Toda mudança DEVE vir com teste adversarial REG-NNN.

---

## Camada de Chain — hardening H2 (Contract/Liquidity/TokenAuthority/SellSim)

| Arquivo                                      | Módulo                | Congelado em |
| -------------------------------------------- | --------------------- | ------------ |
| `src/lib/chain/contract-verification.ts`     | Contract verification | H2.1         |
| `src/lib/chain/liquidity-verification.ts`    | Liquidity verification| H2.2         |
| `src/lib/chain/token-authority.ts`           | Token authority       | H2.3         |
| `src/lib/chain/sell-simulation.ts`           | Sell simulation       | H2.4         |

---

## Camada de Chain — hardening H2.6 (Pipeline composição)

| Arquivo                          | Módulo   | Congelado em |
| -------------------------------- | -------- | ------------ |
| `src/lib/chain/pipeline.ts`      | Pipeline | H2.6         |

**Por que FROZEN:** a Pipeline é o orchestrador que define a ordem
canônica dos gates. Modificar a ordem quebra o invariante INV-001
(`architecture/invariants.md`). Adicionar novo gate DEVE seguir
o pattern de composição existente.

---

## Camada de Chain — M3 (SignerAdapter, Signer RPC, Broadcaster)

| Arquivo                                      | Módulo                | Congelado em | ADR/DEC    |
| -------------------------------------------- | --------------------- | ------------ | ---------- |
| `src/lib/chain/signer-adapter.ts`            | SignerAdapter         | M3.1         | DEC-002    |
| `src/lib/signer-protocol.ts`                 | Signer IPC protocol   | M3.1         | DEC-002    |
| `src/signer/main.ts`                         | Signer processo entry | M3.2         | DEC-002    |
| `src/signer/wallet-methods.ts`               | Signer wallet ops     | M3.2         | DEC-002    |
| `src/signer/sign-methods.ts`                 | Signer signing ops    | M3.2         | DEC-002    |
| `src/signer/audit.ts`                        | Signer audit interno  | M3.2         | DEC-002    |
| `src/lib/chain/broadcaster.ts`               | Broadcaster           | M3.3         | DEC-005    |

**Por que FROZEN:** o signer é o ativo mais sensível do sistema
(segura chave privada). O protocolo IPC é contrato rígido entre
dois processos — qualquer mudança quebra compatibilidade binária.
O Broadcaster tem classificação de erro prefixada (DEC-005) que
o `LeasedBroadcaster` depende.

---

## Camada de Chain — M4 (Writer Lease + LeasedBroadcaster)

| Arquivo                                      | Módulo                | Congelado em | ADR/DEC        |
| -------------------------------------------- | --------------------- | ------------ | -------------- |
| `src/lib/chain/writer-lease.ts`              | Writer Lease          | M4           | DEC-003        |
| `src/lib/chain/leased-broadcaster.ts`        | LeasedBroadcaster     | M4           | DEC-003        |

**REG-NNN associados:** REG-015 (fence monotônico), REG-016
(exclusividade), REG-017 (renew), REG-018 (reconnect não reanima
lease stale).

**Por que FROZEN:** o fencing token é a garantia de que um writer
stale não pode broadcastar tx com nonce já usado. Modificar o
algoritmo de fence ou a verificação no LeasedBroadcaster pode
reabrir vector de double-spend em failover.

---

## Arquivos `.ai/` FROZEN (governança)

Os seguintes arquivos de governança também são append-only /
imutáveis por padrão:

| Arquivo                          | Regra                                                |
| -------------------------------- | ---------------------------------------------------- |
| `.ai/CORE_RULES.md`              | Adição de nova regra ok; remoção requer ADR.         |
| `.ai/DECISION_LOG.md`            | Append-only. Reversão = nova entrada DEC-NNN.        |
| `.ai/decisions/ADR-*.md`         | Append-only. Depreciação = novo ADR-NNNN.            |
| `.ai/memory/implementation-history.md` | Append-only. Nunca apagar entradas antigas.     |
| `.ai/memory/known-problems.md`   | Append-only. KP resolvido ganha nota, não é removido.|
| `worklog.md`                     | Append-only multi-agente. Nunca editar entradas antigas.|

---

## Procedimento para descongelar um arquivo

Se um arquivo precisa ser modificado de forma que quebra o contrato
público (não é só correção de bug preservando contrato):

1. **Criar ADR** em `decisions/ADR-NNNN.md` com:
   - Contexto: por que o arquivo está FROZEN atualmente.
   - Decision: qual mudança específica é proposta.
   - Consequences: o que muda no sistema, breaking changes,
     migração necessária.
2. **Registrar em `DECISION_LOG.md`** com referência ao ADR.
3. **Aprovação explícita do operador** registrada no ADR (nome,
   data, contexto da decisão).
4. **Atualizar este arquivo** (`frozen-files.md`):
   - Remover o arquivo da tabela FROZEN, OU
   - Adicionar nota de exceção (ex.: "FROZEN exceto para a mudança
     descrita no ADR-0007, válida até 2026-12-31").
5. **Atualizar `architecture/modules.md`** para refletir novo status.
6. **Implementar a mudança** seguindo o fluxo normal de
   `ENGINEERING_RULES.md`.
7. **Validar** com testes adversariais REG-NNN que pinam o novo
   comportamento.

Pular qualquer etapa viola `CORE_RULES.md` Regra 8.

---

## Procedimento para adicionar novo arquivo FROZEN

Quando um módulo atinge maturidade de produção e não deve mais ser
modificado livremente:

1. Confirmar que o módulo tem teste adversarial REG-NNN cobrindo
   suas propriedades críticas.
2. Criar entrada em `DECISION_LOG.md` (DEC-NNN) justificando o
   congelamento.
3. Adicionar à tabela correspondente acima (audit / H1 / H2 / etc.).
4. Atualizar `architecture/modules.md` (coluna FROZEN: ❌ → ✅).
5. Atualizar `PROJECT_STATE.md` se for mudança de estado significativa.

---

## Relacionado

- `architecture/modules.md` — lista de módulos (coluna FROZEN).
- `architecture/invariants.md` INV-003 — FROZEN não pode mudar sem ADR.
- `CORE_RULES.md` Regra 8 — lei que define FROZEN.
- `ENGINEERING_RULES.md` > Restrições — não mover/renomear módulos FROZEN.
- `DECISION_LOG.md` — toda entrada de congelamento fica registrada aqui.
- `PROJECT_STATE.md` — snapshot com tabela de módulos FROZEN.
- `decisions/ADR-0001.md` — justificativa arquitetural do conjunto H0–M5 FROZEN.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

