# architecture/frozen-files.md — Arquivos Congelados

> Lista canônica dos arquivos marcados como **FROZEN**.
> Conforme CORE_RULES Regra 8, só podem receber alterações mediante
> **autorização explícita** do operador + entrada em `DECISION_LOG.md`.
>
> Exceção única: correção de bug que **preserva** o contrato público
> (assinaturas de funções, tipos exportados, formato de mensagens IPC,
> schemas Prisma). Mesmo assim, registrar a correção como nova entrada
> em DECISION_LOG.md e adicionar teste de regressão REG-NNN em
> `SECURITY.md`.

---

## H0 — Crypto Foundation

| Arquivo                          | Motivo do congelamento                                  | Critério para alteração                              |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/audit/audit-log.ts`     | Hash-chain determinística (replacer-function). Bug H0.3 corrigido; REG-NNN adversarial travando o invariant. | Nova entrada DECISION_LOG + novo REG adversarial que tente quebrar a cadeia de novo. |
| `src/lib/trading/kdf.ts`         | KDF versionada para criptografia de chaves.            | Bump de versão KDF + REG de legacy blob decryption. |
| `src/lib/trading/wallet-crypto.ts` | Envelope encryption das chaves privadas.             | Bump de versão + REG de manipulação de ciphertext.  |
| `src/lib/trading/key-rotation.ts` | Rotação de passphrase em todos os blobs.              | REG de wrong-passphrase-fails-ALL-blobs.            |

---

## H1 — RPC/Sim/Approval/MEV

| Arquivo                                    | Motivo do congelamento                                  | Critério para alteração                              |
| ------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/chain/rpc-resilience.ts`          | RPC quorum com detecção de endpoint malicioso. REG-NNN de chain id errado, block stale, balance errado. | Novo vetor de ataque RPC documentado + REG adversarial. |
| `src/lib/chain/simulation-gate.ts`         | Simulação de tx antes de broadcast. REG de revert blocks broadcast. | Mudança no formato `SimulationResult` é breaking change. |
| `src/lib/chain/approval-hardening.ts`      | Rejeita `type(uint256).max`, cap, saldo. REG adversarial de unlimited approval. | Mudança no cap máximo é breaking change.            |
| `src/lib/chain/mev-baseline.ts`            | Baseline anti-MEV.                                     | Novo vetor MEV documentado + REG.                    |

---

## H2 — Contract/Liquidity/TokenAuthority/SellSim

| Arquivo                                          | Motivo do congelamento                                  | Critério para alteração                              |
| ------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/chain/contract-verification.ts`         | Verifica source code via Etherscan/Sourcify.            | Novo padrão de contrato malicioso documentado + REG. |
| `src/lib/chain/liquidity-verification.ts`        | Verifica liquidez real (LP lock, concentração).         | Mudança em `LiquidityReport` é breaking change.      |
| `src/lib/chain/token-authority.ts`               | Verifica mint/freeze/upgrade authority.                 | Mudança em `AuthorityReport` é breaking change.      |
| `src/lib/chain/sell-simulation.ts`               | Simula sell antes de buy (honeypot detection).          | Mudança em `SellResult` é breaking change.           |

---

## H2.6 — Pipeline

| Arquivo                       | Motivo do congelamento                                  | Critério para alteração                              |
| ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/chain/pipeline.ts`   | Composição dos gates H1+H2 em sequência. `PipelineResult` é contrato consumido por `signer-adapter`. | Nova gate H2.7+ com autorização explícita + entrada DECISION_LOG. |

---

## M3 — SignerAdapter / Signer RPC / Broadcaster

| Arquivo                                  | Motivo do congelamento                                  | Critério para alteração                              |
| ---------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/chain/signer-adapter.ts`        | Adaptador IPC. `SignerAdapter`, `SignRequest`, `SignResponse` são contratos. | Mudança no protocolo IPC exige bump + decisão.       |
| `src/lib/signer-protocol.ts`             | Contrato de mensagens IPC entre engine e signer.        | Mudança é breaking change de protocolo.              |
| `src/signer/main.ts`                     | Entrypoint do processo signer isolado.                  | Mudança no lifecycle do processo exige decisão.      |
| `src/signer/wallet-methods.ts`           | Handlers de carteira.                                   | Mudança em método exposto exige decisão.             |
| `src/signer/sign-methods.ts`             | Handlers de assinatura (domain separator).              | Mudança em domain separator invalida assinaturas antigas. |
| `src/signer/audit.ts`                    | Audit log interno do signer (hash-chain).               | Mesmo critério que `audit-log.ts` H0.3.              |
| `src/lib/chain/broadcaster.ts`           | Submete tx ao RPC quorum, classifica erros.             | Mudança em `BroadcastError` prefixos é breaking change (LeasedBroadcaster classifica por prefixo). |

---

## M4 — Writer Lease

| Arquivo                                    | Motivo do congelamento                                  | Critério para alteração                              |
| ------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------- |
| `src/lib/chain/writer-lease.ts`            | Lease distribuído com fencing tokens Kleppmann. REG-015/016/017/018 travam invariants. | Nova implementação de `LeaseStore` (ex.: Redis backend) permitida sem tocar a interface. |
| `src/lib/chain/leased-broadcaster.ts`      | Pre-broadcast fencing check. Classificação de erros.    | Mudança na classificação (que erros são wrap vs pass-through) exige decisão. |

---

## Exceções já aplicadas (histórico)

### M5.4 — `broadcaster.ts` (correção de bug preservando contrato)

- **Motivo:** Signer errors não estavam prefixados com `BROADCAST_*`,
  fazendo `LeasedBroadcaster` misclassificá-los como lease errors.
- **Mudança:** Adicionar prefixo `BROADCAST_SIGNER_*` às mensagens de
  erro do signer no broadcaster.
- **Justificativa de exceção:** Preserva o contrato público (continua
  sendo string; consumidores que faziam matching por string atualizam
  o prefixo esperado). Sem breaking change de tipo ou schema.
- **Registrado em:** `DECISION_LOG.md` > DEC-005.

### Esta é a única exceção aplicada até 2026-07-15.

Toda exceção futura deve seguir o mesmo padrão: documentar em
DECISION_LOG.md, adicionar REG-NNN, validar que o contrato público é
preservado.
