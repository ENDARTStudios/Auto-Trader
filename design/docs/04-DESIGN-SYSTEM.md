# 04 · Design system — Meridian 1.0

Fonte de verdade: [`../tokens.json`](../tokens.json) (DTCG simplificado). O protótipo consome os mesmos valores em CSS custom properties; o arquivo FigCraft usa a mesma escala. Qualquer divergência é bug.

---

## 1. Cor

### Semântica

| Papel | Token | Dark | Light | Nunca usar para |
|---|---|---|---|---|
| Canvas | `bg` | `#0A0B0D` | `#F5F4F1` | — |
| Superfície 1 | `surface-1` | `#101216` | `#FFFFFF` | Texto |
| Superfície 2 | `surface-2` | `#16191F` | `#FAF9F6` | Fundo de página |
| Superfície 3 | `surface-3` | `#1D2129` | `#F0EEE9` | Texto essencial |
| Borda | `line` | `#23272F` | `#E4E1DA` | — |
| Texto | `text` | `#F2F4F7` | `#14161B` | Fundos grandes |
| Texto 2 | `text-2` | `#A7AFBC` | `#565E6C` | Texto < 12 px essencial |
| Texto 3 | `text-3` | `#6D7582` | `#7D8492` | Corpo de texto (só metadado) |
| Marca | `brand` | `#5B6CFF` | `#4353E0` | Lucro, status positivo |
| Lucro | `pos` | `#3DDC97` | `#0F9D63` | Marca, links |
| Perda | `neg` | `#FF6B81` | `#D92D4B` | Marca |
| Atenção | `warn` | `#F5B454` | `#A66A0B` | Ação primária |
| Crítico | `crit` | `#FF4D5E` | `#C11B2F` | Ênfase decorativa |

### Regras

1. **Marca ≠ lucro.** Ultramarine é ação/seleção; verde e vermelho são resultado.
2. **Cor nunca é o único canal.** Todo status tem rótulo textual ao lado do ponto/badge.
3. **Contraste mínimo:** 4.5:1 para texto < 18 px; 3:1 para texto grande e ícones. Os tokens acima foram validados no par `surface-1` e `bg`.
4. **Fundos de estado** usam 10–14% de opacidade da cor semântica (`--pos-soft`, etc.), nunca a cor cheia atrás de texto.
5. **Categóricos** (gráficos): ultramarine, cyan, âmbar, violeta, verde-água, coral — nesta ordem, com padrões de traço para daltonismo.

---

## 2. Tipografia

| Estilo | Família | Tamanho / linha | Peso | Uso |
|---|---|---|---|---|
| Display | Cambria / Source Serif 4 | 56 / 60 | 500 | Hero, onboarding, login |
| H1 | Inter | 32 / 40 | 600 | Título de página |
| H2 | Inter | 24 / 32 | 600 | Seção |
| H3 | Inter | 18 / 26 | 600 | Subseção, título de modal |
| Body | Inter | 14 / 22 | 400 | Texto |
| Body SM | Inter | 13 / 20 | 400 | Tabelas, descrições |
| Label | Inter | 12 / 16 | 500 | Rótulo de campo, aba |
| Caption | Inter | 11 / 14 | 500, `.06em`, caixa alta | Rótulo de métrica, cabeçalho de tabela |
| Numérico XL | Inter tabular | 40 / 44 | 600, `-0.02em` | Valor de equity |
| Numérico LG | Inter tabular | 28 / 32 | 600 | KPI |
| Mono | Cascadia Mono | 12 / 18 | 400 | IDs, hashes, latência |

**Regras**
- `font-variant-numeric: tabular-nums` em **todo** número.
- Sinal verdadeiro: `−` (U+2212) para negativo, `+` explícito para positivo em deltas.
- Caixa alta só em `caption` (rótulos), nunca em títulos.
- Máximo de 62 caracteres por linha em parágrafos (`max-width: 62ch`).

---

## 3. Espaço, raio e elevação

- Base **4 px**: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Padding de cartão: 20 px; seção interna: 16–18 px; página: 32 px (24 em ≤ 1200, 16 em ≤ 640).
- Raio: `6` controles pequenos, `8` botões e inputs, `12` cartões, `16` modais e gavetas, `20` superfícies grandes, `999` pílulas.
- **Sem sombra no app.** Elevação é feita por degraus de superfície + borda de 1 px. Sombra apenas em overlay (modal, gaveta, popover, paleta).

---

## 4. Movimento

| Token | Duração | Uso |
|---|---|---|
| `instant` | 90 ms | hover, foco, ripple |
| `fast` | 140 ms | cores, bordas |
| `base` | 200 ms | abrir/fechar pequeno |
| `slow` | 320 ms | gaveta, modal, página |
| Easing | `cubic-bezier(.2,.8,.2,1)` / `.16,1,.3,1` | entrada / saída |

- Nunca animar números de P&L (evita leitura errada); animar barras e anéis, com `prefers-reduced-motion` desligando tudo.
- Skeleton com shimmer de 1,6 s; nada de spinner em lista (só em ação pontual).

---

## 5. Componentes

### 5.1 Botões

| Variante | Fundo | Texto | Altura |
|---|---|---|---|
| Primary | `brand` | branco | 36 (32 compacto, 44 grande) |
| Secondary | `surface-2` + borda `line-strong` | `text` | idem |
| Ghost | transparente, hover `surface-2` | `text-2` | idem |
| Danger | `crit-soft` + borda 30% | `crit` | idem |
| Danger solid | `crit` | branco | idem (único por tela) |

Regras: 1 primário por tela; ícone de 16 px à esquerda com 7 px de gap; `disabled` com 45% de opacidade e sem clique; foco com `outline` de 2 px `brand` e offset 2 px.

### 5.2 Campos

