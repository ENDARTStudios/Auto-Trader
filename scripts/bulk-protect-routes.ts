// scripts/bulk-protect-routes.ts — S23 T001: surgical per-route edits
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const base = 'D:/PROJETOS/Auto Trader/Auto Trader/src/app/api';

interface Route {
  file: string;
  perm: string;
  hasPost: boolean;
  postBody?: string;
}

const routes: Route[] = [
  { file: 'ai-insights/route.ts', perm: 'logs:read', hasPost: false },
  { file: 'backtest/route.ts', perm: 'backtest:run', hasPost: true, postBody: 'z.object({symbols: z.array(z.string().min(1)).min(1).max(20), interval: z.string().min(1), periodDays: z.number().int().min(1).max(365).optional(), initialCapitalUsd: z.number().positive().optional(), perTradeUsd: z.number().positive().optional(), takeProfitPct: z.number().positive().max(1).optional(), stopLossPct: z.number().positive().max(1).optional(), maxHoldBars: z.number().int().positive().max(5000).optional(), rsiEntryMax: z.number().min(0).max(100).optional(), rsiExitMin: z.number().min(0).max(100).optional()})' },
  { file: 'diversification/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'exchanges/route.ts', perm: 'exchanges:manage', hasPost: true, postBody: 'z.object({label: z.string().min(1), exchange: z.string().min(1)})' },
  { file: 'fees/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'graduation/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'market/route.ts', perm: 'dashboard:read', hasPost: true, postBody: 'z.object({symbol: z.string().min(1), action: z.enum(["scan", "analyze"])})' },
  { file: 'platforms/route.ts', perm: 'dashboard:read', hasPost: true, postBody: 'z.object({})' },
  { file: 'risk-scale/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'roadmap/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'scam-reports/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'schedule/route.ts', perm: 'schedule:manage', hasPost: true, postBody: 'z.object({enabled: z.boolean(), daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(), startTime: z.string().regex(/^\\d{2}:\\d{2}$/).optional(), endTime: z.string().regex(/^\\d{2}:\\d{2}$/).optional(), timezone: z.string().optional()})' },
  { file: 'scout-skip-stats/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'site-audit/route.ts', perm: 'logs:read', hasPost: true, postBody: 'z.object({url: z.string().url()})' },
  { file: 'source-health/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'stream/route.ts', perm: 'dashboard:read', hasPost: false },
  { file: 'surveillance/route.ts', perm: 'logs:read', hasPost: true, postBody: 'z.object({action: z.enum(["scan_now", "resolve"]), alertId: z.string().optional()})' },
  { file: 'vault/route.ts', perm: 'wallets:read', hasPost: true, postBody: 'z.object({action: z.enum(["unlock", "lock", "status"])})' },
  { file: 'watchlist/route.ts', perm: 'watchlist:manage', hasPost: true, postBody: 'z.object({symbol: z.string().min(1), chain: z.string().optional()})' },
];

const IMPORTS = `import { requireSession } from "@/lib/auth/session";\nimport { hasPermission } from "@/lib/auth/rbac";\nimport { ForbiddenError } from "@/lib/auth/errors";\nimport { checkRateLimit } from "@/lib/rate-limit";\nimport { handleApiError } from "@/lib/api/error-handler";\nimport { z } from "zod";\n\nfunction getClientIp(req: Request): string {\n  const xff = (req.headers as unknown as Headers).get?.("x-forwarded-for");\n  if (xff) return xff.split(",")[0].trim();\n  return "unknown";\n}\n`;

let processed = 0, skipped = 0, errors: string[] = [];

for (const r of routes) {
  const path = join(base, r.file);
  if (!existsSync(path)) {
    errors.push(`${r.file}: file not found`);
    continue;
  }
  let content = readFileSync(path, 'utf8');

  if (content.includes('"@/lib/auth/session"') && content.includes('hasPermission(')) {
    skipped++;
    continue;
  }

  if (!content.includes('"@/lib/auth/session"')) {
    content = content.replace(/^(import [^\n]+\n)+/m, (m) => m + IMPORTS);
  }

  content = content.replace(
    /export async function GET\((req: NextRequest)\): Promise<NextResponse> \{\n([\s\S]+?)\n\}/m,
    (_m, body: string) => {
      const wrapped = body.replace(/^/gm, '    ');
      return `export async function GET(req: NextRequest): Promise<NextResponse> {\n  try {\n    const ip = getClientIp(req);\n    const rl = checkRateLimit(ip, "/api/${r.file.split('/')[0]}");\n    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });\n    const session = await requireSession(req);\n    if (!hasPermission(session.role, "${r.perm}")) throw new ForbiddenError("${r.perm}");\n${wrapped}\n  } catch (err) {\n    return handleApiError(err, "GET /api/${r.file.split('/')[0]}");\n  }\n}`;
    },
  );

  if (r.hasPost && r.postBody) {
    const schemaConst = `const bodySchema = ${r.postBody};\n\n`;
    content = content.replace(
      /export async function POST\((req: NextRequest)\): Promise<NextResponse> \{\n([\s\S]+?)\n\}/m,
      (_m, body: string) => {
        const wrapped = body
          .replace(/await req\.json\(\)/g, 'await req.json()')
          .replace(/^/gm, '    ');
        return `export async function POST(req: NextRequest): Promise<NextResponse> {\n  try {\n    const ip = getClientIp(req);\n    const rl = checkRateLimit(ip, "/api/${r.file.split('/')[0]}");\n    if (!rl.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });\n    const session = await requireSession(req);\n    if (!hasPermission(session.role, "${r.perm}")) throw new ForbiddenError("${r.perm}");\n    const parsed = bodySchema.safeParse(await req.json());\n    if (!parsed.success) return NextResponse.json({ error: "validation_error", details: parsed.error.flatten() }, { status: 400 });\n    const body = parsed.data;\n${wrapped}\n  } catch (err) {\n    return handleApiError(err, "POST /api/${r.file.split('/')[0]}");\n  }\n}`;
      },
    );
    if (!content.includes('const bodySchema = ')) {
      content = content.replace(/export async function POST/, schemaConst + 'export async function POST');
    }
  }

  try {
    writeFileSync(path, content);
    processed++;
  } catch (e) {
    errors.push(`${r.file}: ${(e as Error).message}`);
  }
}

console.log(`Processed: ${processed}`);
console.log(`Skipped (already protected): ${skipped}`);
console.log(`Errors: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
