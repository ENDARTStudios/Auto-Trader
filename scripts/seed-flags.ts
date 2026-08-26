// scripts/seed-flags.ts — Seed FeatureFlag table with 9 flags from docs/ARCHITECTURE.md §4.2
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const FLAGS: Array<{ key: string; enabled: boolean; rolloutPct: number; description: string }> = [
  { key: 'enable_live_trading', enabled: false, rolloutPct: 100, description: 'Libera live mode (além da graduação) — kill switch duplo' },
  { key: 'enable_ai_squad', enabled: true, rolloutPct: 100, description: 'Liga LLM thesis/news/contract (custa tokens)' },
  { key: 'enable_surveillance', enabled: true, rolloutPct: 100, description: 'Liga 7 detectors a cada 5min' },
  { key: 'enable_notifications', enabled: true, rolloutPct: 100, description: 'Liga Telegram/Discord dispatch' },
  { key: 'enable_backtest', enabled: true, rolloutPct: 100, description: 'Exibe tab Backtest' },
  { key: 'enable_watchlist', enabled: true, rolloutPct: 100, description: 'Exibe WatchlistScreener' },
  { key: 'enable_m3_signing', enabled: false, rolloutPct: 100, description: 'Liga signer RPC (M3.2)' },
  { key: 'enable_m3_broadcast', enabled: false, rolloutPct: 100, description: 'Liga broadcaster (M3.3)' },
  { key: 'enable_maintenance_mode', enabled: false, rolloutPct: 100, description: 'Mostra banner manutenção, bloqueia trades' },
];

async function main() {
  for (const f of FLAGS) {
    await db.featureFlag.upsert({
      where: { key: f.key },
      create: f,
      update: { enabled: f.enabled, rolloutPct: f.rolloutPct, description: f.description },
    });
    console.log(`upsert ${f.key} -> ${f.enabled}`);
  }
  const count = await db.featureFlag.count();
  console.log(`Seed done — ${count} flags`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
