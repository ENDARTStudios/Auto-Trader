# `standards/security.md` — Padrões de Segurança

> **STATE: ACTIVE** — Padrões de segurança — refináveis com novos attack vectors.
> Mudança de estado requer entrada em `memory/implementation-history.md`
> e, se estrutural, novo ADR em `decisions/ADR-NNNN.md`.

> Regras detalhadas de segurança. `CORE_RULES.md` Regra 8
> (arquivos FROZEN) e Regra 9 (compatibilidade) são as leis;
> este arquivo é a referência técnica para implementação.
>
> **IDs canônicos:** STD-201 a STD-209 (ver `MANIFEST.md` para a
> tabela completa de prefixos).

---

## STD-201 — Princípios fundamentais

### STD-201.1 — Defense in depth

Múltiplas camadas de defesa, cada uma assumindo que a anterior
falhou. Padrão adotado em ADR-0001 (ver `decisions/ADR-0001.md`):

```
Camada 1: ScamDetector (rejeita tokens maliciosos)
  ↓ se passar
Camada 2: RiskManager (5 circuit breakers)
  ↓ se passar
Camada 3: Pipeline gates (Sim, Verify, Liquidity, Authority, SellSim, Approval, MEV)
  ↓ se passar
Camada 4: SignerAdapter (IPC isolado, chave nunca sai do processo)
  ↓ se passar
Camada 5: WriterLease (fencing tokens — writer stale rejeitado)
  ↓ se passar
Camada 6: LeasedBroadcaster (verifica token pré-broadcast)
  ↓ se passar
Camada 7: Broadcaster (retry, gas bump, nonce handling)
  ↓ se passar
Camada 8: RPC Quorum (divergência detectada, fallback)
  ↓ se passar
Camada 9: Audit hash-chain (forensics — append-only)
```

Cada falha em uma camada é logada, auditada, e NÃO derruba o sistema
(exceto kill-switch explícito).

### STD-201.2 — Least privilege

- Signer: única camada com acesso à chave privada.
- Engine: nunca carrega chave; pede assinatura via IPC.
- API: endpoints write requerem auth (M6+); read são públicos
  para dashboard local.
- DB: Prisma client com permissões mínimas (sem DROP TABLE em
  produção).

### STD-201.3 — Fail safe

- Em erro desconhecido, falhar para o estado mais conservador.
  Ex.: se SignerAdapter não responde, rejeitar nova tx (não
  enviar tx não-assinada).
- Kill-switch persistente: em panic, ativa kill-switch e para
  engine. Não retoma automaticamente.

---

## STD-202 — Chaves e segredos

### Hierarquia

| Tipo             | Onde armazenado                        | Acessado por           |
| ---------------- | -------------------------------------- | ---------------------- |
| Mnemonic signer  | Vault/KMS (M6+) / env var (dev only)   | Signer processo único  |
| API keys (Binance) | `.env.local` (dev) / Vault (prod)    | Engine                 |
| RPC URLs         | `.env.local` / config DB              | rpc-resilience         |
| DB password      | `.env.local` / Vault                  | Prisma client          |

### STD-202.1 — Regras

- **Nunca** commitar `.env.local` (`.gitignore` inclui).
- **Nunca** logar mnemonic, private key, API key, DB password.
- **Nunca** enviar segredo via query string (vai em access logs).
- **Sempre** usar variáveis de ambiente para segredos; carregar
  via `process.env.SECRET_NAME`.
- **Em produção (M6+):** mnemonic via Vault/KMS, lido pelo signer
  no startup; `process.env.SIGNER_MNEMONIC` é proibido em produção.

### STD-202.2 — Rotação

- **Mnemonic:** rotação anual ou após incidente. Procedimento em
  `docs/key-rotation.md` (a criar em M6).
- **API keys:** rotação trimestral.
- **DB password:** rotação semestral.

---

## STD-203 — Audit log (H0 — INV-005)

### Propriedades

- **Append-only:** entradas nunca são removidas ou editadas.
- **Hash-chain:** cada entrada inclui `prevHash` (hash da entrada
  anterior). Tampering quebra a cadeia.
- **Determinístico:** `JSON.stringify(entry, sortedReplacerFn)`
  (não `sortedKeysArray` — bug H0.3, DEC-001).
- **Versionado:** campo `version: 2` após fix H0.3; entradas
  antigas sem version field são tratadas como v1.

### Queries

