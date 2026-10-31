# CONTENT — Conteúdo, i18n e Tom de Voz

> **Versão:** 1.0 — 2026-09-23
> **Superfícies:** dashboard (privado), login, pricing, privacy, terms (públicas), e2e cobre fluxo principal.

---

## 1. Tom de voz

1. **Honesto sobre risco primeiro:** nunca prometer lucro; o aviso de risco ("pode causar perda total", "não é aconselhamento financeiro") é sempre visível onde se fala de resultados.
2. **Técnico e direto:** operador é técnico; termos de trading em inglês (kill switch, drawdown, P&L) sem tradução forçada.
3. **Sem hype de "IA mágica":** descrever o que o sistema faz (heurísticas + modelos calibrados + envelope humano), não o que ele não faz.
4. **Modo imperativo só em ações destrutivas:** kill switch pede confirmação explícita.

## 2. i18n

| Idioma | Arquivo | Papel |
|---|---|---|
| pt-BR | `messages/pt-BR.json` | Fonte da verdade (idioma do projeto). |
| en-US | `messages/en-US.json` | Espelho obrigatório. |
| es-ES | `messages/es-ES.json` | Espelho obrigatório. |

Regras: string nova = entrada nos 3 arquivos no mesmo PR; chave por namespace de tela (`login.`, `dashboard.`, `pricing.`); placeholder interpolado, nunca concatenação.

## 3. Inventário de conteúdo por tela

| Tela | Conteúdo | Cuidado |
|---|---|---|
| Dashboard | Painéis: saldo, posições, P&L, histórico, scam audit, logs; kill switch; config editor | Estado do envelope (`mode.json`) legível; erros sem jargão interno. |
| Login | Form + credenciais de seed exibidas (dev) | Em produção, remover dica de credenciais. |
| Pricing | Planos (`src/lib/billing/plans.ts`) | Coerente com Stripe; sem promessa de retorno. |
| Privacy / Terms | LGPD/GDPR, aviso de risco, paper-first | Revisar a cada release ([COMPLIANCE.md](./COMPLIANCE.md)). |
| SEO público | canonical/OG/JSON-LD, robots, sitemap | Ver [SEO.md](./SEO.md). |

## 4. Documentação como conteúdo

- Docs em `docs/` seguem o mesmo tom; cabeçalho com versão/data; índice em [README.md](./README.md).
- `MANUAL_DO_OPERADOR.md` é o conteúdo de operação humana (kill switch, leitura de painéis).
- Qualquer mudança de comportamento documentado atualiza o doc no mesmo PR (regra do [STYLE_GUIDE.md](./STYLE_GUIDE.md)).

## 5. Checklist de PR com conteúdo

- [ ] 3 idiomas atualizados; sem string hardcoded.
- [ ] Aviso de risco preservado onde resultados/trading aparecem.
- [ ] Terms/privacy revisados se o fluxo de dados mudou.
- [ ] e2e com seletores/textos atualizados.

---

**Relacionados:** [ACCESSIBILITY.md](./ACCESSIBILITY.md) · [COMPLIANCE.md](./COMPLIANCE.md) · [SEO.md](./SEO.md)
