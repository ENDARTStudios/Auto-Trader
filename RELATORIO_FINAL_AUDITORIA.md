# Relatório Final de Auditoria — Auto Trader (2026-11-04)

Este documento consolida o resultado do ciclo iniciado pela auditoria rígida de 2026-11-03
(AUDITORIA_RIGOROSA_2026-11-03.md) e executado em 14 rodadas de correção/deploy.

## 1. Sumário executivo

O projeto deixou de ser um protótipo de teste e passou a ser um sistema real, fail-closed,
com os sistemas antes simulados implementados (ou removidos quando eram dead code), segurança
P0/P1 corrigida, RLS multi-tenant strict nas 4 tabelas com ownerId, backup/restore provado e
CI/CD com o pipeline de main verde. O que resta são itens que dependem de credenciais/decisões
do operador (chaves, tokens, URLs) — não há implementação de código pendente conhecida.

## 2. Falhas corrigidas (por eixo)

### 2.1 Segurança
- Bypass de autenticação e cookie de sessão forjado: sessão HMAC + CSRF real; 100% das rotas
  /api auth-protegidas (allowlist explícita de public routes); fail-closed sem SESSION_SECRET.
- Backups/info e rotas de sistema: exigem system:read/super_admin.
- Credenciais default em produção: senha rotacionada, contas seed viewer/trader desativadas,
  sessions apagadas, OWNER promovido a super_admin.
- Token de reset de senha não é mais logado em produção (e-mail transacional real).
- Sentry sem SDK: transporte por envelope HTTP; wrapper client-safe (sem node:crypto no browser).
- RLS nativo em Postgres: role de app autotrader_app (rolsuper=false, rolbypassrls=false),
  ENABLE+FORCE, policies por ownerId/GUC, strict nas 4 tabelas (WalletConnection,
  NotificationChannel, ExchangeConnection, Position). Verificação em prod: ALL_STRICT.
- Guards para scripts de manutenção sob RLS (require-bypass-rls) e verify-rls-enforcement.

### 2.2 Sistemas reais que eram simulados
- Live trading: adapters CEX (CCXT) e DEX (ethers v6, Uniswap V3), gating de 6 condições,
  credenciais vault-first; intencionalmente DESLIGADO (depende de chaves/OK do operador).
- Signer: processo separado real (bundle esbuild, Unix socket 0600, handshake, supervisor,
  backoff), rodando em produção com /api/signer/health configured/reachable/ready.
- ETL: conectores reais DexScreener/GoPlus/CoinGecko/Etherscan; OHLCV real via GeckoTerminal
  com MarketDataUnavailableError e dataQuality.
- IA/RAG: provider real OpenAI-compatible/Ollama para chat E embeddings; sem provider -> 503
  explícito; evidence ledger sobre a resposta real; fallback hash apenas dev/test; script de
  reindex. (Mock LLM removido.)
- Upload: saiu do stub 501; multipart real com magic bytes, limites por mime, UUID, sha256,
  gravação privada 0600 (UPLOAD_DIR), status real — sem ClamAV/S3 (documentado).
- E-mail: transporte real Resend/webhook; reset envia de verdade.
- Fila BullMQ: era dead code (0 callers) e foi removida; fila assíncrona real não implementada
  (documentado; não recriar stub).
- Backup/DR: pg_dump/pg_restore reais; restore provado E2E com Docker (34/34 tabelas,
  2410/2410 linhas), incluindo correção de ACL no dump e classificação de tabelas voláteis.

### 2.3 Motor/dados/UX
- Engine, portfolio, risk, diversification, schedule, performance-snapshot reais; bugs de
  tax_spike e holder_concentration corrigidos com testes.
- 2 bugs de API corrigidos: P&L% -100% sem preço (agora 0) e range inválido de analytics
  (agora 400 invalid_range).
- Dados demo rotulados no dashboard (selo Demo data) + script de limpeza.
- a11y: scrollable-region-focusable corrigido em 12 regiões; spec axe verde.
- Migrações Prisma bootstrapped; histórico no Neon com 5 migrations, migrate status up to date.

### 2.4 Engenharia/CI
- CI de main verde (ci + e2e + e2e-meridian + codeql), branch protection (ci+codeql,
  sem force push), PRs #109–#117 mergeados.
- Runner E2E local standalone (scripts/e2e-standalone.mjs): DB descartável + seeds + build +
  dois servers + cleanup; main 52/52 (workers 2) e meridian 13/13.
- Cobertura: 64,46% -> 67,24%+ (lines) com 96 arquivos/1305 testes; portfolio 100%,
  performance-snapshot 100%, engine-correctness 100%, 10 rotas com 44 testes.

## 3. Evidências finais (2026-11-04)

- Gates locais: tsc exit 0; eslint exit 0; vitest 96 arquivos / 1305 passed / 1 skipped;
  npm run build OK.
- Produção (https://auto-trader-production-0cbc.up.railway.app):
  /api/health 200, /api/health/ready 200; cookie forjado 401; senha default 401;
  /api/status mode=paper, graduatedToLive=false, demoData=true; signer ready.
- RLS: verify-rls-enforcement --expect-all-strict => ALL_STRICT (prod, role autotrader_app).
- Prisma: 5 migrations; database schema is up to date.
- CI de main #41774981390: ci, e2e, e2e-meridian, codeql = success.

## 4. Itens que dependem do operador (fora do código)

1. CD automático Railway: criar RAILWAY_TOKEN de projeto + RAILWAY_DEPLOY_ENABLED=true
   (workflow deploy-railway.yml pronto e gated).
2. Live trading: chaves de exchange (vault/env) + aprovação S14 (LIVE_TRADING_ENABLED,
   S14_APPROVED, feature flag, graduation); o código já aplica todos os gates e falha fechado.
3. Observabilidade/telemetria: SENTRY_DSN, REDIS_URL (rate limit distribuído/SSE).
4. IA/embeddings: AI_PROVIDER/AI_API_KEY (ou OLLAMA_URL) e rodar scripts/reindex-embeddings.ts.
5. E-mail: RESEND_API_KEY/EMAIL_FROM ou EMAIL_WEBHOOK_URL/TOKEN.
6. Upload: montar volume persistente e definir UPLOAD_DIR (default /data/uploads).

## 5. Riscos/limitações residuais honestas

- Fila assíncrona real (BullMQ+Redis) não implementada; ETL é síncrono.
- Upload sem antivírus/S3; sem quota/GC; bufferiza até 10 MiB.
- Coverage.include não inclui src/app/api/** (testes de rota existem, mas não contam no %).
- E2E jobs rodam em main e por label (não em todo PR, por custo).
- Dados demo continuam no banco de produção (rotulados; remover com
  npm run db:demo:clear -- --yes).
- Dependentes de terceiros: advisories node-tar HIGH documentados (Trivy não-bloqueante).

## 6. Como verificar rapidamente

  npx tsc --noEmit && npx eslint . && npx vitest run && npm run build
  node scripts/e2e-standalone.mjs --build
  railway run node scripts/verify-rls-enforcement.mjs --expect-all-strict
  node scripts/backup-restore-e2e.mjs

Conclusão: o objetivo — corrigir as falhas do relatório, substituir sistemas simulados por
reais e aplicar as ações imediatas — foi cumprido no escopo de código/infra. A operação de
live/CD/telemetria fica condicionada às credenciais e aprovações do operador, com o sistema
falhando fechado até lá.
