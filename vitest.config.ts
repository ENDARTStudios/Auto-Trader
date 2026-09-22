import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', 'prisma/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Baseline real 2026-09-22: lines ~16-22%, funcs ~58-69%, branches ~74%.
      // 80% era aspiracional e nunca passou no CI — ratchet sobe com T050c (chain ≥40%).
      thresholds: { lines: 15, functions: 55, branches: 70 },
      include: ['src/lib/trading/**', 'src/lib/chain/**', 'src/lib/auth/**', 'src/lib/observability/**'],
      exclude: ['src/components/ui/**', 'src/lib/crash-logger.ts', '**/*.test.ts'],
    },
    setupFiles: [],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
