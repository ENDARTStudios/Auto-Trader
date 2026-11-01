# 03 · Páginas

Inventário completo do conceito: **22 telas** (17 autenticadas, 5 públicas) + estados de sistema. Cada tela responde a **uma** pergunta de operador.

| # | Rota | Pergunta | Ação primária |
|---|---|---|---|
| 1 | `/landing` | “Isso é para mim?” | Start in paper mode |
| 2 | `/pricing` | “Quanto custa?” | Start trial |
| 3 | `/login` | “Como entro?” | Sign in |
| 4 | `/signup` | “Como começo?” | Create workspace |
| 5 | `/reset` | “Esqueci a senha” | Send reset link |
| 6 | `/onboarding` | “Como configuro?” | Continue (4 passos) |
| 7 | `/overview` | “Está tudo sob controle?” | Pause engine |
| 8 | `/markets` | “O que está se movendo?” | Add pair |
| 9 | `/markets/:symbol` | “Vale a pena entrar?” | Paper trade |
| 10 | `/portfolio` | “Onde está meu dinheiro?” | New position |
| 11 | `/positions/:id` | “Mantenho ou saio?” | Close position |
| 12 | `/strategy` | “O que roda e com quais limites?” | Edit config |
| 13 | `/backtest` | “Isso funcionaria no passado?” | Run backtest |
| 14 | `/analytics` | “Estou ganhando por quê?” | Export |
| 15 | `/journal` | “O que aconteceu?” | Export CSV |
| 16 | `/risk` | “Como eu paro tudo?” | Kill switch |
| 17 | `/copilot` | “Por que ele fez isso?” | Send question |
| 18 | `/alerts` | “O que precisa de mim?” | Mark all read |
| 19 | `/data` | “De onde vêm os dados?” | Add integration |
| 20 | `/settings` | “Como o produto se comporta?” | Save changes |
| 21 | `/billing` | “O que eu pago?” | Change plan |
| 22 | `/admin` | “Quem pode fazer o quê?” | Create user |

---

## 1. Landing — `/landing`

**Objetivo:** explicar em 10 segundos o que é, por que confiar e qual o próximo passo.
**Estrutura:** nav (logo, 4 links, Sign in, Start free) → hero com badge de novidade, título serifado em duas linhas, lede de 58 caracteres por linha, dois CTAs, nota de risco → **preview real do app** dentro de um frame de navegador → “Three layers, one decision” (Perceive/Protect/Explain) → faixa de 4 números → segurança e graduação → pricing resumido → footer.
**Regras:** uma única ação primária visível; nenhum texto de marketing com número inventado; preview sempre com dados de paper.
**Estados:** `loading` (skeleton do preview), `offline` (aviso de status), `reduced-motion`.
**Dados:** `GET /api/public/stats` (pairs escaneados, tokens checados, uptime).
**Antes:** não existia (raiz redirecionava ao login).

## 2. Pricing — `/pricing`

**Estrutura:** header → alternador Mensal/Anual (2 meses grátis) → 3 planos com 5 bullets cada → tabela comparativa (12 linhas) → FAQ (6) → CTA final → footer.
**Regras:** “Current plan” nunca é um botão de downgrade; o plano destacado é Pro; cada bullet tem unidade (“20 open positions”, “300 req/min”).
**Estados:** `signed-out` (CTA leva a signup), `signed-in` (CTA muda para “Change plan” e abre Billing), `trial-active`.
**Antes:** 3 cartões sem comparação, sem período, com “Downgrade” no plano gratuito.

## 3. Login — `/login`

**Estrutura:** split 55/45. Esquerda: fundo com malha e curva de equity, citação editorial, 3 números de confiança. Direita: logo, “Welcome back”, e-mail, senha com revelar, “Keep me signed in”, “Forgot password?”, CTA, divisor, passkey, “Explore the demo workspace”.
**Regras:** nenhuma credencial de teste visível; “demo” é um botão explícito que abre um workspace somente-leitura; erro de credencial é inline e não revela existência de conta.
**Estados:** `idle`, `submitting`, `invalid`, `locked` (5 tentativas → 60 s), `mfa-required`.
**Antes:** cartão centralizado, sem recuperação, sem MFA, título duplicado.

