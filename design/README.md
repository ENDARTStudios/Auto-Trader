# Auto Trader — Meridian (UI/UX concept v1.0)

Redesign completo da interface do Auto Trader: arquitetura de informação, design system, protótipo navegável com 22 telas e arquivo de design editável.

> **Branch:** `design/uiux-concept-v2` (exclusiva: nada fora de `design/` e `docs/` foi alterado)
> **Data:** 01/11/2026 · **Escopo:** UI/UX conceitual, sem migração funcional

---

## O que abrir primeiro

| Entrega | Caminho | Para quê |
|---|---|---|
| **Protótipo navegável** | [`prototype/index.html`](prototype/index.html) | Ver e clicar em todas as telas, dark/light, mobile |
| **Arquivo de design** | [`figcraft/autotrader-meridian.figcraft`](figcraft/autotrader-meridian.figcraft) | Editar no FigCraft Desktop (14 frames editáveis) |
| **Renders das telas** | [`figcraft/renders/`](figcraft/renders) | Revisão rápida sem abrir ferramenta |
| **Marca** | [`brand/exports/`](brand/exports) | Logo em PNG/SVG (tile, mark, wordmark) |
| **Apresentação (PDF)** | [`deck/autotrader-meridian.pdf`](deck/autotrader-meridian.pdf) | Contexto para stakeholders (10 slides) |
| **Auditoria** | [`docs/01-AUDIT.md`](docs/01-AUDIT.md) | Por que a versão atual falha (com evidências) |
| **Conceito** | [`docs/02-CONCEPT.md`](docs/02-CONCEPT.md) | Princípios, IA, marca, fluxos, antes/depois |
| **Páginas** | [`docs/03-PAGES.md`](docs/03-PAGES.md) | Especificação das 22 telas + estados |
| **Design system** | [`docs/04-DESIGN-SYSTEM.md`](docs/04-DESIGN-SYSTEM.md) | Tokens, componentes, acessibilidade |
| **Implementação** | [`docs/05-IMPLEMENTATION.md`](docs/05-IMPLEMENTATION.md) | Rotas Next.js, componentes, fases |

---

## Como rodar o protótipo

É HTML/CSS/JS puro, sem build:

```powershell
# na raiz do repositório
python -m http.server 4173 --bind 127.0.0.1
# abra http://127.0.0.1:4173/design/prototype/
```

Rotas por hash: `#/overview`, `#/markets`, `#/markets/SOL` → `#/token/SOL`, `#/portfolio`, `#/position/SOL`, `#/strategy`, `#/backtest`, `#/analytics`, `#/journal`, `#/risk`, `#/copilot`, `#/alerts`, `#/data`, `#/settings`, `#/billing`, `#/admin`, `#/design`, `#/landing`, `#/login`, `#/signup`, `#/reset`, `#/onboarding`.

Atalhos: `⌘K` / `Ctrl+K` paleta de comandos · `Esc` fecha overlays · botão de tema no topbar.

## Como abrir o arquivo de design

```powershell
# abrir no app
& "C:\Program Files\FigCraft\figcraft.exe" "D:\PROJETOS\Auto Trader\Auto Trader\design\figcraft\autotrader-meridian.figcraft"

# regerar a partir do código-fonte do design
node design/tools/figcraft-build.mjs
& "C:\Program Files\FigCraft\figcraft-cli.exe" run design/figcraft/script.json --out design/figcraft/autotrader-meridian.figcraft
& "C:\Program Files\FigCraft\figcraft-cli.exe" export design/figcraft/autotrader-meridian.figcraft --out design/figcraft/renders
```

O arquivo é **gerado por código** (`design/tools/figcraft-lib.mjs` + `figcraft-build.mjs` + `screens-extra.mjs`), então o design e o protótipo evoluem juntos.

---

## Conteúdo

```
design/
├── tokens.json                 # fonte de verdade (cor, tipo, espaço, raio, movimento)
├── tokens.css                  # tokens como CSS custom properties
├── prototype/
│   ├── index.html              # SPA do protótipo
│   ├── assets/
│   │   ├── base.css            # reset, shell, tipografia
│   │   ├── components.css      # primitivos e overlays
│   │   ├── views.css           # composição por página + responsivo
│   │   ├── icons.js            # ícones de traço 24×24
│   │   ├── charts.js           # área, candle, donut, gauge, depth
│   │   ├── ui.js  data.js      # helpers e dados de demonstração
│   │   ├── app.js              # shell, rotas, paleta, overlays
│   │   └── pages/*.js          # 22 telas
│   └── shots/                  # 29 capturas (desktop, mobile, light, overlays)
├── figcraft/
│   ├── autotrader-meridian.figcraft
│   ├── script.json             # script de geração (1.756 comandos)
│   └── renders/                # 14 frames em PNG
├── tools/                      # geradores do arquivo FigCraft
└── docs/                       # auditoria, conceito, páginas, design system, implementação
```

---

## As 22 telas

Público: landing · pricing · login · signup · reset · onboarding
Operate: overview · markets · token detail · portfolio · position detail · strategy · backtest · analytics · journal
Guard: risk & safety · AI copilot
System: alerts · data & sources · settings · billing · admin

---

## Decisões que definem o conceito

1. **Uma pergunta por tela** — a home de 5.284 px virou 7 rotas com propósito único.
2. **Marca ultramarine, lucro verde** — a cor deixa de ter três significados ao mesmo tempo.
3. **Kill switch isolado** — só em Risk & safety (e na paleta), com confirmação tipada `HALT`.
4. **Tudo endereçável** — token, posição, trade e rodada têm URL própria.
5. **Explicação como produto** — cada decisão tem gates, confiança e invalidação; o Copilot cita a fonte.
6. **Instrumento calmo** — sem sombras no app, hierarquia por superfície e tipografia, verde/vermelho reservados a resultado.
7. **Responsivo de verdade** — 390 px sem overflow; tabelas densas viram cartões.

---

## O que este trabalho não faz

- Não altera o comportamento do produto, APIs, banco ou autenticação.
- Não migra as telas reais para o novo layout (o plano está em `docs/05-IMPLEMENTATION.md`).
- Não mexe em outras branches, PRs ou no arquivo `scripts/prod-visual-check.mjs` que já existia no workspace.
