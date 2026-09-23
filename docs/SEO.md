# SEO, AEO, AIO e GEO — Estrutura Completa

> **Versão:** 1.2 — 2026-09-23 (v1.0 — 2026-08-26 · v1.1 cross-links · v1.2 checklist §2 sincronizado com a implementação real + pilares viraram docs dedicados)
> **Pilares:** SEO (Google), AEO (Answer Engines), AIO (AI Overviews), GEO (Generative Engine Optimization)
> **Princípio:** O Google precisa descobrir, entender e confiar nas páginas. IAs precisam citar.
> **Pilares detalhados:** [AEO.md](./AEO.md) · [AIO.md](./AIO.md) · [GEO.md](./GEO.md)
> **Relacionados:** [CONTENT.md](./CONTENT.md) (conteúdo/i18n) · [ACCESSIBILITY.md](./ACCESSIBILITY.md) (headings) · índice em [README.md](./README.md)

---

## 1. Objetivos

| Pilar | Objetivo | Métrica |
|---|---|---|
| **SEO** | Rankear para "auto trader crypto", "paper trading bot", "scam detector crypto" | Posição média Search Console, CTR, impressões |
| **AEO** | Ser resposta em featured snippet / People Also Ask | % de queries com snippet, posição 0 |
| **AIO** | Ser citado em Google AI Overviews / Bing Chat | Menções em AI Overviews (manual + SERP API) |
| **GEO** | Ser citado por ChatGPT / Perplexity / Claude quando perguntam sobre trading bots | Share of voice em LLMs (Perplexity, ChatGPT) |

---

## 2. Inventário Técnico — Checklist

| Item | Onde | Status | Como verificar |
|---|---|---|---|
| **Title** (50-60 chars, único por página) | `src/app/layout.tsx` `metadata.title` + por rota | ✅ base, precisa por rota | `curl -s http://localhost:3000 \| grep -o '<title>.*</title>'` |
| **Description** (120-160 chars) | `metadata.description` | ✅ base | `curl -s http://localhost:3000 \| grep -o 'name="description".*'` |
| **Canonical** | `metadata.alternates.canonical` | ✅ implementado | `src/app/layout.tsx:38` — conferir domínio real em prod (`metadataBase`) |
| **Open Graph** | `metadata.openGraph` | ✅ implementado | `src/app/layout.tsx:39-47` (com locale por idioma) |
| **Twitter Card** | `metadata.twitter` | ✅ implementado | `src/app/layout.tsx:48-53` (`summary_large_image`) |
| **JSON-LD (Structured Data)** | `<script type="application/ld+json">` em layout | ✅ implementado | `src/app/layout.tsx:61-83` (SoftwareApplication) — ampliar com FAQPage ([AEO.md](./AEO.md)) |
| **robots.txt** | `public/robots.txt` **ou** `src/app/robots.ts` | ⚠️ duplicado | `public/robots.txt` estático (placeholder `your-domain.com`, sem `disallow /api/`) conflita com `src/app/robots.ts` dinâmico — consolidar num só source (backlog [TASKS.md](./TASKS.md)) |
| **sitemap.xml** | `src/app/sitemap.ts` | ✅ mínimo | 2 URLs (`/` + `/api/health`) — ampliar com páginas públicas (`/pricing`, `/privacy`, `/terms`) |
| **llms.txt** | `public/llms.txt` | ❌ não existe | Padrão llmstxt.org — ver [GEO.md](./GEO.md) §3.1 |
| **Viewport + lang** | `layout.tsx` `<html lang="pt-BR">` | ✅ `lang="pt-BR"` ok | View source |
| **H1 único** | `page.tsx` | ⚠️ verificar | Só 1 H1 por página |
| **Imagens com alt** | `next/image` | ⚠️ verificar | Auditar `alt=""` |
| **Core Web Vitals** | Lighthouse | ⚠️ rodar | `npx lighthouse http://localhost:3000 --view` |

