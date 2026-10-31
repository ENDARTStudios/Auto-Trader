# CHANGELOG — Auto Trader

> **Formato:** Keep a Changelog. **Versão do produto:** `package.json` (0.2.0). Detalhe por commit: `git log`; decisões: `DECISOES.md`.

---

## [0.2.0] — 2026-08/09 — Foundation, Auth, Skill e CI hardening

### Added
- **Engine de trading autônomo** — loop `SCOUT → ANALYZE → EXECUTE → MONITOR → EXIT → REBALANCE`, paper trader, portfolio 50/50 (reserva cold USDC / reinvestimento), exit planner, fee model, diversification.
- **Skill auto-trade-bubble-macro-evolution v1.6.0** — 5 camadas (`perception → causal_bubble → macro_reasoner → action_policy → self_evolution`), `M_param`/`M_lang` separados (champion `param_v17`/`lang_v10`), veto de coerência isolado, forward OOS, envelope humano com write-fence (`envelope.ts`).
- **Auth completa** — RBAC 4×24 (`super_admin/admin/trader/viewer`), sessões opacas SHA-256 HttpOnly, bcrypt cost 12, MFA TOTP, RLS por `ownerId`, audit log com hash-chain, login UI, admin users.
- **Scam detection multicamada** — turnover/liquidez/contrato/holders/idade + GoPlus + site-integrity + AI squad; circuit breakers e kill switches configuráveis.
- **ETL crypto-only** — CoinGecko, DexScreener, GoPlus, Etherscan (Arbiscan/Basescan/Optimistic).
- **RAG local** — Postgres pgvector + ollama `nomic-embed-text` (`Embedding`, `KnowledgeGraph`).
- **Signer isolation H0–M4** — vault KDF versionado, rotação de chaves, hash-chain audit, RPC resilience, sim gates, MEV baseline, broadcaster (módulos **frozen**).
- **Compliance** — privacy/terms/pricing, billing Stripe, observabilidade OTel/Sentry, i18n pt-BR/en-US/es-ES.
- **CI** — lint+typecheck+gitleaks+audit+`test:ci` (637 checks)+coverage+Trivy+ZAP; e2e Playwright (chromium+mobile) condicionado a label; staging stub Fly.io.

### Fixed
- S13b: escopo ETL corrigido de "futebol" para crypto-only (5 arquivos deletados/escritos).
- S32: lint 57→0 erros; npm audit 29→9; docs verificados sem escopo alheio.
- T050–T054: chain de coverage fechada; skip condicional das suites Unix-socket no Windows; copy `install-git-hooks.mjs` e python3/make/g++ no deps stage do Docker; causa raiz de "falhas" do CI identificada como `continue-on-error` do Trivy (CVEs node-tar), não regressão.

## [0.1.0] — 2026-07 — Protótipo inicial

- Dashboard Next.js (saldo, posições, P&L, histórico, scam audit, logs, kill switch, config editor).
- Engine in-process TypeScript singleton; SQLite via Prisma (`db/custom.db`).
- Scam detector heurístico; paper trading como default.

---

### Convenção para novas entradas
- **Added/Changed/Fixed/Removed/Security** — uma linha por entrega com módulo/arquivo.
- Nunca registrar segredo ou chave aqui; incidentes vão para [INCIDENT_RESPONSE.md](./INCIDENT_RESPONSE.md).
