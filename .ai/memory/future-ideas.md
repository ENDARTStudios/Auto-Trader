# memory/future-ideas.md — Ideias Futuras

> Ideias futuras registradas para consideração. **Não implementar
> automaticamente.** Apenas registrar. Quando uma ideia for
> promovida a milestone, criar entrada em
> `architecture/roadmap.md > Próximos milestones`.

---

## M6 — Live Trading (canaryPct ramp) — já proposto em roadmap

Ver `architecture/roadmap.md > Próximos milestones > M6`.

## M7 — Multi-chain (já proposto em roadmap)

Ver `architecture/roadmap.md > Próximos milestones > M7`.

## M8 — Observer dashboard (já proposto em roadmap)

Ver `architecture/roadmap.md > Próximos milestones > M8`.

---

## Ideias não promovidas a milestone

### FI-001 — Vault/KMS para chave privada do signer

- **Descrição:** Integrar HashiCorp Vault ou AWS KMS em
  `src/signer/main.ts` para carregar chave privada em runtime sem
  persistir em disco.
- **Caso de uso:** Pré-requisito do M6 Live Trading.
- **Pré-requisitos:** Definir `KeyProvider` interface com impls
  `VaultKeyProvider`, `KmsKeyProvider`, `StubKeyProvider` (para
  paper mode).
- **Riscos:** Adiciona dependência operacional (Vault/KMS precisa
  estar disponível). Mitigação: fallback para StubKeyProvider em
  paper mode.
- **Status:** Pré-requisito do M6. Ver TD-002 em
  `technical-debt.md`.

### FI-002 — WebSocket streaming para dashboard

- **Descrição:** Substituir SSE (`/api/stream`) por WebSocket
  para dashboard em tempo real. Reduzir latência de updates.
- **Caso de uso:** Dashboard com >1000 updates/segundo em live
  mode.
- **Pré-requisitos:** Avaliar se Next.js 16 suporta WS nativamente
  ou se precisa de servidor separado.
- **Riscos:** Complexidade de infraestrutura. SSE é mais simples.
- **Status:** Avaliar quando M6 começar e volume real for conhecido.

### FI-003 — Replay de rounds para debugging

- **Descrição:** Gravar estado completo (market data + gates +
  signer input/output + broadcast + receipt) de cada round em
  arquivo. Permitir replay offline para debug.
- **Caso de uso:** Debug de rounds que falharam em live mode.
- **Pré-requisitos:** Definir formato de replay. Cuidado com
  PII (addresses, tx hashes).
- **Riscos:** Volume de dados. Round típico pode ser ~10KB; 1000
  rounds/dia = 10MB/dia. Aceitável.
- **Status:** Boa ideia para pós-M6.

### FI-004 — Anomaly detection baseado em Registry

- **Descrição:** Consumir `/api/runtime/status` para detectar
  anomalias em tempo real: pico de `rpcErrors`, pico de
  `gateRejects`, mudança brusca em `pipelineLatencyMs` P95,
  frequência alta de `lease` failures (indicador de split-brain).
- **Caso de uso:** Alerta proativo antes do operador perceber.
- **Pré-requisitos:** Janela deslizante de métricas. Atualmente
  Registry acumula desde startup; adicionar `getWindow(duration)`.
- **Riscos:** Falsos positivos. Mitigação: thresholds ajustáveis.
- **Status:** Boa ideia. Pode ser M9 ou sub-fase do M8.

### FI-005 — Multi-sig para broadcaster

- **Descrição:** Em vez de broadcaster usar 1 signer, usar
  multi-sig (ex.: 2-of-3 signers). Tolerância a comprometimento
  de 1 signer.
- **Caso de uso:** Defesa em profundidade após M6.
- **Pré-requisitos:** Múltiplos processos signer. Coordenar
  assinaturas via consensus protocol.
- **Riscos:** Latência aumentada (múltiplos IPC round-trips).
  Complexidade operacional (3 signer processes em hosts
  diferentes).
- **Status:** Avaliar para M10+. Não no horizonte próximo.

### FI-006 — Hardware wallet integration

- **Descrição:** Signer pode delegar assinatura para hardware
  wallet (Ledger, Trezor) via USB HID.
- **Caso de uso:** Operador quer controle físico sobre chave.
  Tx só é assinada com botão pressionado no hardware.
- **Pré-requisitos:** Hardware wallet conectado ao host do
  signer. Driver `@ledgerhq/hw-app-eth` ou similar.
- **Riscos:** Latência humana (operação manual). Não compatível
  com trading autônomo. Útil apenas para cold reserve operations.
- **Status:** Caso de uso restrito. Avaliar sob demanda.

### FI-007 — Backtesting com histórico on-chain