---

## 3. Structured Data (JSON-LD)

```tsx
// src/app/layout.tsx — adicionar dentro de <head> ou via metadata
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Auto Trader — Autonomous Crypto Paper Trading',
    template: '%s | Auto Trader',
  },
  description: 'Sistema autônomo de trading com scam detection multicamada, circuit breakers e split 50/50. Paper trading por padrão.',
  keywords: ['auto trader', 'crypto trading bot', 'paper trading', 'scam detector', 'autonomous trading'],
  authors: [{ name: 'Auto Trader' }],
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Auto Trader — Autonomous Crypto Paper Trading',
    description: 'Scam detection multicamada, circuit breakers, split 50/50. Paper mode default.',
    url: '/',
    siteName: 'Auto Trader',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Auto Trader Dashboard' }],
    locale: 'pt_BR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Auto Trader — Autonomous Crypto Paper Trading',
    description: 'Scam detection multicamada, circuit breakers, split 50/50.',
    images: ['/og-image.png'],
  },
  robots: { index: true, follow: true },
  verification: {
    google: 'GOOGLE_SITE_VERIFICATION_TOKEN', // Search Console
  },
};

// JSON-LD — SoftwareApplication + Organization
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Auto Trader',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  description: 'Sistema autônomo de trading de criptomoedas com scam detection multicamada.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  creator: { '@type': 'Organization', name: 'Auto Trader', url: 'https://your-domain.com' },
};

// Em layout.tsx <head>:
// <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
```

---

## 4. robots.txt + sitemap.ts

```ts
// src/app/robots.ts
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/_next/', '/private/'],
      },
    ],
    sitemap: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'}/sitemap.xml`,
  };
}

// src/app/sitemap.ts
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com';
  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.5 },
    // Adicionar rotas públicas futuras: /login, /pricing, etc.
  ];
}
```

---

## 5. Táticas por Pilar

### 5.1 SEO (Google)

| Tática | Implementação |
|---|---|
| **Conteúdo único por rota** | Cada rota (`/`, `/login`, `/docs`) tem title/description/canonical únicos |
| **Semântica HTML** | `header`, `main`, `section`, `article`, `footer` — não só `div` |
| **Imagens otimizadas** | `next/image` com `alt`, `width/height`, `priority` para LCP |
| **Link interno** | Navegação entre panels com `next/link` (não `a` cru) |
| **Performance** | Lighthouse >90 — ver `docs/LINT.md` + `next.config.ts` `images` + `compress` |
| **Mobile-first** | Testar 375/390/768 — sem overflow, sem modal cortado |

### 5.2 AEO (Answer Engines — Featured Snippet)

| Tática | Implementação |
|---|---|
| **Pergunta → Resposta direta** | No topo de cada seção, 1 parágrafo de 40-60 palavras respondendo "o que é / como funciona" |
| **Listas e tabelas** | Usar `<ol>`, `<ul>`, `<table>` para passos e comparações (Google extrai) |
| **FAQ com FAQPage schema** | `FAQPage` JSON-LD com `Question` + `Answer` para "O que é Auto Trader?", "Como funciona scam detection?" |

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "O que é o Auto Trader?",
      "acceptedAnswer": { "@type": "Answer", "text": "Auto Trader é um sistema autônomo de paper trading que descobre candidatos em CEX e DEX, filtra scams em 6 camadas e executa com circuit breakers e split 50/50 de lucro." }
    }
  ]
}
```

### 5.3 AIO (Google AI Overviews)

| Tática | Implementação |
|---|---|
| **E-E-A-T** | Autor visível, data de atualização, fontes citadas (ScamReport, GoPlus, Etherscan) |
| **Conteúdo citável** | Frases autocontidas de 1-2 linhas que uma IA pode citar sem contexto |
| **Dados estruturados** | JSON-LD + tabelas + listas (AI Overviews extrai de structured data) |

### 5.4 GEO (ChatGPT / Perplexity / Claude)

