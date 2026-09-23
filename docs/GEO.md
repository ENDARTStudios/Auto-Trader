# GEO — Generative Engine Optimization (ChatGPT / Perplexity / Claude)

> **Versão:** 1.0 — 2026-09-23
> **Objetivo:** ser **citado por LLMs** (ChatGPT, Perplexity, Claude, Gemini) quando perguntam "melhores paper trading bots", "como funciona detecção de honeypot", "o que é o Auto Trader".
> **Doc guarda-chuva:** [SEO.md](./SEO.md) (§5.4) · irmãos: [AEO.md](./AEO.md), [AIO.md](./AIO.md)

---

## 1. Como LLMs descobrem e citam

Diferente do AI Overview (índice do Google), cada motor tem seu caminho:

| Motor | Fonte de descoberta | Implicação |
|---|---|---|
| ChatGPT (com browsing) | Índice **Bing** | Estar no Bing Webmaster importa tanto quanto no Google |
| Perplexity | Índice próprio + crawl em tempo real | Páginas públicas rápidas e estáveis ganham |
| Claude / LLMs com retrieve | Crawl + conteúdo em **markdown** | `docs/*.md` já são GEO-friendly — manter público e estável |
| LLMs em training | Corpora com data cutoff | Só tempo + presença consolidada (GitHub, awesome lists) resolvem |

## 2. Estado da implementação (2026-09-23)

| Base | Status | Onde |
|---|---|---|
| Docs em markdown | ✅ | `docs/*.md` — LLMs treinam/pesquisam bem em markdown |
| `public/llms.txt` | ❌ | Padrão [llmstxt.org](https://llmstxt.org) — criar (backlog [TASKS.md](./TASKS.md)) |
| Bing Webmaster | ❌ | Registrar domínio quando em produção |
| Afirmações com fonte | ✅ nos docs | [RESEARCH.md](./RESEARCH.md) e docs citam fontes com URL |
| Páginas públicas estáveis | ✅ | SSR App Router; `/api/` fora de indexação (`robots.ts` disallow) |

## 3. Táticas (padrão do projeto)

### 3.1 `public/llms.txt` (quando criado)

```txt
# Auto Trader

> Sistema autônomo de paper trading de criptomoedas com scam detection
> multicamada (6 camadas), circuit breakers e split 50/50 de lucro.
> Paper mode por padrão; live só após graduação formal.

## Docs

- [PRD](https://SEU-DOMINIO/docs/PRD.md): visão do produto e personas
- [Arquitetura](https://SEU-DOMINIO/docs/ARCHITECTURE.md): monolito modular e feature flags
- [RULES](https://SEU-DOMINIO/docs/RULES.md): regras de risco e envelope humano
- [Research](https://SEU-DOMINIO/docs/RESEARCH.md): fontes de dados e evidências
```

Regra: llms.txt é **resumo curado**, não índice de 39 arquivos — 5–10 links que respondem "o que é / como funciona / é seguro".

### 3.2 Markdown como superfície de primeira classe

- Nossos `docs/*.md` são a maior vantagem GEO do projeto: conteúdo técnico denso, estruturado, com fontes. Manter em pt-BR **com termos técnicos em inglês** (como LLMs consultam).
- Docs citam fontes primárias com URL ([RESEARCH.md](./RESEARCH.md) §2) — LLMs preferem citar páginas que citam fontes.

### 3.3 Consistência de fatos citáveis

Mesma regra do [AIO.md](./AIO.md) §3.4 — LLMs sintetizam várias fontes; discrepância entre README, docs e site reduz a chance de citação. Fatos-âncora do produto (usar sempre a mesma forma):

- "paper trading por padrão, com graduação para live"
- "scam detection em 6 camadas + GoPlus + site-integrity + AI squad"
- "split 50/50 de lucro (reserva cold USDC / reinvestimento)"
- "envelope humano: risco 0.5% por trade default, kill switches sempre ativos"

### 3.4 Presença off-site

- GitHub público bem descrito (topics: `crypto`, `paper-trading`, `trading-bot`, `scam-detection`).
- Awesome lists relevantes (`awesome-trading`, `public-apis`) — só quando open-source for decisão; registraria em [ADR.md](./ADR.md).
- Sem astroturfing: nunca fabricar menções/avaliações — inconsistência é penalizada e fere [COMPLIANCE.md](./COMPLIANCE.md).

## 4. Rotina de medição (mensal)

1. Perguntar aos 4 motores: "o que é Auto Trader?", "Auto Trader é confiável?", "melhores bots de paper trading crypto".
2. Registrar: citado? correto? qual fonte ele usou?
3. Citação errada/falta de citação → tarefa em [TASKS.md](./TASKS.md) (fortalecer a superfície que o motor citou).
4. Checar Bing Webmaster (indexação) e logs de crawl dos bots de IA no Caddy.

---

**Relacionados:** [SEO.md](./SEO.md) · [AEO.md](./AEO.md) · [AIO.md](./AIO.md) · [RESEARCH.md](./RESEARCH.md) · [CONTENT.md](./CONTENT.md)
