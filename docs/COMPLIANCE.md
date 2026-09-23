# COMPLIANCE — Compliance e Limites Operacionais

> **Versão:** 1.0 — 2026-09-23
> **Escopo:** privacidade (LGPD/GDPR), avisos de risco, trilha de auditoria, limites de mercado.

---

## 1. Aviso de risco (inviolável)

- O README (raiz) carrega o **aviso de risco** obrigatório: o sistema reduz mas **não elimina** risco de scam/perda; não é aconselhamento financeiro; nunca investir mais do que se pode perder.
- Toda superfície pública (dashboard, pricing, terms) mantém essa mensagem coerente — ver [CONTENT.md](./CONTENT.md).
- **Paper-first é compliance operacional:** live mode só existe após graduação formal (`src/lib/trading/graduation.ts`). Nunca "pular" a graduação.

## 2. Privacidade (LGPD/GDPR)

- Página `/privacy` e `/terms` publicadas e versionadas.
- Dados pessoais mínimos: `User` (email + hash de senha + TOTP); sessões opacas revogáveis.
- **AuditLog com hash-chain** (`src/lib/audit/`) — trilha íntegra de ações autenticadas; delete de log = violação (hash quebra).
- RLS por `ownerId` garante isolamento entre operadores (ver [RLS.md](./RLS.md)).
- Direitos do titular: exportação via `csv-export.ts` onde aplicável; exclusão de conta = soft-delete + retenção de logs de auditoria (obrigação legal de trilha).

## 3. Trilha de auditoria

| Evento | Onde |
|---|---|
| Login/logout, mudanças de config, kill switch | `AuditLog` (hash-chain) |
| Decisões do engine (com P e justificativa) | `logs/episodes.jsonl` |
| Rejeições e vetos de coerência | `logs/rejected.jsonl`, `logs/coherence.jsonl` |
| Mudanças no envelope humano | Commit + `DECISOES.md` (config é versionado no git) |

## 4. Limites de mercado e conduta

- `risk_config.json → kill_switches.order_pattern_compliance_switch: true` e `order_to_trade_ratio_switch` (máx 50/sessão; breach → `degrade_to_advisory`): o sistema **se auto-limita** para não parecer manipulação/spoofing.
- Apenas APIs públicas e gratuitas (Binance public REST, DexScreener, GoPlus, Etherscan) — sem scraping abusivo; rate-limit de saída respeitado (ver [INTEGRATIONS.md](./INTEGRATIONS.md)).
- **External systems advisory-only:** nenhum código copiado de repos copyleft/fair-code (política em `skills/EXTERNAL_SYSTEMS_INDEX.md`); licenças verificadas por evidência.

## 5. Segurança como compliance

- Gate de secrets (gitleaks), SAST (Trivy), DAST (ZAP — `zap.yml`), dependency audit: ver [SECURITY_REVIEW.md](./SECURITY_REVIEW.md).
- Segredos em vault com KDF versionado e rotação ([SECRETS.md](./SECRETS.md), [CRYPTO.md](./CRYPTO.md)).

## 6. Revisão

- Este doc e as páginas públicas são revisados a cada release (checklist em [QA_TESTING.md](./QA_TESTING.md)).
- Mudança de limites de risco = decisão humana registrada ([RULES.md](./RULES.md) §2), com review em T_sla 30d.

---

**Relacionados:** [RULES.md](./RULES.md) · [RLS.md](./RLS.md) · [SECURITY_REVIEW.md](./SECURITY_REVIEW.md) · [CONTENT.md](./CONTENT.md)
