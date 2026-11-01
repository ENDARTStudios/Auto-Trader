import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

// Prisma 7: datasource url saiu do schema (P1012) — a conexão SQLite passa a
// ser feita via driver adapter no construtor do client.
//   - app:  DATABASE_URL do .env (dev: file:./db/custom.db)
//   - CI:   DATABASE_URL=file:./prisma/test.db
// better-sqlite3 NÃO cria diretórios (o engine do prisma 6 criava) — mkdir antes.
function ensureSqliteDir(url: string): void {
  if (!url.startsWith('file:')) return
  const filePath = isAbsolute(url.slice(5)) ? url.slice(5) : resolve(process.cwd(), url.slice(5))
  mkdirSync(dirname(filePath), { recursive: true })
}

export function createPrismaClient(dataSourceUrl?: string): PrismaClient {
  const url = dataSourceUrl ?? process.env.DATABASE_URL ?? 'file:./db/custom.db'
  ensureSqliteDir(url)
  const adapter = new PrismaBetterSqlite3({ url })
  return new PrismaClient({ adapter, log: ['query'] })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