- `auditLog.get(seq: number): AuditEntry`
- `auditLog.verifyChain(fromSeq?: number): { ok: boolean; brokenAt?: number }`
- `auditLog.snapshot(sinceHash?: string): AuditEntry[]`

### Testes adversariais

| REG-NNN   | O que testa                                              |
| --------- | -------------------------------------------------------- |
| REG-XXX   | Tampering em `payload` quebra hash-chain                 |
| REG-XXX   | Tampering em `prevHash` quebra chain                     |
| REG-XXX   | Re-order de entradas detectada                           |
| REG-XXX   | Nested object em payload NÃO é dropado (regressão H0.3)  |
| REG-XXX   | Audit exactly-once (INV-005)                             |

---

## STD-204 — Signer isolation (M3.2 — INV-006)

### Propriedades

- Processo Node.js separado do engine.
- Comunicação via IPC binário (`signer-protocol.ts`, FROZEN).
- Chave privada carregada em memória no startup; nunca serializada.
- Audit log interno próprio (`src/signer/audit.ts`).

### Ataques mitigados

| Vetor                                | Mitigação                                            |
| ------------------------------------ | ---------------------------------------------------- |
| RCE no engine → acesso à chave       | Signer em processo separado; RCE no engine não atinge |
| Memory dump do engine                | Engine não tem chave em memória                       |
| Stack trace expõe chave              | Signer nunca loga chave; Error messages sanitizadas  |
| IPC sniffing                         | IPC é stdin/stdout entre parent/child; mesmo host    |
| Fork bomb / signer crash             | Engine detecta EOF, marca unavailable; sem restart auto |
| Mnemonic em argv (visível em `ps`)   | Mnemonic via env var, NÃO argv                        |

### Testes adversariais

| REG-NNN   | O que testa                                              |
| --------- | -------------------------------------------------------- |
| REG-XXX   | Signer nunca loga mnemonic em qualquer nível             |
| REG-XXX   | Signer rejeita SignerRequest com magic inválido          |
| REG-XXX   | Signer rejeita payload > 1MB (DoS)                       |
| REG-XXX   | Signer mantém audit chain após restart                   |
| REG-XXX   | Engine detecta signer crash e marca unavailable          |

---

## STD-205 — Writer Lease (M4 — INV-007)

### Propriedades

- Lease exclusiva: apenas 1 holder ativo por vez.
- Fencing tokens monotônicos crescentes.
- `LeasedBroadcaster` verifica token antes de delegar ao
  `Broadcaster`.
- Em caso de lease roubada (holder B rouba de A), A não consegue
  broadcastar (token de A é menor, rejeitado).

### Ataques mitigados

| Vetor                                | Mitigação                                            |
| ------------------------------------ | ---------------------------------------------------- |
| Writer stale após network partition  | Fencing token rejeitado pelo LeasedBroadcaster       |
| Clock skew entre nodes               | Fencing tokens não dependem de clock (monotonic int)  |
| Race condition em acquire            | LeaseStore com `SELECT FOR UPDATE` (Postgres)         |
| Restart do processo readquire lease  | Token anterior continua válido até TTL expirar        |

### Testes adversariais

| REG-NNN   | O que testa                                              |
| --------- | -------------------------------------------------------- |
| REG-015   | Fence é monotônico crescente                             |
| REG-016   | Lease acquire exclusivo (segundo acquire falha)          |
| REG-017   | Lease renew após timeout falha                           |
| REG-018   | Reconnect não reanima lease stale                        |

---

## STD-206 — RPC quorum (H1.1)

### Propriedades

- Reads: 2+ endpoints concordam no resultado.
- Writes: fallback sequencial (sem quorum — evita double-broadcast).
- Divergência logada mas não derruba engine.

### Ataques mitigados

| Vetor                              | Mitigação                                            |
| ---------------------------------- | ---------------------------------------------------- |
| RPC node malicioso retorna falso   | Quorum exige 2+ concordância                         |
| RPC node cai                        | Fallback para próximo endpoint                       |
| Rate limit (429)                    | Fallback + backoff exponencial                       |
| RPC retornou receipt falso          | Comparar txHash entre múltiplos endpoints            |

---

## STD-207 — Pipeline gates (H1.2, H1.3, H1.4, H2.1-H2.4)

Cada gate é uma camada de defesa independente. Falhar em qualquer
gate aborta a tx com erro classificado.

