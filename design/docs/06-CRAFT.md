# 06 · Craft pass — skills aplicadas e o que mudou

Depois do conceito, o protótipo passou por uma revisão de craft guiada por quatro repositórios de skills, e por uma bateria de testes automatizados. Este documento registra **o que foi aplicado, o que mudou e como foi verificado**.

## Fontes

| Skill | Origem | O que foi extraído |
|---|---|---|
| **Emil Kowalski — design engineering** | [github.com/emilkowalski/skills](https://github.com/emilkowalski/skills) (`emil-design-eng`, `review-animations`, `mobile-native`, `break-ui`) | Framework de decisão de animação (frequência → anima ou não), curvas fortes, durações, `:active`, origem de popover, interruptibilidade, GPU-only, reduced motion, hover gating |
| **Impeccable** | [github.com/pbakaus/impeccable](https://github.com/pbakaus/impeccable) (`SKILL.src.md`, `reference/craft-floor.md`) | Modo do produto (Operate/Read/Persuade), piso de qualidade: contraste ≥4,5:1, medida de texto 65–75ch, tracking ≥−0,04em, estados completos, superfícies do navegador, bans (eyebrow, card-grid idêntico, glyph como ícone, glow, glass decorativo) |
| **Taste Skill** | [github.com/Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | "Inventory before style", regra de manchete em ≤2 linhas, sem labels acima de título, sem 01/02/03, no violeta de default, no sombra em repouso, crítica do próprio render |
| **Playwright** | [github.com/microsoft/playwright](https://github.com/microsoft/playwright) | Suíte real de verificação: rotas, overflow, teclado, contraste e axe-core |

> As skills são material externo de referência. Nenhum texto delas foi copiado para o produto; o que entrou foi o **critério**.

---

## Findings → correções

Formato de revisão exigido pela skill do Emil (tabela Before/After/Why).

| Before | After | Why |
|---|---|---|
| Eyebrow acima de cada título (`Paper · Engine running` sobre “Mission control”) | Status ao lado do título (`.page-title-row` + `.page-status`) | Eyebrow é banido no craft floor: o título carrega o próprio peso |
| `.btn:active { transform: translateY(.5px) }` | `:active { transform: scale(0.97) }` com `transform 160ms var(--ease-out-strong)` | Botão precisa confirmar o toque; 0,5 px é imperceptível |
| `transition: all` em chip e card de escolha | Propriedades explícitas (background, border-color, color, box-shadow) | `all` anima propriedades fora da GPU e gera recálculo inesperado |
| Paleta `⌘K` com fade 200 ms + translate 300 ms | Sem animação (`transition: none`) | Ação de teclado, 100+ vezes/dia: animação atrasa e desconecta |
| Toast com `@keyframes toast-in` | Transition + `@starting-style`, saída em 160 ms | Toasts chegam rápido e podem ser interrompidos; keyframes reiniciam do zero |
| `.meter > span { width: X% }` animado | `transform: scaleX(var(--p))` com `transform-origin: left` | Largura dispara layout; transform roda na GPU |
| `.alerts-mini .severity` — barra colorida de 3 px | Ícone de severidade em quadrado de 26 px | Faixa lateral colorida em card é banida pelo craft floor |
| `--text-3: #6D7582` em legendas de 10–11 px | `#7E8795` dark (5,1:1) e `#626A78` light (5,0:1) | Contraste de texto normal precisa de 4,5:1 |
| Botão primário `#5B6CFF` + texto branco (4,17:1) | `--brand-solid: #4A57E0` (5,63:1) para superfícies preenchidas | Marca como texto passa (4,72:1); como fundo de botão não passava |
| Kill switch disparava no primeiro clique | Modal exige digitar `HALT`; botão começa `disabled` | Ação irreversível precisa de confirmação tipada |
| Ícones de ação só com `data-tip` | `aria-label` derivado do tooltip em todos os `.icon-btn` | Botão sem nome acessível (axe: critical) |
| `<div class="dl"><dt>…` | `<dl class="dl"><dt>…` | `dt/dd` fora de `dl` quebra a semântica (axe: serious) |
| Progress bars sem nome | `meter(pct, tone, label)` com `aria-label` | `role="progressbar"` exige nome acessível |
| Tabelas roláveis inacessíveis por teclado | `.table-wrap` com `tabindex="0"` e `aria-label` | Região rolável precisa ser focável |
| Placeholder em `--text-3` | `--text-2` com opacidade 1 | Placeholder é texto e precisa de 4,5:1 |
| Gráfico aparecia estático | Uma única “momento autoral”: a linha da equity se desenha em 620 ms (`stroke-dashoffset`, uma vez) | Craft floor pede um momento autoral, não efeitos espalhados |
| `100vh` no shell | `100dvh` com fallback | Barra do navegador móvel cortava a telemetria |
| Inputs 38 px em 390 px | 16 px de fonte em ≤640 px | iOS dá zoom ao focar campo com fonte <16 px |
| Hover preso no toque | `@media (hover: none)` neutraliza hover de tabela/listas | Hover “gruda” depois do tap |
| Telemetria sem safe area | `env(safe-area-inset-bottom)` | Home indicator do iPhone cobria o rodapé |

### O que foi deliberadamente **não** animado

- Navegação entre páginas (alta frequência): sem fade de tela inteira.
- Números de P&L: nunca contam de um valor a outro (leitura financeira errada).
- Tooltips: aparecem sem delay no primeiro hover do grupo, instantâneos nos seguintes.
- Nenhum `ease-in` em elemento de UI; nenhuma entrada de `scale(0)`.

---

## Verificação automatizada (Playwright)

`design/tests/prototype.spec.ts` + `playwright.config.ts` rodam contra o servidor estático:

```powershell
cd design/tests
npx playwright test
```

Cobertura: **49 testes**, todos verdes.

| Grupo | Testes | O que garante |
|---|---|---|
| Renderização | 22 | Cada rota monta shell, título e **zero erros de console** |
| Responsivo | 18 | 6 telas × 390/768/1440 px **sem overflow horizontal** |
| Teclado | 2 | `⌘K` abre/fecha; paleta navega para rota; sem animação em ação de teclado |
| Fluxo crítico | 1 | Kill switch desabilitado até digitar `HALT`; toast após confirmar |
| Movimento | 2 | Meter anima `transform` e não `width`; botão anima `transform` no press |
| Acessibilidade | 4 | axe-core (WCAG 2.1 AA): **zero violações serious/critical** em overview, markets, risk e login |

Saída: `49 passed (48.1s)`.

---

## Ferramentas de desktop usadas

| Ferramenta | Artefato | Caminho |
|---|---|---|
| **FigCraft Desktop** | Arquivo editável com 14 frames; 1.754 comandos gerados por código | [`../figcraft/autotrader-meridian.figcraft`](../figcraft/autotrader-meridian.figcraft) |
| **VectorCraft** | Card social 1200×630 em vetor (tipografia + marca), SVG, PNG e fonte `.vectorcraft` | [`../brand/exports/social-card.svg`](../brand/exports/social-card.svg) |
| **DesignCraft** | Contact sheet A4 para revisão impressa: 12 telas com legendas, exportado em PDF | [`../brand/exports/contact-sheet.pdf`](../brand/exports/contact-sheet.pdf) |
| **PhotoCraft** | Recorte 1200×630 da interface para preview social (OG) | [`../brand/exports/og-product.png`](../brand/exports/og-product.png) |
| **PdfCraft** | Inspeção/validação dos PDFs (10 páginas no deck, 1 no contact sheet) e render para revisão | — |
| **ego-browser** | Auditoria do app atual, capturas das 22 telas, light/dark, mobile e overlays | [`../prototype/shots/`](../prototype/shots) |

### Replit

O protótipo é estático e sem build. O pacote [`../replit/autotrader-meridian-replit.zip`](../replit/autotrader-meridian-replit.zip) contém `index.html`, `assets/` e um `.replit` que serve a pasta na porta 8080 — importável como projeto estático no Replit sem configuração adicional. (A publicação exige uma conta Replit; o pacote está pronto para o upload.)

---

## Limites e próximos passos

- A skill **mobile-native** foi aplicada nos pontos de CSS; um teste em aparelho físico (drawer por toque, safe areas reais) segue recomendado.
- O deck e o contact sheet foram regerados com as capturas pós-craft; o arquivo FigCraft também.
- Próxima rodada de craft deve atacar **conteúdo real** (números do banco em vez de mock) e **densidade compacta**, que ainda não têm cobertura de teste visual.
