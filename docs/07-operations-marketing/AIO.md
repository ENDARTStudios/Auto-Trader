# AIO — AI Overviews (Google / Bing Copilot)

> **Versão:** 1.0 — 2026-09-23
> **Objetivo:** ser **citado dentro do AI Overview** do Google (e Copilot/Bing) quando a pergunta envolve trading bots, scam detection ou paper trading.
> **Doc guarda-chuva:** [SEO.md](./SEO.md) (§5.3) · irmãos: [AEO.md](./AEO.md), [GEO.md](./GEO.md)

---

## 1. Como o AI Overview monta a resposta

O AI Overview sintetiza a partir do **índice do Google** (não é um LLM navegando):

1. Páginas indexadas e rankeadas para a query (SEO é pré-requisito, não substituto).
2. Trechos **autocontidos** que sustentam uma afirmação sem contexto extra.
3. Sinais de **E-E-A-T** — experiência, expertise, autoridade, confiança — e dados estruturados.
4. Fontes citáveis que ele lista como "referências" (nosso alvo: aparecer nessa lista).

## 2. Estado da implementação (2026-09-23)

| Base | Status | Onde |
|---|---|---|
| Indexação básica (robots/sitemap/canonical) | ✅ | `src/app/layout.tsx:37-38`, `src/app/robots.ts`, `src/app/sitemap.ts` — caveat do robots duplicado em [AEO.md](./AEO.md) §2 |
| JSON-LD SoftwareApplication | ✅ | `src/app/layout.tsx:61-83` |
| E-E-A-T (autor/data nas páginas de conteúdo) | ❌ | Adicionar quando houver conteúdo público — `dateModified` no JSON-LD |
| Fontes citáveis com URL | parcial | Afirmações técnicas citam fontes nos docs; faltar espelhar nas páginas públicas |

## 3. Táticas (padrão do projeto)

### 3.1 E-E-A-T

- **Experiência:** mostrar que o sistema roda de verdade — métricas reais de paper (equity, ciclos), não claims ("somos os melhores" não é citável; "N ciclos paper com drawdown máximo X%" é).
- **Expertise:** cada afirmação técnica com fonte primária e URL:
  - Honeypot/risk score → GoPlus (`api.gopluslabs.io`)
  - Verificação de contrato → Etherscan family (`api.etherscan.io` etc.)
  - Preços CEX → Binance public REST (`api.binance.com/api/v3`)
  - Liquidez/volume DEX → DexScreener (`api.dexscreener.com`)
- **Confiança:** aviso de risco visível, terms/privacy, `AudLog`/transparência metodológica ([COMPLIANCE.md](./COMPLIANCE.md)).

### 3.2 Frases citáveis

Escrever em **frases autocontidas de 1–2 linhas** que uma IA pode extrair sem o resto do parágrafo:

> ✅ "O Auto Trader opera por padrão em modo paper, simulando ordens sem capital real até cumprir N ciclos lucrativos de graduação."
> ❌ "Além disso, ele também faz isso (como dito acima)."

### 3.3 Estrutura e frescor

- JSON-LD atualizado com `dateModified`; data de atualização visível na página.
- Tabelas/listas (o AI Overview extrai bem de structured data) — mesmas regras de [AEO.md](./AEO.md) §3.2.
- Páginas públicas com headings semânticos ([ACCESSIBILITY.md](./ACCESSIBILITY.md) §3 alimenta aqui também).

### 3.4 Consistência factual entre superfícies

A IA cruza fontes: o que dizem a página pública, `docs/`, README e o próprio código precisa bater (ex.: "6 camadas de scam detection", "split 50/50", "paper por padrão"). **Mudou o produto → mudam página, docs e README no mesmo PR** ([CONTENT.md](./CONTENT.md) §5).

## 4. Medição

| Métrica | Como |
|---|---|
| Aparição em AI Overviews | Manual: conjunto de queries-alvo semanal ("auto trader crypto", "how to detect honeypot token", "paper trading bot open source") + SERP API com `ai_overview` |
| Páginas citadas como referência | Anotar qual URL foi citada → reforçar/expandir essa página |
| Indexação/frescor | Search Console (páginas atualizadas reindexadas) |

---

**Relacionados:** [SEO.md](./SEO.md) · [AEO.md](./AEO.md) · [GEO.md](./GEO.md) · [CONTENT.md](./CONTENT.md) · [INTEGRATIONS.md](./INTEGRATIONS.md) (fontes com URL)
