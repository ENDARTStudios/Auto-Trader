// src/lib/ui/motion.ts — Centralized motion variants
// Import from here, never inline variants in components.
// See docs/MOTION.md for usage patterns.

import type { Variants } from 'framer-motion';

export const easeOutExpo = [0.16, 1, 0.3, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;

export const duration = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
  stagger: 0.05,
} as const;

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: duration.normal, ease: easeOutExpo as any } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.normal, ease: easeOutExpo as any } },
  exit: { opacity: 0, y: -8, transition: { duration: duration.fast } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: duration.normal, ease: easeOutExpo as any } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: duration.fast } },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0, transition: { duration: duration.normal, ease: easeOutExpo as any } },
  exit: { opacity: 0, x: 16, transition: { duration: duration.fast } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: duration.stagger } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: duration.normal, ease: easeOutExpo as any } },
};

export const shimmer: Variants = {
  hidden: { backgroundPosition: '200% 0' },
  visible: {
    backgroundPosition: '0% 0',
    transition: { duration: 1.2, repeat: Infinity, ease: 'linear' },
  },
};

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
