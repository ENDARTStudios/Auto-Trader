// Wallet Manager — CRUD operations for WalletConnection + ExchangeConnection.
//
// v16: Provides the data layer for the wallet/exchange UI panels. The actual
// signing / order placement is stubbed — v17 will wire this to ethers.js
// (for EVM wallets) and CCXT (for exchange APIs).
//
// All sensitive credentials are encrypted with wallet-crypto.ts before
// being written to the DB. The passphrase is required for any operation
// that needs to decrypt (which is currently none — v16 is read-only display).

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "./logger";
import { encryptSecret, maskApiKey, walletVault } from "./wallet-crypto";

export interface WalletConnectionRow {
  id: string;
  label: string;
  type: string; // "evm" | "solana" | "hardware" | "multisig"
  address: string;
  chain: string | null;
  isActive: boolean;
  readOnly: boolean;
  hasPrivateKey: boolean; // derived — never expose the encrypted blob
  publicKey: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeConnectionRow {
  id: string;
  label: string;
  exchange: string;
  apiKeyPrefix: string | null;
  permissions: { read: boolean; trade: boolean; withdraw: boolean } | null;
  isActive: boolean;
  testnet: boolean;
  ipWhitelistConfigured: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toWalletRow(r: Awaited<ReturnType<typeof db.walletConnection.findUnique>>): WalletConnectionRow | null {
  if (!r) return null;
  return {
    id: r.id,
    label: r.label,
    type: r.type,
    address: r.address,
    chain: r.chain,
    isActive: r.isActive,
    readOnly: r.readOnly,
    hasPrivateKey: r.privateKeyEncrypted !== null && r.privateKeyEncrypted !== "",
    publicKey: r.publicKey,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toExchangeRow(r: Awaited<ReturnType<typeof db.exchangeConnection.findUnique>>): ExchangeConnectionRow | null {
  if (!r) return null;
  let perms: ExchangeConnectionRow["permissions"] = null;
  if (r.permissions) {
    try {
      const parsed = JSON.parse(r.permissions);
      perms = {
        read: !!parsed.read,
        trade: !!parsed.trade,
        withdraw: !!parsed.withdraw,
      };
    } catch {
      perms = null;
    }
  }
  return {
    id: r.id,
    label: r.label,
    exchange: r.exchange,
    apiKeyPrefix: r.apiKeyPublicPrefix,
    permissions: perms,
    isActive: r.isActive,
    testnet: r.testnet,
    ipWhitelistConfigured: r.ipWhitelistConfigured,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Wallet CRUD
// ---------------------------------------------------------------------------

export async function listWallets(
  ownerId?: string | null,
  isSuperAdmin = false,
  client?: Prisma.TransactionClient,
): Promise<WalletConnectionRow[]> {
  const where = !isSuperAdmin && ownerId ? { ownerId } : isSuperAdmin ? {} : { ownerId: ownerId ?? undefined };
  // client = transação com contexto RLS (withUserRls/withSystemRls); default
  // db para compatibilidade. WalletConnection é STRICT (round 6): chamadas sem
  // contexto retornam 0 linhas quando o role do banco é non-superuser.
  const conn = client ?? db;
  const rows = await conn.walletConnection.findMany({
    where: Object.keys(where).length ? where : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => toWalletRow(r)!).filter(Boolean);
}

export async function createWallet(
  input: {
    label: string;
    type: string;
    address: string;
    chain?: string;
    readOnly?: boolean;
    publicKey?: string;
    privateKey?: string;
    passphrase?: string;
    ownerId?: string | null;
  },
  client?: Prisma.TransactionClient,
): Promise<WalletConnectionRow> {
  let privateKeyEncrypted: string | null = null;
  if (input.privateKey && input.passphrase) {
    privateKeyEncrypted = encryptSecret(input.privateKey, input.passphrase);
  } else if (input.privateKey && !input.passphrase) {
    throw new Error("Passphrase required to encrypt private key");
  }

  // If this wallet is being marked active, deactivate all others first
  if (input.type !== "hardware" && input.type !== "multisig" && !input.readOnly) {
    // ok
  }

  const conn = client ?? db;
  const row = await conn.walletConnection.create({
    data: {
      ownerId: input.ownerId ?? null,
      label: input.label,
      type: input.type,
      address: input.address,
      chain: input.chain ?? null,
      readOnly: input.readOnly ?? false,
      publicKey: input.publicKey ?? null,
      privateKeyEncrypted,
      isActive: false, // operator must explicitly activate
    },
  });
  logger.info("wallet", `Wallet created: ${input.label} (${input.type} ${input.address.slice(0, 8)}...)`);
  return toWalletRow(row)!;
}

export async function setWalletActive(
  walletId: string,
  active: boolean,
  client?: Prisma.TransactionClient,
): Promise<void> {
  const conn = client ?? db;
  if (active) {
    // Deactivate all others first (RLS scopes this to the owner's rows when a
    // user context is provided).
    await conn.walletConnection.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
  }
  await conn.walletConnection.update({
    where: { id: walletId },
    data: { isActive: active, lastUsedAt: new Date() },
  });
  logger.info("wallet", `Wallet ${walletId} ${active ? "activated" : "deactivated"}`);
}

export async function deleteWallet(
  walletId: string,
  client?: Prisma.TransactionClient,
): Promise<void> {
  const conn = client ?? db;
  await conn.walletConnection.delete({ where: { id: walletId } });
  logger.info("wallet", `Wallet ${walletId} deleted`);
}

// ---------------------------------------------------------------------------
// Exchange CRUD
// ---------------------------------------------------------------------------

export async function listExchanges(
  client?: Prisma.TransactionClient,
): Promise<ExchangeConnectionRow[]> {
  // client = transação com contexto RLS (withUserRls/withSystemRls); default db.
  // ExchangeConnection é STRICT (round 7): sem contexto o role de app vê 0.
  const conn = client ?? db;
  const rows = await conn.exchangeConnection.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => toExchangeRow(r)!).filter(Boolean);
}

export async function createExchange(
  input: {
    label: string;
    exchange: string;
    apiKey: string;
    apiSecret: string;
    apiPassphrase?: string;
    passphrase: string; // encryption passphrase (always required)
    testnet?: boolean;
    ipWhitelistConfigured?: boolean;
    /** RLS: owner da conexão (obrigatório sob contexto de usuário). */
    ownerId?: string | null;
  },
  client?: Prisma.TransactionClient,
): Promise<ExchangeConnectionRow> {
  // SECURITY: enforce NO withdrawal permission at creation time
  const permissions = { read: true, trade: true, withdraw: false };

  const apiKeyEncrypted = encryptSecret(input.apiKey, input.passphrase);
  const apiSecretEncrypted = encryptSecret(input.apiSecret, input.passphrase);
  const apiPassphraseEncrypted = input.apiPassphrase
    ? encryptSecret(input.apiPassphrase, input.passphrase)
    : null;

  const conn = client ?? db;
  const row = await conn.exchangeConnection.create({
    data: {
      ownerId: input.ownerId ?? null,
      label: input.label,
      exchange: input.exchange,
      apiKeyEncrypted,
      apiSecretEncrypted,
      apiPassphraseEncrypted,
      apiKeyPublicPrefix: maskApiKey(input.apiKey),
      permissions: JSON.stringify(permissions),
      isActive: false,
      testnet: input.testnet ?? false,
      ipWhitelistConfigured: input.ipWhitelistConfigured ?? false,
    },
  });
  logger.info("wallet", `Exchange created: ${input.label} (${input.exchange}${input.testnet ? " testnet" : ""})`);
  return toExchangeRow(row)!;
}

export async function setExchangeActive(
  exchangeId: string,
  active: boolean,
  client?: Prisma.TransactionClient,
): Promise<void> {
  const conn = client ?? db;
  if (active) {
    // RLS scopes this updateMany to the owner's rows when a user context is used.
    await conn.exchangeConnection.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
  }
  await conn.exchangeConnection.update({
    where: { id: exchangeId },
    data: { isActive: active, lastUsedAt: new Date() },
  });
  logger.info("wallet", `Exchange ${exchangeId} ${active ? "activated" : "deactivated"}`);
}

export async function deleteExchange(
  exchangeId: string,
  client?: Prisma.TransactionClient,
): Promise<void> {
  const conn = client ?? db;
  await conn.exchangeConnection.delete({ where: { id: exchangeId } });
  logger.info("wallet", `Exchange ${exchangeId} deleted`);
}

// ---------------------------------------------------------------------------
// Vault status (for UI display)
// ---------------------------------------------------------------------------

export function getVaultStatus(): {
  unlocked: boolean;
  walletCount: number;
  exchangeCount: number;
  unlockTime: string | null;
  lastKeyAccessAt: string | null;
  autoLockInSec: number | null;
  cooldownUntil: string | null;
  recentFailures: number;
  // v19.3.1 HOTFIX: global aggregate state exposed for dashboard + API.
  // The dashboard can now show "X falhas globais na última hora" and
  // surface distributed-attack alerts. Per-IP state is NOT exposed here
  // (no request context) — it's only in the 429 response body.
  globalCooldownUntil: string | null;
  globalRecentFailures: number;
  trackedIpCount: number;
} {
  const s = walletVault.stats();
  return {
    unlocked: s.unlocked,
    walletCount: s.walletCount,
    exchangeCount: s.exchangeCount,
    unlockTime: s.unlockTime?.toISOString() ?? null,
    lastKeyAccessAt: s.lastKeyAccessAt?.toISOString() ?? null,
    autoLockInSec: s.autoLockInSec,
    cooldownUntil: s.cooldownUntil?.toISOString() ?? null,
    recentFailures: s.recentFailures,
    globalCooldownUntil: s.globalCooldownUntil?.toISOString() ?? null,
    globalRecentFailures: s.globalRecentFailures,
    trackedIpCount: s.trackedIpCount,
  };
}