## 4. Sign up — `/signup`

Campos: nome, e-mail corporativo, senha com medidor e 3 requisitos, aceite de termos com link, CTA. Validação on-blur; erro no topo do campo; `autocomplete` correto para gerenciadores de senha.
**Estados:** `weak-password`, `email-taken` (mensagem neutra), `terms-unchecked`.

## 5. Reset — `/reset`

Um campo, um CTA, confirmação neutra (“if the address exists…”), link de volta. Não confirma existência de conta.

## 6. Onboarding — `/onboarding`

**Layout:** sidebar de passos (4) + conteúdo central de 880 px.
1. **Risk profile** — três escolhas (Conservative/Balanced/Aggressive) com consequência numérica e preview “um stop-out custa $X”.
2. **Strategy** — escolher template (Momentum, Trend, Mean reversion) e universo (Top 18, watchlist).
3. **Connections** — exchange (read-only), canal de alerta, MFA.
4. **Review** — resumo editável + “Start in paper”.
**Regras:** progresso persistido; “Skip for now” é link terciário; cada etapa tem um único primário; nada de modal sobre dashboard.
**Antes:** modal de 4 etapas sobre a home densa, sem preview.

## 7. Overview — `/overview`

**Pergunta:** está tudo sob controle?
**Estrutura (≤ 1.200 px de altura):**
- Cabeçalho: badge Paper + estado da engine, título, subtítulo de 1 linha, ações (Export, New backtest, Pause engine).
- Banner de paper mode com progresso de graduação e link para as regras.
- **Hero (2/3 + 1/3):** cartão de equity (valor, delta, inicial/pico/drawdown/benchmark, gráfico de área com período 1W/1M/3M/ALL, legenda) + coluna direita com **Engine** (anel de progresso, rodada, etapa, próxima varredura) e **AI decision** (lado, par, tamanho, stop, confiança, 4 gates, “Why this trade?”).
- Faixa de 6 KPIs.
- Grade inferior: posições abertas (4 linhas com link), “Needs attention” (3 alertas + ações), Activity (log curto).
**Regras:** nenhum gráfico vazio; se não há série, mostrar `empty` com “Start engine”; sempre rotular a janela (“30d”).
**Estados:** `engine-idle`, `engine-running`, `paused`, `no-positions`, `degraded` (RPC), `first-run`.
**Antes:** 12 domínios, 5.284 px, sem URL.

## 8. Markets — `/markets`

**Estrutura:** faixa de 5 estatísticas de mercado; card “Scanner” com abas (All/Watchlist/Positions/Rejected), filtro e tabela de 10 colunas (Asset, Price, 5m, 24h, Volume, Spread, Liquidity, Risk, 7d sparkline, Score); coluna direita com Top movers, Order flow (barra compra/venda + depth) e Sentiment (gauge).
**Regras:** linha inteira clicável → detalhe do token; ordenação por score por padrão; risco é badge com texto, não só cor.
**Estados:** `empty-watchlist`, `no-results` (filtro), `stale` (última atualização > 60 s), `loading` (skeleton de 8 linhas).
**Antes:** dentro da home; sem URL por par.

## 9. Token detail — `/markets/:symbol`

**Estrutura:** breadcrumb e voltar; cabeçalho com ícone, nome, preço grande, delta, volume/liquidez/spread; ações (Watchlist, Ask Copilot, Paper trade); grid 2/3 + 1/3 com gráfico de candles (15m/1H/4H/1D) e **Risk score** (score composto + 4 flags: liquidez, autoridade, sell test, holders) + “Your position” (se houver) e Key statistics; abaixo, “Why it is in the scanner” (4 evidências) e estatísticas-chave.
**Regras:** se um gate falhar, o CTA de trade fica desabilitado com motivo visível.
**Estados:** `blocked` (honeypot), `thin-liquidity`, `no-position`.

## 10. Portfolio — `/portfolio`

