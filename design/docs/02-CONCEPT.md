# 02 · Conceito — “Meridian”

> **Meridian** é o nome do redesign. Um meridiano é a linha de referência usada para medir altura e posição — a metáfora certa para um produto cujo valor é *saber onde você está*.

---

## Posicionamento

**Antes:** “Institutional crypto trading OS” — um terminal denso que presume que o usuário já sabe operar.
**Depois:** *Autonomous crypto trading, with a risk officer built in.* — um sistema que opera sozinho, mas **presta contas**.

O produto não vende “mais sinais”. Vende **disciplina verificável**: cada decisão tem gates, confiança, tamanho e condição de invalidação registrados. A interface existe para tornar essa disciplina visível.

### Público

1. **Operador solo** (primário) — 1 a 3 contas, acompanha pelo celular, quer confiar sem ler código.
2. **Pequeno desk** (secundário) — 2 a 5 pessoas, precisa de papéis, auditoria e revisão.
3. **Avaliador curioso** (topo de funil) — quer entender em 60 segundos por que isso é diferente de um bot de Telegram.

---

## Os sete princípios

1. **Calmo por padrão, alto só no perigo.** A interface é silenciosa. Somente risco, perda e bloqueio podem usar vermelho e movimento.
2. **Uma pergunta por tela.** Cada página responde a uma única pergunta de operador; o resto vira detalhe sob demanda.
3. **Números são o produto.** Tabulares, alinhados à direita, com sinal verdadeiro (− não -), unidade e janela de tempo sempre visíveis.
4. **Divulgação progressiva.** Resumo → gaveta de detalhe → página completa. Nunca um paredão.
5. **Tudo é endereçável.** Toda visão tem URL; a paleta de comandos espelha a navegação; cada trade, posição e rodada tem link próprio.
6. **Ação reversível parece reversível.** O caminho destrutivo é isolado, explicado e exige confirmação tipada. O caminho seguro é um clique.
7. **Transparência gera confiança.** “Por que a IA decidiu isso?” é um botão em todo lugar, não um FAQ.

---

## Identidade

| Elemento | Decisão | Racional |
|---|---|---|
| Nome | **Auto Trader** (mantido) | Reconhecimento e SEO existentes |
| Sistema | **Meridian** | Nome interno do design language |
| Marca | Sinal ascendente em tile com gradiente *ultramarine → cyan* | Crescimento + automação, legível a 16 px |
| Cor de marca | **Ultramarine `#5B6CFF`** | Diferencia de todo dashboard cripto verde-neon; não colide com semântica de lucro |
| Display | Cambria / Source Serif 4 (serifada editorial) | Páginas públicas e onboarding ganham peso de produto, não de planilha |
| UI | Inter | Números e rótulos com excelente legibilidade em 11–14 px |
| Dados | Cascadia Mono / tabular | IDs, endereços, latências e logs |
| Tom de voz | Direto, específico, sem hype | “Exposure is at 94% of its cap”, não “Oops!” |

### Paleta semântica (dark)

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#0A0B0D` | Canvas |
| `--surface-1` | `#101216` | Cartões |
| `--surface-2` | `#16191F` | Estados hover / campos |
| `--surface-3` | `#1D2129` | Chips, trilhas de medidor |
| `--line` | `#23272F` | Bordas de 1 px |
| `--text` | `#F2F4F7` | Texto primário |
| `--text-2` | `#A7AFBC` | Secundário |
| `--text-3` | `#6D7582` | Metadados (nunca para texto essencial) |
| `--brand` | `#5B6CFF` | Ação primária, foco, seleção |
| `--pos` | `#3DDC97` | **Somente** lucro/positivo |
| `--neg` | `#FF6B81` | **Somente** perda/negativo |
| `--warn` | `#F5B454` | Atenção, paper mode, limites próximos |
| `--crit` | `#FF4D5E` | Destrutivo, kill switch, bloqueio |

**Regra dura:** verde nunca é decoração; azul nunca significa lucro. Um teste de contraste automatizado falha o build se `--text-3` for usado em corpo de texto.

---

## Arquitetura de informação

```
App (autenticado)
├── Operate
│   ├── Overview .............. “Está tudo sob controle?”
│   ├── Markets ............... “O que está se movendo?”
│   │   └── Token detail ...... “Vale a pena entrar?”
│   ├── Portfolio ............. “Onde está meu dinheiro?”
│   │   └── Position detail ... “Devo manter ou sair?”
│   ├── Strategy & engine ..... “O que está rodando e com quais limites?”
│   ├── Backtest .............. “Isso funcionaria no passado?”
│   ├── Analytics ............. “Estou ganhando por quê?”
│   └── Journal ............... “O que aconteceu, exatamente?”
├── Guard
│   ├── Risk & safety ......... “Como eu paro tudo?”
│   └── AI Copilot ............ “Por que ele fez isso?”
└── System
    ├── Alerts ................ “O que precisa de mim?”
    ├── Data & sources ........ “De onde vêm os dados?”
    ├── Settings .............. “Como o produto se comporta para mim?”
    ├── Billing ............... “O que eu pago e o que tenho direito?”
    └── Admin ................. “Quem pode fazer o quê?” (super_admin)

Público
├── Landing
├── Pricing
├── Sign in / Sign up / Reset
├── Onboarding (4 passos)
└── Terms / Privacy / Status / 404
```