| Gate                  | Ataque mitigado                                   |
| --------------------- | ------------------------------------------------- |
| Simulation gate (H1.2)| Tx que reverte em simulação (rug pull, front-run) |
| Approval hardening (H1.3) | Approval rug (token rouba tokens via approval) |
| MEV baseline (H1.4)   | Sandwich attack detection                         |
| Contract verify (H2.1)| Token sem source verified (proxy oculto)          |
| Liquidity verify (H2.2)| Liquidity rug pull (low liquidity token)        |
| Token authority (H2.3)| Token não autorizado (scam token)                |
| Sell simulation (H2.4)| Token que não pode ser vendido (honeypot)        |

---

## STD-208 — ScamDetector (camada de trading)

### Sub-scorers

| Sub-scorer      | O que mede                              | Peso |
| --------------- | --------------------------------------- | ---- |
| Honeypot        | Turnover anormal (buy OK, sell reverte) | 25   |
| Liquidity       | Liquidez baixa ou concentrada           | 20   |
| Contract audit  | Source não verified no Etherscan        | 15   |
| Tax             | Buy/sell tax > 5%                       | 15   |
| Holders         | Concentração de holders (top 10 > 50%)  | 15   |
| Age             | Token criado há < 7 dias                | 10   |
| **Total**       |                                         | 100  |

### LLM squad (GLM-4.6)

- 3 prompts diferentes (bullish, bearish, neutral).
- Score final = média dos 3.
- Threshold de rejeição: score > 60 (configurável).

### Thresholds

- **Score 0-30:** aprovar (passa para RiskManager).
- **Score 31-60:** revisar (LLM squad + manual override).
- **Score 61-100:** rejeitar (não passa para RiskManager).

---

## STD-209 — Incident response

### Severity levels

| Sev   | Definição                                  | SLA resposta |
| ----- | ------------------------------------------ | ------------ |
| Sev-1 | Perda de fundos ou chave comprometida      | 15 min       |
| Sev-2 | Sistema down, sem perda de fundos          | 1h           |
| Sev-3 | Degradado, mas funcional                   | 4h           |
| Sev-4 | Bug cosmético ou minor                     | 1 semana     |

### Procedimento

1. **Detectar:** alerta via `/api/runtime/status` ou operador.
2. **Confirmar:** verificar audit log (H0) para confirmar incidente.
3. **Isolar:** kill-switch (`POST /api/kill-switch`) se Sev-1/2.
4. **Investigar:** consultar audit log, AppLog, métricas.
5. **Corrigir:** aplicar fix seguindo fluxo normal de
   `ENGINEERING_RULES.md`.
6. **Postmortem:** registrar em `memory/known-problems.md` (KP-NNN)
   e, se aplicável, `DECISION_LOG.md` (DEC-NNN) + ADR.
7. **Reabrir:** remover kill-switch após validação.

### Toda correção de Sev-1/2 DEVE produzir

- Entrada em `memory/known-problems.md` (KP-NNN).
- Teste adversarial REG-NNN em `SECURITY.md` (raiz do projeto).
- Postmortem em `memory/implementation-history.md` (entrada datada).
- Se revelar falha de arquitetura: ADR em `decisions/`.

---

## Relacionado

- `CORE_RULES.md` Regra 8 (FROZEN) e Regra 9 (compatibilidade) — leis de segurança.
- `ENGINEERING_RULES.md` > Princípio de teste adversarial — base para REG-NNN.
- `standards/testing.md` (STD-101+) — padrões para os testes adversariais.
- `architecture/invariants.md` INV-001 a INV-010 — invariantes de segurança.
- `architecture/frozen-files.md` — lista de arquivos cuja alteração exige ADR.
- `architecture/interfaces.md` — contratos cripto/segurança (SignerSink, WriterLease, etc.).
- `contracts/rpc.md` — protocolo IPC do signer (FROZEN).
- `DECISION_LOG.md` DEC-001 (audit), DEC-002 (signer isolation), DEC-003 (writer lease) — decisões de segurança.
- `decisions/ADR-0001.md` — arquitetura defense-in-depth canônica.
- `SECURITY.md` (raiz do projeto) — REG-NNN adversariais canônicos.
- `HARDENING-ROADMAP.md` (raiz do projeto) — mapeamento de 30 attack vectors.
- `memory/known-problems.md` KP-001 a KP-011 — incidentes passados.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.