**Estrutura:** 3 cartões no topo (equity com mini gráfico e realizado/não realizado/taxas; allocation com donut + legenda; buying power com exposição e orçamento de risco); abaixo, tabela de posições (Asset, Side, Size, Entry, Mark, P&L, Weight, Strategy, fechar) + coluna com exposição por estratégia, beta, correlação, VaR e últimas execuções.
**Regras:** fechar posição abre modal com notional, slippage estimado e P&L realizado.
**Estados:** `no-positions` (empty com “Start engine”), `cash-only`, `over-limit`.

## 11. Position detail — `/positions/:id`

**Estrutura:** voltar; cabeçalho com side, par, entrada/mark/stop/target; 4 métricas (size, P&L, distância até o stop, confiança na entrada); gráfico “Price vs plan” com linhas de stop/target; trilha de execução (Scored → Risk → Signed → Filled → Manage); gates de entrada; bloco de invalidação com condição textual.
**Regras:** “Adjust stop” e “Close position” são as duas ações; a invalidação é escrita em linguagem natural e repetida no Journal.
**Estados:** `near-stop`, `target-hit`, `stale-quote`.

## 12. Strategy & engine — `/strategy`

**Estrutura:** card de estado da engine (anel, rodada, rounds/trades hoje, uptime, Pause, Kill switch); lista de 5 estratégias (nome, versão, estado live/shadow/paused, trades, win rate, alocação, P&L, toggle); runtime settings (modo, schedule, intervalo, máximo de posições); coluna direita com Guardrails (4 medidores), Graduação (12/50) e última promoção.
**Regras:** guardrails marcados como “human-owned” e não editáveis pelo motor; alterar modo para Live exige MFA e 50 ciclos.
**Estados:** `shadow-only`, `paused`, `live-locked`.

## 13. Backtest — `/backtest`

**Estrutura:** formulário (estratégia, universo, datas, capital, slippage, taxa, alavancagem, 3 switches de gate/walk-forward/taxas) + botão Run; resultado com 8 estatísticas, curva de equity vs buy & hold, retornos mensais, tabela de trades de amostra; histórico de runs.
**Regras:** walk-forward ligado por padrão; resultado mostra janela out-of-sample explicitamente; rodar leva ~40 s com progresso e toast ao terminar.

## 14. Analytics — `/analytics`

**Estrutura:** seletor 7D/30D/90D/1Y + export; 6 métricas (retorno, drawdown, Sharpe, Sortino, win rate, profit factor); gráfico equity vs benchmark; retornos mensais; heatmap dia × sessão; drawdown underwater; tabela de atribuição por estratégia (trades, win rate, P&L, contribuição, R médio, share de risco).
**Regras:** toda métrica declara a janela e a base (líquido de taxas, apenas trades fechados).
**Estados:** `insufficient-data` (< 10 trades) com explicação.

## 15. Journal — `/journal`

**Estrutura:** filtros e busca; tabela agrupada por dia (hora, asset, side, qty, preço, notional, taxa, P&L, status, rodada); linha abre gaveta com ID, fill, slippage, venue e “por que este trade”; coluna com resumo do mês, rodadas recentes e integridade da cadeia de auditoria (verificar hash).
**Regras:** rejeições aparecem com motivo; export CSV gera arquivo com hash para conferência.
**Estados:** `empty`, `sync-lag`, `chain-broken` (alerta crítico).

## 16. Risk & safety — `/risk`

**Estrutura:** cabeçalho “All clear” + Run drill + Kill switch; card de **Emergency stop** (explicação, 3 consequências, botão vermelho sólido, dry run, último acionamento) e card de **Risk budget** (4 medidores com valor e limite); grid com Circuit breakers (5 regras, estado armed/fired) e Scam surveillance (4 tokens com blocked/watch); tabela de Risk events (hora, tipo, detalhe, ação, impacto, status).
**Regras:** o botão de kill switch aparece apenas aqui e na paleta; confirmação exige digitar `HALT`; toda ação gera entrada imutável.
**Estados:** `armed`, `fired`, `halted`, `dry-run`.

## 17. AI Copilot — `/copilot`