Altura 38 px, raio 8, borda `line-strong`, fundo `surface-1`; foco com borda `brand` + anel de 3 px `brand-soft`; erro com borda `crit` e mensagem de 12 px abaixo; `label` sempre visível (nunca placeholder como rótulo); ícone à esquerda em `input-wrap`.

### 5.3 Navegação

- Item de rail: 34 px, ícone 17, rótulo 13, ativo = `surface-2` + barra de 2 px `brand` + ícone colorido.
- Aba: 38 px, sublinhado de 2 px no ativo, contador em badge.
- Segmented: trilho de 3 px, botão ativo em `surface-1` com sombra de 1 px.

### 5.4 Dados

- **Tabela:** cabeçalho `caption` 10,5 px, linha 44 px (compacta 36), números à direita e tabulares, hover `surface-2`, primeira coluna com avatar + par + nome, ações reveladas no hover (e sempre visíveis em toque).
- **KPI:** rótulo `caption`, valor 26–28 px, rodapé 11,5 px com delta e contexto; nunca mais de 6 por faixa.
- **Badge:** 20 px, 11 px, raio 5; `pill` para status de entidade.
- **Delta:** seta + valor + unidade; cor só do texto, sem fundo.
- **Medidor:** trilho 6 px, preenchimento arredondado; cor semântica quando o valor é um limite.
- **Anel:** progresso circular para rodada/confiança, texto central em 11 px.

### 5.5 Overlays

| Componente | Largura | Quando |
|---|---|---|
| Gaveta | 420 / 520 / 680 | Detalhe de entidade sem perder contexto |
| Modal | 440 / 560 / 720 | Confirmação, criação, formulário curto |
| Paleta | 620 | Navegação e ações (⌘K) |
| Toast | 340 | Resultado de ação, 4,2 s, canto inferior direito |

Regras: `Esc` fecha; clique no scrim fecha (exceto modal destrutivo); foco preso; retorno de foco ao gatilho; título sempre em `<h3>`.

### 5.6 Estados

`empty` (ilustração de 120×88 + título + 1 frase + 1 ação + 1 escape), `skeleton` (geometria igual ao conteúdo), `error` (o que aconteceu + o que fazer), `loading` (nunca bloqueia a tela inteira).

---

## 6. Visualização de dados

- **Área/linha:** 1,8 px; gradiente vertical de 28% → 0% da cor semântica; benchmark tracejado 3-4 em `text-3`.
- **Candles:** corpo 64% do slot, pavio 1 px, volume a 14% de opacidade.
- **Eixos:** 10 px, `axis`, 4 linhas horizontais tracejadas 2-4; rótulos Y em formato compacto (`$21.2K`), X com no máximo 7 marcas.
- **Interação:** crosshair + tooltip com valor e data; tooltip posicionado acima do ponto, nunca cortado pela borda.
- **Sem pizza além de 5 fatias**; donut só para alocação; heatmap para tempo × dia.
- **Acessibilidade:** tabela alternativa (`<details>`) com os mesmos dados; `role="img"` + `aria-label` descritivo; cores com padrão de traço.

---

## 7. Ícones e ilustração

- Ícones de traço 24×24, `stroke-width` 1,75, cantos arredondados, herdam `currentColor`.
- Um ícone nunca aparece sozinho em navegação primária.
- Ilustrações de estado vazio: linha 1,5 px em `text-3` com 28% de opacidade; sem personagens, sem 3D.
- Marca: tile com gradiente e sinal ascendente; versão monocromática para favicon e contextos de 16 px.

---

## 8. Acessibilidade (WCAG 2.2 AA)

| Requisito | Implementação |
|---|---|
| Contraste | tokens validados; `text-3` só em metadados |
| Foco | `:focus-visible` com anel de 2 px e offset |
| Teclado | rail, abas (setas), paleta, gaveta, modais |
| Alvos | mínimo 24×24 px (40 px na prática) |
| Semântica | `<nav>`, `<main>`, `<header>`, `<footer>`, tabelas com `<th scope>` |
| Status dinâmico | `aria-live="polite"` para preço, `assertive` para risco |
| Movimento | `prefers-reduced-motion` desliga animações |
| Texto | zoom de 200% sem perda de conteúdo |
| Formulários | `label` associado, erro com `aria-describedby`, `autocomplete` |

---

## 9. Densidade e responsividade

- **Comfortable** (padrão): linhas de 44 px, padding 20.
- **Compact**: linhas 36 px, padding 16, fonte 12,5 — para operadores em 1080p.
- Breakpoints: 1680, 1440, 1200, 900, 640.
  - ≤ 1200: colunas secundárias caem para baixo; 3 → 2 colunas.
  - ≤ 900: rail vira gaveta; topbar esconde breadcrumb; grids de página em 1 coluna.
  - ≤ 640: tabelas viram cartões empilhados, ações sempre visíveis, KPIs em 2 colunas.

---

## 10. Conteúdo

- Frases curtas, voz ativa, sem “por favor”.
- Números sempre com unidade e janela (“+14.42% · 30d”, “$20ms p50”).
- Erros dizem o próximo passo: “RPC timeout — we retried 3 times. Showing cached prices from 14:02.”
- Nunca culpar o usuário; nunca usar “Oops”.
- Termos do domínio têm definição no primeiro uso (tooltip + doc).

---

## 11. Governança

- Token novo entra em `tokens.json`, no CSS e no FigCraft na mesma PR.
- Componente novo exige: estados (default/hover/active/focus/disabled/loading/error), uso, anti-uso e teste visual.
- Toda tela nova precisa dos 7 estados: default, vazio, carregando, erro, permissão, offline, sucesso.
- Revisão de acessibilidade automatizada (`@axe-core/playwright`) bloqueia merge.