**Regra de agrupamento:** `Operate` = rotina; `Guard` = proteção e explicação; `System` = configuração e conta. Um item só entra em `Guard` se puder **parar** algo.

---

## Navegação

- **Rail fixo** de 256 px (colapsa para 72 px), com rótulos — nunca só ícones por padrão.
- **Topbar** de 60 px: breadcrumb, busca/⌘K, alternador Paper/Live, pílula de engine, notificações, tema, avatar.
- **Telemetria** de 34 px no rodapé: engine, RPC, signer, DB, bloco, rede, versão. É o único lugar de telemetria bruta.
- **Paleta ⌘K** espelha o rail e adiciona ações (pausar, kill switch, exportar, alternar tema).
- **Gaveta** à direita (480–680 px) para detalhe rápido sem perder a lista.
- **Deep links:** `#/token/SOL`, `#/position/SOL`, e na implementação `/markets/SOL`, `/positions/:id`.

### Hierarquia de ações

| Nível | Aparência | Exemplo |
|---|---|---|
| Primária (1 por tela) | Sólida ultramarine | “Pause engine”, “Run backtest” |
| Secundária | Superfície + borda | “New backtest”, “Export” |
| Terciária | Ghost | “Filters”, “Dismiss” |
| Destrutiva | Contorno vermelho / sólido vermelho | “Kill switch” (única na tela) |

---

## Fluxos-chave

### 1. Primeiro acesso (60 s até o valor)
`Landing → Sign up → Onboarding (risco → estratégia → conexões → revisão) → Overview com engine pausada → “Start engine” → primeira rodada`

- Onboarding mostra **consequência** da escolha de risco (“um stop-out custa $50”) antes de pedir confirmação.
- Cada etapa é pulável, mas o progresso é salvo.

### 2. Verificação de uma decisão
`Overview → card “AI decision” → “Why this trade?” → Copilot com evidências citadas → abrir posição`

- O Copilot nunca responde sem citar fonte (ledger, config, gates).

### 3. Parada de emergência
`Qualquer tela → Risk & safety → Kill switch → digitar HALT → confirmação`

- O kill switch está **somente** em Risk & safety e na paleta (com o mesmo modal). Fora do caminho de cliques rotineiros.

### 4. Rotina diária
`Alerts (o que mudou) → Overview (estado) → Portfolio (exposição) → Journal (o que fechou)`

- Tudo em ≤ 4 cliques, com URLs compartilháveis.

---

## Antes → depois, tela por tela

| Atual | Meridian | Mudança central |
|---|---|---|
| `/` com 12 seções | `/overview` | Só o que responde “está tudo sob controle?” |
| Abas “Explorer” no fim da página | `/markets`, `/portfolio`, `/strategy`, `/backtest`, `/analytics`, `/journal` | Cada domínio vira rota com URL |
| Watchlist + scanner + order flow misturados | `/markets` + `/markets/:sym` | Separação lista → detalhe |
| Posições em tabela na home | `/portfolio` + `/positions/:id` | Página própria com plano de saída |
| Painéis de risco espalhados | `/risk` | Único lugar que pode parar a máquina |
| “AI insights” passivo | `/copilot` | Diálogo com evidência e citação |
| Config da engine no fim da home | `/strategy` | Configuração com envelope humano explícito |
| Sem landing | `/landing` | Explica o produto antes do login |
| Pricing genérico | `/pricing` | Comparação, período, FAQ, garantia |
| Admin com emoji | `/admin` | Papéis, auditoria, busca, ações |

---

## Métricas de design (como saberemos que funcionou)

1. **Time-to-first-insight** ≤ 60 s do login ao primeiro “por que” respondido.
2. **Cliques até o kill switch** ≤ 2 em qualquer tela, e ≥ 2 confirmações.
3. **Cobertura de deep link** 100% das entidades (posição, token, trade, rodada).
4. **Acessibilidade** WCAG 2.2 AA: contraste ≥ 4.5:1, foco visível, alvos ≥ 24 px, `aria-live` em preços.
5. **Responsivo** 390 px sem overflow horizontal; tabelas viram cartões.
6. **Consistência** 1 altura de botão por contexto, 1 padrão de cabeçalho de cartão.

---

## O que ficou de fora (e por quê)

- **Modo “multi-conta” simultâneo:** adiado; hoje o workspace é único e o seletor no rail já prepara o caminho.
- **Editor visual de estratégias:** o público quer confiar, não programar. Ficou como “custom strategies” no plano Elite, sem UI neste conceito.
- **Gráfico de candles com drawing tools:** custo alto e baixo uso no fluxo de um bot; o detalhe do token mostra candles somente leitura.
- **Tema “high contrast”:** o token claro + densidade compacta cobrem a necessidade imediata.