**Estrutura:** 3 colunas — threads (busca + 5) · conversa (mensagens do usuário e da IA, blocos estruturados, chips de citação, sugestões, compositor) · evidências (6 fontes com detalhe, “Decision at a glance” com gates, aviso de que o Copilot é consultivo).
**Regras:** toda resposta cita `episodes.jsonl`, `risk_config.json` ou `model_registry.json`; sem números que não existam no ledger; nunca executa ordens.
**Estados:** `empty-thread`, `no-evidence`, `streaming`, `error` (fallback sem IA).

## 18. Alerts — `/alerts`

**Estrutura:** filtros (All/Critical/Warnings/Info), lista com ícone por severidade, título, descrição, ações (Review/Dismiss) e tempo; coluna com Delivery (4 canais com switch + status) e Alert rules (5 regras).
**Regras:** alerta crítico não pode ser silenciado por “mute 1h”; regras têm escopo (instant/digest).
**Estados:** `empty`, `muted`, `channel-error`.

## 19. Data & sources — `/data`

**Estrutura:** Market data (4 fontes com latência, uptime 30d, barras de saúde de 12 intervalos) e Venues & wallets (exchange, carteira, billing com status); tabela de qualidade (p50/p99, erros, failovers, uso, peso) e card de API access (chave, rate limit, webhook, rotacionar).
**Regras:** fonte degradada reduz tamanho automaticamente — dito em texto, não só por cor.
**Estados:** `degraded`, `quorum-lost`, `key-expired`.

## 20. Settings — `/settings`

**Estrutura:** nav vertical (Profile, Security, Preferences, Notifications, API keys, Danger zone) + seções: perfil (avatar, nome, e-mail, papel, timezone), segurança (MFA, sessões, auditoria), preferências (tema, densidade, idioma, reduzir movimento).
**Regras:** salvar é explícito com confirmação; alterações de segurança exigem senha; “Danger zone” separada no fim.
**Estados:** `dirty`, `saving`, `saved`, `error`.

## 21. Billing — `/billing`

**Estrutura:** plano atual (Pro, renovação, limite de posições), aviso de graduação, uso do ciclo (4 medidores), faturas (4 linhas com status), método de pagamento, upsell Elite.
**Regras:** preço com moeda e período; cancelar é link discreto com retenção honesta (sem dark pattern).
**Estados:** `trial`, `past-due`, `cancelled`.

## 22. Admin — `/admin`

**Estrutura:** cabeçalho restrito; botão Create user (modal); tabela de usuários (avatar, e-mail, papel, status, último login, criado, ações); coluna com audit log ao vivo e cartão de sistema (versão, região, DB, signer, uptime).
**Regras:** papéis `viewer | trader | super_admin`; exclusão é soft-delete; toda ação vai para o audit log com IP.
**Estados:** `no-users`, `audit-exporting`, `permission-denied`.

---

## Estados de sistema (transversais)

| Estado | Onde | Especificação |
|---|---|---|
| 404 | rota inválida | Ilustração de bússola, “Page not found”, link para Overview |
| 500 / error boundary | qualquer tela | Título, o que aconteceu, “Reload” + “Open status”, sem stack trace |
| Maintenance | app inteiro | Banner vermelho no topo, ações desabilitadas, ETA, link de status |
| Offline | app inteiro | Faixa “Reconnecting…”, dados em cache com timestamp |
| Skeleton | listas, gráficos, KPIs | Shimmer de 1,6 s, mesma geometria do conteúdo |
| Empty | 8 telas | Ilustração + título + 1 ação + 1 escape |
| Permission denied | admin, billing | Explicação do papel necessário + “Ask an admin” |

---

## Conteúdo e i18n

- Chaves em `en-US`, `pt-BR`, `es-ES`; **nenhuma string hardcoded** em componente.
- Formatos por locale: moeda (`Intl.NumberFormat`), data (`Intl.DateTimeFormat`), unidade de tempo relativa (`Intl.RelativeTimeFormat`).
- Números grandes: `$24.8K` em eixos, `$24,812.44` em valores principais — sempre com a mesma regra.
- Textos de risco são escritos para serem lidos em pânico: voz ativa, primeira frase com a consequência.
