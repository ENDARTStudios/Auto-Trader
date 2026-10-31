# Motion Principles — Skeleton, Lazy, Smooth Animations

> **Versão:** 1.0 — 2026-08-26
> **Fonte:** https://github.com/kylezantos/design-principles (Motion Principles) + Framer Motion 12 + GSAP + Motion.dev
> **Princípio:** Nenhum pixel aparece sem transição. Nenhum dado aparece sem skeleton. Nenhum painel bloqueia o resto.

---

## 1. Regras Invioláveis (todo agente deve seguir)

| # | Regra | O que significa | Como verificar |
|---|---|---|---|
| 1 | **Skeleton em todo loading** | Enquanto `isLoading` ou `isFetching`, renderize `<Skeleton />` no formato exato do conteúdo final (mesma altura/largura) | Desative rede no DevTools → deve ver shimmer, não tela branca |
| 2 | **Lazy loading por painel** | Cada dashboard panel é `dynamic(() => import(...), { loading: () => <Skeleton /> })` ou `React.lazy` + `Suspense` | Bundle analyzer: cada panel é chunk separado |
| 3 | **Entrada suave** | Todo elemento que entra no DOM usa `motion` com `initial → animate` (fade + subtle y) | Grave 5s: nada "popa" sem transição |
| 4 | **Saída suave** | Todo elemento que sai usa `AnimatePresence` + `exit` (fade + y/scale) | Remover item da lista deve animar, não sumir |
| 5 | **Progresso visível** | Toda ação async >300ms mostra progress (spinner, progress bar, ou shimmer) | Clique "Iniciar Engine" → spinner em <100ms |
| 6 | **Stagger em listas** | Listas (posições, logs, scam reports) animam com `staggerChildren` (0.05s) | 10 linhas não aparecem todas de uma vez |

---

## 2. Variants Centralizadas (`src/lib/ui/motion.ts`)

> **Nunca inline variants no componente.** Importe de `src/lib/ui/motion.ts`. Isso garante consistência e permite mudar easing global em 1 lugar.

```ts
// src/lib/ui/motion.ts
import type { Variants } from 'framer-motion';

// Easing — iOS-like, não linear
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;

// Durações — rápidas, nunca lentas (motion deve ser percebido, não esperado)
export const duration = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
  stagger: 0.05,
} as const;

// --- Variants de entrada/saída ---

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.normal, ease: easeOutExpo } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.normal, ease: easeOutExpo } },
  exit: { opacity: 0, y: -8, transition: { duration: duration.fast } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: duration.normal, ease: easeOutExpo } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: duration.fast } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0, transition: { duration: duration.normal, ease: easeOutExpo } },
  exit: { opacity: 0, x: 16, transition: { duration: duration.fast } },
};

// --- Stagger para listas ---

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: duration.stagger } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.normal, ease: easeOutExpo } },
};

// --- Skeleton shimmer (GSAP-like, mas via Framer) ---

export const shimmer: Variants = {
  hidden: { backgroundPosition: '200% 0' },
  visible: {
    backgroundPosition: '0% 0',
    transition: { duration: 1.2, repeat: Infinity, ease: 'linear' },
  },
};

// --- Presets completos para copiar/colar ---

export const cardMotion = {
  initial: 'hidden' as const,
  animate: 'visible' as const,
  exit: 'exit' as const,
  variants: fadeInUp,
};

export const listMotion = {
  initial: 'hidden' as const,
  animate: 'visible' as const,
  variants: staggerContainer,
};
```

---

## 3. Padrões de Uso

### 3.1 Skeleton (enquanto carrega)

```tsx
// src/components/dashboard/positions-table.tsx
import { Skeleton } from '@/components/ui/skeleton';

function PositionsSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function PositionsTable() {
  const { data, isLoading } = useOpenPositions();
  if (isLoading) return <PositionsSkeleton />;
  if (!data?.length) return <EmptyState />;
  return <Table>...</Table>;
}
```

### 3.2 Lazy por Panel + Suspense

```tsx
// src/app/page.tsx
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const MarketPanel = dynamic(() => import('@/components/dashboard/market-panel').then(m => m.MarketPanel), {
  loading: () => <Skeleton className="h-[300px] w-full" />,
  ssr: false, // se usa window/recharts
});
const BacktestPanel = dynamic(() => import('@/components/dashboard/backtest-panel').then(m => m.BacktestPanel), {
  loading: () => <Skeleton className="h-[400px] w-full" />,
});
```

### 3.3 Entrada/Saída com AnimatePresence

