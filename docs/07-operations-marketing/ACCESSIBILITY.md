# ACCESSIBILITY — Acessibilidade (a11y) e i18n

> **Versão:** 1.0 — 2026-09-23
> **Base:** componentes shadcn/ui sobre Radix primitives (acessíveis por construção) + i18n em 3 idiomas.

---

## 1. Princípios

1. **Semântica primeiro:** HTML correto antes de ARIA; Radix resolve foco/teclado/popover.
2. **Teclado sempre:** todo fluxo operacional (kill switch, config) operável sem mouse.
3. **Contraste:** pares de cor do Tailwind usados respeitam WCAG AA em texto.
4. **Motion com respeito:** animações são sutis (`fadeInUp` etc. — ver [MOTION.md](./MOTION.md)); `prefers-reduced-motion` deve ser respeitado em novas animações.
5. **Feedback não só por cor:** estados de risco/erro usam ícone + texto, não só vermelho.

## 2. i18n

- Arquivos: `messages/pt-BR.json` (fonte), `messages/en-US.json`, `messages/es-ES.json` (`src/lib/i18n/`).
- **Nada de string de UI hardcoded** em componentes; texto novo entra nos 3 idiomas no mesmo PR.
- Datas/números formatados por locale; conteúdo de trading (tokens, siglas) permanece em inglês técnico.

## 3. Checklist para PRs com UI

- [ ] Navegação por teclado testada (tab order sensato, foco visível).
- [ ] Labels associados a inputs; erros de formulário anunciados (Zod + mensagens i18n).
- [ ] Diálogos (Radix) com foco preso e retorno de foco.
- [ ] Tabelas do dashboard com headers `<th>`; dados densos com `aria-label` de contexto.
- [ ] Botões críticos (kill switch) com confirmação (`AlertDialog`) — protege também contra acionamento acidental.
- [ ] Novas strings nos 3 arquivos de `messages/`.
- [ ] e2e atualizado se o fluxo mudou (`e2e/*.spec.ts` — chromium + mobile Pixel 7).

## 4. O que vigiar (audit contínuo)

- Painéis com dados ao vivo (SSE): atualizações não devem roubar foco.
- Dashboard denso: zoom 200% sem quebra de layout (responsivo mobile já coberto no Playwright `mobile` project).
- Páginas públicas (privacy/terms/pricing) com estrutura de headings correta — também alimenta [SEO.md](./SEO.md).

---

**Relacionados:** [DESIGN.md](./DESIGN.md) · [CONTENT.md](./CONTENT.md) · [MOTION.md](./MOTION.md) · [SEO.md](./SEO.md)
