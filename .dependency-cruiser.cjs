/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies break the DAG (see docs/ARCHITECTURE.md)',
      from: {},
      to: { circular: true },
    },
    {
      name: 'chain-no-trading-import',
      severity: 'error',
      comment: 'H1/H2 primitives (chain) must not import trading (leaf) — chain is frozen',
      from: { path: '^src/lib/chain' },
      to: { path: '^src/lib/trading' },
    },
    {
      name: 'ui-no-db',
      severity: 'error',
      comment: 'UI components must not import db directly — use hooks',
      from: { path: '^src/components' },
      to: { path: '^src/lib/db' },
    },
    {
      name: 'auth-no-bypass',
      severity: 'error',
      comment: 'No direct db access bypassing RLS helper in API routes',
      from: { path: '^src/app/api' },
      to: { path: '^src/lib/db', dependencyTypes: ['local'] },
      // This is a warning, not error, because some routes legitimately need direct db (e.g. health)
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
