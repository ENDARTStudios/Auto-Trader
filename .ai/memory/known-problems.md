# memory/known-problems.md — Problemas Conhecidos

> Problemas conhecidos, causa, status, mitigação. Append-only.
> Para bugs que viraram aprendizado arquitectural ver
> `DECISION_LOG.md`.
> Para bugs em aberto que NÃO foram corrigidos ver
> `technical-debt.md`.

---

## Resolvidos (registramos para não repetir)

### KP-001 — Hash-chain com replacer-array dropava nested keys

- **Causa:** `JSON.stringify(entry, sortedKeysArray)` (forma
  replacer-array) silenciosamente dropava chaves dentro de `payload`
  que não estavam no array de chaves permitidas.
- **Status:** ✅ Resolvido em H0.3.
- **Mitigação:** Trocado para `JSON.stringify(entry,
  sortedReplacerFunction)` (replacer-function recursivo que ordena
  chaves em todos os níveis).
- **Aprendizado:** Registrado em `DECISION_LOG.md` DEC-001. Todo
  primitivo criptográfico deve ter teste adversarial. Padrão
  formalizado em `ENGINEERING_RULES.md > Princípio de teste
  adversarial`.

### KP-002 — Signer errors não prefixados causavam misclassificação

- **Causa:** `Broadcaster` (M3.3) emitia erros do signer sem
  prefixo. `LeasedBroadcaster` (M4) classifica erros distinguindo
  `BROADCAST_*` (pass-through) de `LEASE_*` (wrap com
  `LEASE_ACQUIRE_FAILED`). Sem prefixo, erros de signer caíam no
  path de wrap errado.
- **Status:** ✅ Resolvido durante M5.4.
- **Mitigação:** Prefixo `BROADCAST_SIGNER_*` adicionado às
  mensagens de erro do signer no broadcaster. Preserva contrato
  público (continua string).
- **Aprendizado:** Registrado em `DECISION_LOG.md` DEC-005. Erros
  de subsistema devem ter prefixo que permita classificação sem
  introspecção de mensagem.

### KP-003 — `process.hostname` não existe em TypeScript

- **Causa:** Durante M4, `generateOwnerId()` usava
  `process.hostname` que não existe na tipagem do Node.js.
- **Status:** ✅ Resolvido em M4.
- **Mitigação:** Trocado para `import { hostname as osHostname }
  from "os"; osHostname()`.
- **Aprendizado:** Validar tipos contra `@types/node` antes de
  usar APIs de Node.

### KP-004 — `SimulationResult` shape errado em mock M5.1

- **Causa:** Mock `HappySimulator` retornava `SimulationResult`
  com `changes` nested em `diff`. Tipo real tem `changes` direto.
- **Status:** ✅ Resolvido em M5.1.
- **Mitigação:** Ajustado return shape do mock.
- **Aprendizado:** Ao criar mock de tipo exportado, copiar a
  interface exata do arquivo fonte; não recriar de memória.

### KP-005 — CanaryBroadcaster txHash com espaço

- **Causa:** Durante M5.1, txHash de teste tinha um espaço
  (`"0xc Canary_skip_"`) que quebrava o bucketing.
- **Status:** ✅ Resolvido em M5.1.
- **Mitigação:** Trocado para `"0xcanary" + zeros` sem espaços.
- **Aprendizado:** TxHash é hex string; qualquer caractere não-hex
  é suspeito.

### KP-006 — Lease concurrent test esperava 10/10 success

- **Causa:** Teste M5.1 B.4 esperava que 10 acquires concorrentes
  todos succeedessem. Lease corretamente retorna `LEASE_BUSY` para
  9 deles (apenas 1 owner por vez).
- **Status:** ✅ Resolvido em M5.1.
- **Mitigação:** Expectation ajustada: 1 win, 9 fail com
  `LEASE_ACQUIRE_FAILED`.
- **Aprendizado:** Testes de concorrência devem modelar a
  semântica do primitivo, não a expectativa ingênua.

---

## Em observação (monitorar)

### KP-007 — `src/lib/chain/runtime.ts` vs `src/lib/runtime/runtime.ts`

- **Causa:** M5.0 criou factory em `src/lib/chain/runtime.ts`.
  Expansão M5 previa mover para `src/lib/runtime/runtime.ts`.
  Ambos parecem existir; possível duplicação.
- **Status:** 🟡 Em observação.
- **Mitigação atual:** Nenhuma — verificar se são o mesmo arquivo
  (re-export) ou duplicação real. Se duplicação, consolidar em
  `src/lib/runtime/runtime.ts` e deixar `chain/runtime.ts` como
  re-export para compatibilidade.
- **Ação recomendada:** Antes do M6, rodar `diff` entre os dois.
  Se duplicação, criar entrada em `DECISION_LOG.md` e consolidar.

### KP-008 — Live trading é stub

- **Causa:** M3.3 Broadcaster submete ao RPC quorum, mas a
  chave privada do signer é stub em paper mode.
- **Status:** 🟡 Em observação. Por design até M6.
- **Mitigação atual:** Paper mode default; live só via M6 canary
  ramp com Vault/KMS.
- **Ação recomendada:** Antes do M6, integrar Vault/KMS em
  `src/signer/main.ts`.

### KP-009 — SQLite em produção

- **Causa:** Banco default é SQLite (`prisma/dev.db`). SQLite tem
  locks globais que podem bloquear sob concorrência.
- **Status:** 🟡 Em observação. Aceitável para paper mode; risco
  em live mode.
- **Mitigação atual:** Nenhuma.
- **Ação recomendada:** Antes do M6, avaliar migração para
  Postgres. Schema Prisma é compatível.

---

## Riscos operacionais

### KP-010 — API keys em variáveis de ambiente

- **Causa:** Etherscan, GoPlus, Binance, CoinGecko usam API keys
  via `process.env`. Sem key, fallback para free tier (rate-limited).
- **Status:** 🟢 Aceitável.
- **Mitigação atual:** Documentar necessidade de keys em
  deployment. Sem key, sistema funciona mas é mais lento.

### KP-011 — Caddy proxy configuration

- **Causa:** `Caddyfile` define proxy externo para `:3000`. Se
  Caddy cai, dashboard fica inacessível externamente.
- **Status:** 🟢 Aceitável.
- **Mitigação atual:** Caddy é robusto. Em caso de queda, restart
  automático via systemd.

---

### [Entradas futuras vêm aqui — nunca sobrescrever acima]

---

## Relacionado

- `memory/technical-debt.md` TD-NNN — bugs em aberto viram débito.
- `DECISION_LOG.md` DEC-001 (KP-001), DEC-005 (KP-002) — decisões originadas destes bugs.
- `standards/security.md` STD-203, STD-205 — padrões derivados destes incidentes.
- `SECURITY.md` (raiz do projeto) REG-NNN — testes adversariais que pinnam as correções.
- `memory/implementation-history.md` — quando cada KP foi registrado.
- `CORE_RULES.md` Regra 11 — todo bug deve produzir aprendizado.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

