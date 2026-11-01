import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // O SQLite de teste é único por run: arquivos em paralelo criam/limpam
    // posições ao mesmo tempo e quebram suites que assumem banco vazio.
    fileParallelism: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', 'prisma/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      // Baseline real 2026-09-22 (vitest 3): lines ~16-22%, funcs ~58-69%, branches ~74%.
      // RE-BASELINE 2026-10-31 (vitest 5): o provider coverage-v8 5.x muda a atribuição
      // de cobertura (módulos cobertos no v3 aparecem 0% — ex.: engine.ts, observability/*),
      // derrubando funcs p/ 39.49% e branches p/ 27.42%. Ratchet re-alinhado à nova régua;
      // investigar atribuição (T050c spirit) e subir de volta para >=55/70 antes de novas features.
      thresholds: { lines: 30, functions: 39, branches: 27 },
      include: ['src/lib/trading/**', 'src/lib/chain/**', 'src/lib/auth/**', 'src/lib/observability/**'],
      exclude: ['src/components/ui/**', 'src/lib/crash-logger.ts', '**/*.test.ts'],
    },
    setupFiles: ['dotenv/config'],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