```tsx
// Lista de posições com stagger + exit
import { motion, AnimatePresence } from 'framer-motion';
import { staggerContainer, staggerItem, fadeInUp } from '@/lib/ui/motion';

export function PositionsList({ positions }) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible">
      <AnimatePresence mode="popLayout">
        {positions.map(pos => (
          <motion.div
            key={pos.id}
            variants={staggerItem}
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.15 } }}
            layout // anima reorder suave (dnd-kit friendly)
          >
            <PositionRow position={pos} />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
```

### 3.4 Progresso (ação async)

```tsx
// Botão com progresso — nunca sem feedback
import { motion } from 'framer-motion';

function EngineToggle({ running, onToggle, isPending }) {
  return (
    <Button onClick={onToggle} disabled={isPending}>
      {isPending ? (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Processando...
        </motion.span>
      ) : running ? 'Parar Engine' : 'Iniciar Engine'}
    </Button>
  );
}
```

### 3.5 Toast com Motion (AlertsToast já usa SSE — adicionar motion)

```tsx
// src/components/dashboard/alerts-toast.tsx — envolver com AnimatePresence
import { motion, AnimatePresence } from 'framer-motion';
import { slideInRight } from '@/lib/ui/motion';

<AnimatePresence>
  {alerts.map(alert => (
    <motion.div key={alert.id} variants={slideInRight} initial="hidden" animate="visible" exit="exit" layout>
      <AlertCard alert={alert} />
    </motion.div>
  ))}
</AnimatePresence>
```

---

## 4. Integração com Outras Libs (UI UX Pro Max)

| Lib | Uso | Onde |
|---|---|---|
| **Framer Motion 12** | Animações de entrada/saída/stagger/layout (principal) | Todo panel, lista, modal, toast |
| **GSAP** | Animações complexas de timeline (ex: equity curve draw, onboarding) | `src/components/dashboard/equity-curve-chart.tsx` (path draw) |
| **Anime.js** | Micro-interações (ex: confetti em graduação, pulse em kill switch) | `src/components/dashboard/graduation-panel.tsx` |
| **React Three Fiber + Three.js** | 3D hero / background sutil (não bloquear conteúdo) | `src/components/hero-3d.tsx` (lazy, `next/dynamic` + `ssr:false`) |
| **21st.dev / Kokonut / Aceternity** | Componentes prontos com motion já embutido | Copiar para `src/components/ui/` e adaptar variants |
| **Recharts** | Equity curve com animação de `isAnimationActive` | `equity-curve-chart.tsx` |

**Regra:** Framer Motion é a base (já instalado: `framer-motion@12`). GSAP/Three só onde Framer não resolve (timeline complexa, 3D). Não instalar 3 libs para fazer fadeIn.

---

## 5. Responsividade + Acessibilidade

- **Respeitar `prefers-reduced-motion`:** Framer Motion já faz — mas para GSAP/Anime, envolver com `useReducedMotion()`:

```tsx
import { useReducedMotion } from 'framer-motion';
function AnimatedCard() {
  const shouldReduce = useReducedMotion();
  return <motion.div animate={shouldReduce ? {} : { y: 0, opacity: 1 }} />;
}
```

- **Breakpoints:** 375px (SE), 390px (iPhone), 768px (iPad), 1024px+ (desktop) — testar overflow horizontal, modal cortado, botão inalcançável.
- **Foco visível:** `focus-visible:ring-2` em todo interativo (shadcn já tem).

---

## 6. Checklist — Todo Panel Deve Ter

- [ ] `isLoading` → `<Skeleton />` no tamanho exato do conteúdo final
- [ ] `isError` → `<ErrorBoundary>` ou mensagem com retry
- [ ] `AnimatePresence` + `variants` em listas que entram/saem
- [ ] `layout` em itens que reordenam (drag, sort)
- [ ] `useReducedMotion()` guard se usa GSAP/Anime
- [ ] Testado em 375/390/768 (sem overflow, sem modal cortado)
- [ ] `prefers-reduced-motion: reduce` não quebra layout (apenas desativa animação)

---

## 7. Verificação

```bash
# 1. Skeleton — throttle network no DevTools (Slow 3G) e recarregue
# Esperado: skeletons shimmer, não tela branca, não layout shift

# 2. Lazy chunks — build e veja chunks
npm run build 2>&1 | grep -E "chunks|MarketPanel|BacktestPanel"
# Esperado: cada dynamic import é chunk separado

# 3. Motion — grave 5s de interação (abrir/fechar panel, adicionar posição)
# Esperado: tudo fade+slide, stagger em listas, exit animado

# 4. Lighthouse — motion não pode quebrar performance
npx lighthouse http://localhost:3000 --only-categories=performance --view
# Esperado: Performance >90 (motion com transform/opacity só — nunca width/height)
```
