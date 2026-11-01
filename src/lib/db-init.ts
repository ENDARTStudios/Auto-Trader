// src/lib/db-init.ts — Auto-inicialização de bancos SQLite vazios.
// Contexto: em produção Vercel (serverless), o SQLite apontado por
// DATABASE_URL nasce VAZIO a cada instância (sem schema, sem usuários) —
// login dava 500 "table main.User does not exist". Este módulo aplica o
// schema + seed idempotente UMA vez por instância no cold start
// (instrumentation.ts). Bancos já inicializados (dev/CI) pulam tudo.
//
// AVISO (efemeridade): no Vercel o arquivo é efêmero por instância —
// posições/preferências resetam a cada cold start e NÃO são compartilhadas
// entre instâncias. Solução durável: Postgres hospedado (Neon/Supabase) +
// migration do schema — pendência registrada em PENDENCIAS_OPERADOR.md.
//
// Manter em sincronia com scripts/seed-auth.ts e scripts/seed-flags.ts.
import { db } from "@/lib/db";
import { hashPasswordSync } from "@/lib/auth/password";
import { SCHEMA_SQL } from "@/lib/db/schema-sql.generated";

let initPromise: Promise<void> | null = null;

export function ensureDatabaseReady(): Promise<void> {
  if (!initPromise) initPromise = init();
  return initPromise;
}

async function init(): Promise<void> {
  try {
    const tables = (await db.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='User'",
    )) as Array<{ name: string }>;
    if (tables.length > 0) return; // banco já inicializado (dev/CI) — nada a fazer

    console.log("[db-init] banco SQLite vazio — aplicando schema + seed…");
    for (const stmt of SCHEMA_SQL.split(";")) {
      const clean = stmt
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (clean) await db.$executeRawUnsafe(clean + ";");
    }

    await seedUsers();
    await seedFlags();
    console.log("[db-init] schema + seed aplicados com sucesso");
  } catch (e) {
    console.error("[db-init] FALHOU:", (e as Error).message);
    initPromise = null; // permite retry na próxima requisição/boot
    throw e;
  }
}

async function seedUsers(): Promise<void> {
  const adminHash = hashPasswordSync("Admin123!");
  const viewerHash = hashPasswordSync("Viewer123!");
  const traderHash = hashPasswordSync("Trader123!");

  const admin = await db.user.upsert({
    where: { email: "admin@local" },
    create: { email: "admin@local", passwordHash: adminHash, role: "super_admin", isActive: true },
    update: { passwordHash: adminHash, role: "super_admin", isActive: true },
  });
  await db.user.upsert({
    where: { email: "viewer@local" },
    create: { email: "viewer@local", passwordHash: viewerHash, role: "viewer", isActive: true },
    update: { passwordHash: viewerHash, role: "viewer", isActive: true },
  });
  await db.user.upsert({
    where: { email: "trader@local" },
    create: { email: "trader@local", passwordHash: traderHash, role: "trader", isActive: true },
    update: { passwordHash: traderHash, role: "trader", isActive: true },
  });

  // Backfill ownerId para linhas RLS órfãs (mesma semântica do seed-auth.ts)
  await db.walletConnection.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
  await db.exchangeConnection.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
  await db.notificationChannel.updateMany({ where: { ownerId: null }, data: { ownerId: admin.id } });
}

const FLAGS: Array<{ key: string; enabled: boolean; rolloutPct: number; description: string }> = [
  { key: "enable_live_trading", enabled: false, rolloutPct: 100, description: "Libera live mode (além da graduação) — kill switch duplo" },
  { key: "enable_ai_squad", enabled: true, rolloutPct: 100, description: "Liga LLM thesis/news/contract (custa tokens)" },
  { key: "enable_surveillance", enabled: true, rolloutPct: 100, description: "Liga 7 detectors a cada 5min" },
  { key: "enable_notifications", enabled: true, rolloutPct: 100, description: "Liga Telegram/Discord dispatch" },
  { key: "enable_backtest", enabled: true, rolloutPct: 100, description: "Exibe tab Backtest" },
  { key: "enable_watchlist", enabled: true, rolloutPct: 100, description: "Exibe WatchlistScreener" },
  { key: "enable_m3_signing", enabled: false, rolloutPct: 100, description: "Liga signer RPC (M3.2)" },
  { key: "enable_m3_broadcast", enabled: false, rolloutPct: 100, description: "Liga broadcaster (M3.3)" },
  { key: "enable_maintenance_mode", enabled: false, rolloutPct: 100, description: "Mostra banner manutenção, bloqueia trades" },
];

async function seedFlags(): Promise<void> {
  for (const f of FLAGS) {
    await db.featureFlag.upsert({
      where: { key: f.key },
      create: f,
      update: { enabled: f.enabled, rolloutPct: f.rolloutPct, description: f.description },
    });
  }
}