- **Descrição:** Replay de estratégia contra histórico on-chain
  (Block-Range query). Comparar P&L simulado vs benchmark.
- **Caso de uso:** Validar estratégia antes de M6.
- **Pré-requisitos:** Indexar histórico de pools (The Graph ou
  similar). Atualmente `backtest.ts` existe mas usa dados
  sintéticos.
- **Riscos:** Volume de dados. Histórico de pool por 1 ano pode
  ser GB.
- **Status:** Bom para M9 ou paralelo a M6.

### FI-008 — Dashboard de auditoria forense

- **Descrição:** Dashboard dedicado a explorar audit log
  (`audit-log.ts`) com filtros (por round, por gate, por token,
  por timestamp). Visualizar hash-chain e verificar integridade.
- **Caso de uso:** Forense pós-incidente. Compliance.
- **Pré-requisitos:** Nenhum (audit-log já existe).
- **Riscos:** Nenhum. Read-only.
- **Status:** Boa ideia. Pode ser sub-fase do M8.

### FI-009 — Rate limiting por IP em API routes

- **Descrição:** Adicionar rate limiting em endpoints de mutação
  (`/api/engine/start`, `/api/kill-switch`, etc.) para evitar
  abuso.
- **Caso de uso:** Se dashboard for exposto externamente.
- **Pré-requisitos:** Definir estratégia (token bucket por IP,
  por usuário, etc.).
- **Riscos:** Falsos positivos se operador acessa de múltiplos
  IPs (VPN, mobile).
- **Status:** Avaliar quando dashboard for exposto publicamente.

### FI-010 — TPS limiter no broadcaster

- **Descrição:** Limitar broadcasts a N tx por segundo para evitar
  banimento por RPC provider.
- **Caso de uso:** Live mode com alto volume.
- **Pré-requisitos:** Token bucket em `LeasedBroadcaster` ou
  `Broadcaster`.
- **Riscos:** Pode atrasar tx urgentes. Mitigação: bucket com
  burst allowance.
- **Status:** Avaliar quando M6 começar.

### FI-011 — Snapshot do estado do runtime para recovery rápido

- **Descrição:** Periodicamente (ex.: a cada 1000 rounds), salvar
  snapshot do Registry e do estado da lease em disco. Em restart,
  carregar snapshot e continuar.
- **Caso de uso:** Recovery rápido após crash.
- **Pré-requisitos:** Formato de snapshot. Garantir
  idempotência.
- **Riscos:** Snapshot pode estar desatualizado em crash.
  Mitigação: combinar com WAL (write-ahead log) de audit-log já
  existente.
- **Status:** Boa ideia. Avaliar para M9+.

### FI-012 — Internacionalização (i18n) do dashboard

- **Descrição:** Dashboard em Português e Inglês. Hoje é
  hardcoded em Português (com alguns termos em Inglês).
- **Caso de uso:** Operadores não-falantes de Português.
- **Pré-requisitos:** `next-intl` ou similar.
- **Riscos:** Manutenção de traduções.
- **Status:** Baixa prioridade. Operador atual é falante de
  Português.

### FI-013 — Mobile-first dashboard

- **Descrição:** Layout otimizado para mobile.
- **Caso de uso:** Monitorar runtime do celular.
- **Pré-requisitos:** shadcn/ui já é responsivo, mas tabs não
  cabem em mobile.
- **Riscos:** Nenhum.
- **Status:** Avaliar quando operador solicitar.

---

## Ideias descartadas (não implementar)

### FI-D001 — "Irrastreável" / mixer integration

- **Descartada:** Incompatível com AML/KYC. Removido do escopo em
  negociação inicial com operador.

### FI-D002 — Trading com alavancagem (margin/leverage)

- **Descartada:** Risco desproporcional ao objetivo de
  scam-resistance. Operador não solicitou.

### FI-D003 — Custodial wallet (app mantém custódia de fundos
de terceiros)

- **Descartada:** Aumenta superfície de ataque. App é
  non-custodial; operador mantém custódia.

---

### [Ideias futuras vêm aqui — nunca sobrescrever acima]

**Nota:** Quando uma ideia for promovida a milestone, **não
removê-la daqui**. Adicionar nota "(Promovida a M-X em YYYY-MM-DD,
ver `architecture/roadmap.md`)" e manter o registro histórico.

---

## Relacionado

- `architecture/roadmap.md` — ideias promovidas a milestone.
- `DECISION_LOG.md` — toda promoção de FI-NNN a milestone produz entrada aqui.
- `memory/implementation-history.md` — registro de quando cada ideia foi promovida.
- `MANIFEST.md` — princípios do Project OS e tabela de IDs canônicos.