| Tática | Implementação |
|---|---|
| **Markdown + llms.txt** | `public/llms.txt` (padrão emergente) com resumo do site para LLMs |
| **Conteúdo em markdown** | Docs em `docs/*.md` já são GEO-friendly (LLMs treinam em markdown) |
| **Citações e fontes** | Cada afirmação com fonte (ex: "Binance REST api.binance.com", "DexScreener api.dexscreener.com") |
| **Presença em Awesome lists** | Submeter para `github.com/sindresorhus/awesome`, `github.com/public-apis/public-apis` se aplicável |

```txt
# public/llms.txt — https://llmstxt.org
# Auto Trader — llms.txt

> Sistema autônomo de paper trading de cripto com scam detection multicamada e circuit breakers.

## Docs

- [PRD](https://your-domain.com/docs/PRD.md): visão do produto
- [Arquitetura](https://your-domain.com/docs/ARCHITECTURE.md): módulos e feature flags
- [Hardening](https://your-domain.com/docs/CRYPTO.md): garantias criptográficas
```

---

## 6. Erros Comuns a Evitar

| Erro | Por que é ruim | Como evitar |
|---|---|---|
| `noindex` acidental em prod | Google não indexa | `robots: { index: true }` em prod; `false` só em staging |
| `canonical` apontando para localhost | Sinaliza URL errada | `metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL)` |
| Title duplicado em todas as páginas | Google vê como conteúdo duplicado | `title.template: '%s \| Auto Trader'` + por rota |
| Imagem sem `alt` | Perde SEO de imagem + a11y | `alt` obrigatório em `next/image` (lint `jsx-a11y/alt-text`) |
| `robots.txt` bloqueando `/` | Bloqueia tudo | Testar `https://domain.com/robots.txt` — deve ter `Allow: /` |
| Sitemap com URL quebrada | Google ignora sitemap | `curl https://domain.com/sitemap.xml` deve ser XML válido |
| Conteúdo só em JS (sem SSR) | Google pode não renderizar | Next.js App Router já é SSR por padrão — não usar `ssr:false` em conteúdo SEO |

---

## 7. Métricas e Ferramentas

| Ferramenta | O que mede | URL |
|---|---|---|
| **Google Search Console** | Impressões, CTR, posição, indexação | https://search.google.com/search-console |
| **Bing Webmaster** | Indexação Bing (usado por ChatGPT) | https://www.bing.com/webmasters |
| **Lighthouse** | Performance, SEO, a11y | `npx lighthouse http://localhost:3000 --view` |
| **Screaming Frog** | Crawl completo (títulos, meta, links quebrados) | https://www.screamingfrog.co.uk + MCP `github.com/bzsasson/screaming-frog-mcp` |
| **Open SEO** | CLI de auditoria | `github.com/every-app/open-seo` |
| **Strix** | SEO CLI | `github.com/usestrix/strix` |
| **Perplexity** | GEO — perguntar "o que é Auto Trader?" e ver se cita | https://perplexity.ai |
| **ChatGPT** | GEO — idem | https://chat.openai.com |

**CLI rápido:**

```bash
npx lighthouse http://localhost:3000 --only-categories=seo --view
npx open-seo audit https://your-domain.com
npx strix audit https://your-domain.com
```

---

## 8. Verificação

```bash
# Metatags
curl -s http://localhost:3000 | grep -E '<title>|name="description"|rel="canonical"|property="og:'

# robots + sitemap
curl -s http://localhost:3000/robots.txt
curl -s http://localhost:3000/sitemap.xml | head -20

# JSON-LD
curl -s http://localhost:3000 | grep -o 'application/ld+json.*</script>'

# Lighthouse SEO
npx lighthouse http://localhost:3000 --only-categories=seo --output=json | jq '.categories.seo.score'

# Google consegue descobrir?
# Search Console → URL Inspection → Test live URL → deve ser "URL is on Google"
```
