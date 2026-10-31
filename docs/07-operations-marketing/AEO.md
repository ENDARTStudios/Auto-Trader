# AEO — Answer Engine Optimization (Featured Snippets / Posição 0)

> **Versão:** 1.0 — 2026-09-23
> **Objetivo:** ser a **resposta extraída** do Google — featured snippet, People Also Ask, posição 0 — para queries como "o que é paper trading bot", "como detectar honeypot crypto", "auto trader crypto".
> **Doc guarda-chuva:** [SEO.md](./SEO.md) (§5.2) · irmãos: [AIO.md](./AIO.md), [GEO.md](./GEO.md)

---

## 1. Como answer engines escolhem a resposta

O extrator (Google/Bing) procura, **na página renderizada (SSR)**:

1. Um bloco que **responde a pergunta de forma direta e autocontida** (40–60 palavras).
2. Estrutura extraível: lista ordenada (passos), tabela (comparação), parágrafo curto (definição).
3. Sinal de confiança: heading da pergunta (`h2`/`h3`), schema `FAQPage`, página indexada e rápida.

## 2. Estado da implementação (2026-09-23)

| Base | Status | Onde |
|---|---|---|
| SSR (conteúdo no HTML) | ✅ | Next.js App Router — não usar `ssr:false` em conteúdo de resposta |
| Metadata por página | ✅ | `src/app/layout.tsx:37` (`metadataBase`, canonical, OG) |
| robots.txt | ⚠️ | **Duplicado:** `public/robots.txt` (estático, placeholder `your-domain.com`) × `src/app/robots.ts` (dinâmico, com `disallow /api/`) — consolidar (backlog [TASKS.md](./TASKS.md)) |
| sitemap.xml | ✅ mín. | `src/app/sitemap.ts` — 2 URLs; ampliar com páginas públicas |
| FAQPage JSON-LD | ❌ | Adicionar quando houver página de conteúdo/FAQ pública |

## 3. Táticas (padrão do projeto)

### 3.1 Formato pergunta → resposta

Toda página pública de conteúdo abre cada seção com:

```markdown
## Como funciona o scam detection?

O scam detection do Auto Trader cruza 6 camadas — turnover, liquidez,
contrato, holders, idade e auditoria GoPlus — antes de qualquer capital
ser simulado. Candidato com honeypot detectado é descartado e registrado
em ScamReport.          ← 40-60 palavras, autocontida, sem "veja acima"
```

### 3.2 Estruturas extraíveis

- **Passos** → `<ol>` (ex.: "Como o kill switch funciona em 4 passos").
- **Comparações** → `<table>` (ex.: paper vs live, camadas de detecção).
- **Definições** → parágrafo de 1–2 frases logo após o `h2` da pergunta.

### 3.3 FAQPage JSON-LD

```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "O que é o Auto Trader?",
    "acceptedAnswer": { "@type": "Answer", "text": "Auto Trader é um sistema autônomo de paper trading que descobre candidatos em CEX e DEX, filtra scams em 6 camadas e executa com circuit breakers e split 50/50 de lucro." }
  }]
}
```

Renderizar junto ao HTML da página que contém as mesmas perguntas visíveis (schema sem conteúdo visível = risco de ação manual).

## 4. Regras para novas páginas públicas

- [ ] `h1` único; perguntas como `h2` quando a página responde queries.
- [ ] Resposta direta de 40–60 palavras no topo de cada seção-questão.
- [ ] Conteúdo no HTML (SSR) — nada de resposta só no client.
- [ ] Tabelas/listas onde a resposta for enumerável.
- [ ] Canonical próprio ([SEO.md](./SEO.md) §6 — nunca localhost).
- [ ] strings nos 3 idiomas ([CONTENT.md](./CONTENT.md)) — snippet segue o locale do usuário.

## 5. Medição

| Métrica | Ferramenta |
|---|---|
| Queries com snippet ganho / posição 0 | Google Search Console (filtro "possui snippet") |
| Indexação das páginas de conteúdo | Search Console → URL Inspection |
| Render como o Google vê | `curl` no HTML + Search Console "Testar URL ao vivo" |

---

**Relacionados:** [SEO.md](./SEO.md) · [AIO.md](./AIO.md) · [GEO.md](./GEO.md) · [CONTENT.md](./CONTENT.md) · [ACCESSIBILITY.md](./ACCESSIBILITY.md)
