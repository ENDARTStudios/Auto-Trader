// src/lib/trading/live-credentials.ts — resolução de credenciais para execução LIVE.
//
// CONTRATO (dono: sec-hardening na rodada 2). Este arquivo é o ÚNICO ponto que
// transforma cofre/env em credenciais de execução. Nunca logue segredos; nunca
// faça fallback silencioso de cofre-locked para env sem opt-in explícito.
//
// A execução live só deve ser alcançável quando o gating de execução permitir
// (mode=live + graduatedToLive + LIVE_TRADING_ENABLED=1 + S14_APPROVED=1 +
// feature flag). ESTE módulo não decide se live pode rodar — ele apenas
// resolve credenciais, e é FAIL-CLOSED por conta própria:
//
//   CEX — cofre tem prioridade absoluta:
//     1. walletVault desbloqueado → ExchangeConnection ativa (ownerId, ou o
//        primeiro super_admin) + walletVault.getExchangeCreds(id).
//     2. cofre bloqueado → fallback de env SOMENTE com LIVE_CREDS_ALLOW_ENV=1
//        (opt-in explícito). Testnet: BINANCE_TESTNET_API_KEY/SECRET.
//        Mainnet: BINANCE_API_KEY/SECRET e SÓ com LIVE_ALLOW_MAINNET=1.
//     3. caso contrário → erro tipado (VAULT_LOCKED / LIVE_CREDS_NOT_CONFIGURED
//        / LIVE_MAINNET_NOT_ALLOWED).
//
//   DEX — assinatura e RPC:
//     1. DEX_USE_SIGNER=1 + SIGNER_SOCKET_PATH → source="signer" (a chave
//        privada NUNCA entra no processo web).
//     2. senão DEX_OPERATOR_PRIVATE_KEY + RPC (DEX_RPC_URL_<CHAIN> ou
//        ALCHEMY_RPC_URL).
//     3. Todas as chains suportadas (ethereum/arbitrum/optimism/base) são
//        mainnet → exigem LIVE_ALLOW_MAINNET=1.
//
// INVARIANTES:
//   - nunca retorna/registra chaves em log; status é mascarado.
//   - sem imports nativos no topo (net/crypto ficam no transport do signer);
//     o módulo é importável pelo build do Next sem efeitos colaterais.
//   - getLiveCredentialStatus() é síncrono e NÃO consulta o DB.

import { db } from "@/lib/db";
import { withSystemRls } from "@/lib/auth/rls-context";
import { walletVault } from "./wallet-crypto";

// ---------------------------------------------------------------------------
// Tipos públicos (contrato)
// ---------------------------------------------------------------------------

export type LiveCredentialSource = "vault" | "env" | "signer";

export interface CexCredentials {
  source: LiveCredentialSource;
  exchange: string; // "binance"
  apiKey: string;
  apiSecret: string;
  apiPassphrase?: string;
  testnet: boolean;
}

export interface DexCredentials {
  source: LiveCredentialSource;
  chain: string; // ethereum | arbitrum | optimism | base
  rpcUrl: string;
  privateKey?: string; // source=env
  signerSocketPath?: string; // source=signer
  /**
   * source=signer only: qual WalletConnection do cofre o signer deve usar para
   * o endereço/derivation path da tx (round 3). Sem ele, a assinatura via
   * signer é recusada (fail-closed) — ver LIVE_CRED_ERROR.DEX_SIGNER_WALLET_ID_REQUIRED.
   */
  signerWalletId?: string;
}

export type LiveCredentialResult<T> =
  | { ok: true; creds: T }
  | { ok: false; code: string; reason: string };

export interface LiveCredentialStatus {
  vaultUnlocked: boolean;
  cexSource: LiveCredentialSource | null;
  dexSource: LiveCredentialSource | null;
  /** true=testnet, false=mainnet (só quando conhecido), null=indeterminado. */
  testnet: boolean | null;
}

/** Códigos de erro tipados (fail-closed). */
export const LIVE_CRED_ERROR = {
  VAULT_LOCKED: "VAULT_LOCKED",
  NOT_CONFIGURED: "LIVE_CREDS_NOT_CONFIGURED",
  MAINNET_NOT_ALLOWED: "LIVE_MAINNET_NOT_ALLOWED",
  UNSUPPORTED_CHAIN: "LIVE_UNSUPPORTED_CHAIN",
  RPC_NOT_CONFIGURED: "LIVE_RPC_NOT_CONFIGURED",
  DB_ERROR: "LIVE_CREDS_DB_ERROR",
  DEX_SIGNER_WALLET_ID_REQUIRED: "DEX_SIGNER_WALLET_ID_REQUIRED",
} as const;

export type LiveCredErrorCode =
  (typeof LIVE_CRED_ERROR)[keyof typeof LIVE_CRED_ERROR];

// ---------------------------------------------------------------------------
// Flags de ambiente (lidas a cada chamada, nunca cacheadas).
// ---------------------------------------------------------------------------

const DEX_CHAINS = ["ethereum", "arbitrum", "optimism", "base"] as const;
export type DexChain = (typeof DEX_CHAINS)[number];

const DEX_CHAIN_ENV_ALIASES: Record<DexChain, string[]> = {
  ethereum: ["ETHEREUM", "ETH"],
  arbitrum: ["ARBITRUM", "ARB"],
  optimism: ["OPTIMISM", "OP"],
  base: ["BASE"],
};

function fail<T>(code: LiveCredErrorCode, reason: string): LiveCredentialResult<T> {
  return { ok: false, code, reason };
}

function envValue(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mainnetAllowed(): boolean {
  return envValue("LIVE_ALLOW_MAINNET") === "1";
}

function envFallbackAllowed(): boolean {
  return envValue("LIVE_CREDS_ALLOW_ENV") === "1";
}

// ---------------------------------------------------------------------------
// Owner resolution (RLS): ownerId explícito ou o primeiro super_admin.
// Cache curto; local para evitar import circular com portfolio.ts.
// ---------------------------------------------------------------------------

let cachedAdminOwnerId: { id: string; at: number } | null = null;
const ADMIN_OWNER_TTL_MS = 60_000;

async function resolveOwnerId(ownerId?: string | null): Promise<string | null> {
  if (ownerId && ownerId.trim().length > 0) return ownerId;
  if (cachedAdminOwnerId && Date.now() - cachedAdminOwnerId.at < ADMIN_OWNER_TTL_MS) {
    return cachedAdminOwnerId.id;
  }
  const admin = await db.user.findFirst({
    where: { role: "super_admin" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!admin) return null;
  cachedAdminOwnerId = { id: admin.id, at: Date.now() };
  return admin.id;
}

// ---------------------------------------------------------------------------
// CEX
// ---------------------------------------------------------------------------

/**
 * Resolve credenciais de exchange (CEX).
 * @param ownerId owner RLS; quando ausente resolve o primeiro super_admin.
 */
export async function getCexCredentials(
  ownerId?: string | null,
): Promise<LiveCredentialResult<CexCredentials>> {
  const vaultUnlocked = walletVault.isUnlocked();

  if (vaultUnlocked) {
    try {
      const resolvedOwner = await resolveOwnerId(ownerId);
      // Contexto explícito de SISTEMA: a resolução de credenciais é chamada
      // pelo executor (não por input direto de usuário) e precisa enxergar a
      // conexão ativa do owner resolvido. ExchangeConnection ainda é
      // permissiva nesta fase, mas já fica pronta para o strict futuro.
      const connection = await withSystemRls((tx) =>
        tx.exchangeConnection.findFirst({
          where: {
            isActive: true,
            ...(resolvedOwner ? { ownerId: resolvedOwner } : {}),
          },
          orderBy: { createdAt: "asc" },
        }),
      );
      if (!connection) {
        return fail(
          LIVE_CRED_ERROR.NOT_CONFIGURED,
          "cofre desbloqueado, mas nenhuma ExchangeConnection ativa para o owner",
        );
      }
      // Fail-closed global: mainnet exige opt-in explícito, mesmo via cofre.
      if (!connection.testnet && !mainnetAllowed()) {
        return fail(
          LIVE_CRED_ERROR.MAINNET_NOT_ALLOWED,
          "ExchangeConnection mainnet (testnet=false) exige LIVE_ALLOW_MAINNET=1",
        );
      }
      const creds = walletVault.getExchangeCreds(connection.id);
      if (!creds) {
        // Corrida/auto-lock entre isUnlocked() e getExchangeCreds().
        return fail(
          LIVE_CRED_ERROR.VAULT_LOCKED,
          "cofre bloqueou durante a leitura das credenciais (auto-lock) — desbloqueie novamente",
        );
      }
      return {
        ok: true,
        creds: {
          source: "vault",
          exchange: connection.exchange,
          apiKey: creds.apiKey,
          apiSecret: creds.apiSecret,
          apiPassphrase: creds.apiPassphrase,
          testnet: connection.testnet,
        },
      };
    } catch (err) {
      // Nunca inclui valores; só a mensagem do erro de DB.
      return fail(
        LIVE_CRED_ERROR.DB_ERROR,
        "falha ao carregar ExchangeConnection: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  // Cofre bloqueado: fallback de env é DOWNGRADE e exige opt-in explícito.
  if (!envFallbackAllowed()) {
    return fail(
      LIVE_CRED_ERROR.VAULT_LOCKED,
      "cofre bloqueado e LIVE_CREDS_ALLOW_ENV!=1 — fallback de env exige opt-in explícito",
    );
  }

  const testnetKey = envValue("BINANCE_TESTNET_API_KEY");
  const testnetSecret = envValue("BINANCE_TESTNET_SECRET");
  if (testnetKey && testnetSecret) {
    return {
      ok: true,
      creds: {
        source: "env",
        exchange: "binance",
        apiKey: testnetKey,
        apiSecret: testnetSecret,
        testnet: true,
      },
    };
  }

  const mainnetKey = envValue("BINANCE_API_KEY");
  const mainnetSecret = envValue("BINANCE_API_SECRET");
  if (mainnetKey && mainnetSecret) {
    if (!mainnetAllowed()) {
      return fail(
        LIVE_CRED_ERROR.MAINNET_NOT_ALLOWED,
        "BINANCE_API_KEY presente (mainnet) exige LIVE_ALLOW_MAINNET=1",
      );
    }
    return {
      ok: true,
      creds: {
        source: "env",
        exchange: "binance",
        apiKey: mainnetKey,
        apiSecret: mainnetSecret,
        testnet: false,
      },
    };
  }

  return fail(
    LIVE_CRED_ERROR.NOT_CONFIGURED,
    "sem BINANCE_TESTNET_API_KEY/SECRET (testnet) nem BINANCE_API_KEY/SECRET (mainnet)",
  );
}

// ---------------------------------------------------------------------------
// DEX
// ---------------------------------------------------------------------------

function normalizeChain(chain: string): DexChain | null {
  if (typeof chain !== "string") return null;
  const normalized = chain.trim().toLowerCase();
  if (normalized === "ethereum" || normalized === "eth" || normalized === "mainnet") {
    return "ethereum";
  }
  if (normalized === "arbitrum" || normalized === "arb") return "arbitrum";
  if (normalized === "optimism" || normalized === "op") return "optimism";
  if (normalized === "base") return "base";
  return null;
}

function resolveDexRpcUrl(chain: DexChain): string | null {
  for (const alias of DEX_CHAIN_ENV_ALIASES[chain]) {
    const url = envValue("DEX_RPC_URL_" + alias);
    if (url) return url;
  }
  return envValue("ALCHEMY_RPC_URL");
}

/**
 * Resolve credenciais DEX para uma chain. Sync by contract (pure env reads).
 */
export function getDexCredentials(chain: string): LiveCredentialResult<DexCredentials> {
  const normalized = normalizeChain(chain);
  if (!normalized) {
    return fail(
      LIVE_CRED_ERROR.UNSUPPORTED_CHAIN,
      "chain não suportada: " + String(chain) + " (permitidas: " + DEX_CHAINS.join(", ") + ")",
    );
  }

  // Todas as chains suportadas são mainnet.
  if (!mainnetAllowed()) {
    return fail(
      LIVE_CRED_ERROR.MAINNET_NOT_ALLOWED,
      "DEX mainnet exige LIVE_ALLOW_MAINNET=1",
    );
  }

  const rpcUrl = resolveDexRpcUrl(normalized);
  if (!rpcUrl) {
    return fail(
      LIVE_CRED_ERROR.RPC_NOT_CONFIGURED,
      "RPC para " + normalized + " não configurado (DEX_RPC_URL_" +
        normalized.toUpperCase() + " ou ALCHEMY_RPC_URL)",
    );
  }

  const signerSocketPath = envValue("SIGNER_SOCKET_PATH");
  if (envValue("DEX_USE_SIGNER") === "1") {
    if (!signerSocketPath) {
      return fail(
        LIVE_CRED_ERROR.NOT_CONFIGURED,
        "DEX_USE_SIGNER=1 mas SIGNER_SOCKET_PATH ausente",
      );
    }
    // Fail-closed: assinar via signer exige saber QUAL wallet do cofre usar.
    const signerWalletId = envValue("DEX_SIGNER_WALLET_ID");
    if (!signerWalletId) {
      return fail(
        LIVE_CRED_ERROR.DEX_SIGNER_WALLET_ID_REQUIRED,
        "DEX_USE_SIGNER=1 mas DEX_SIGNER_WALLET_ID ausente — assinatura via signer exige a wallet do cofre",
      );
    }
    return {
      ok: true,
      creds: {
        source: "signer",
        chain: normalized,
        rpcUrl,
        signerSocketPath,
        signerWalletId,
      },
    };
  }

  const privateKey = envValue("DEX_OPERATOR_PRIVATE_KEY");
  if (!privateKey) {
    return fail(
      LIVE_CRED_ERROR.NOT_CONFIGURED,
      "DEX_OPERATOR_PRIVATE_KEY ausente e DEX_USE_SIGNER!=1",
    );
  }
  return {
    ok: true,
    creds: { source: "env", chain: normalized, rpcUrl, privateKey },
  };
}

// ---------------------------------------------------------------------------
// Status (mascarado, sem segredos, sem I/O)
// ---------------------------------------------------------------------------

/**
 * Status agregado para dashboards/health. Nunca inclui chaves, passphrases,
 * blobs ou caminhos completos.
 */
export function getLiveCredentialStatus(): LiveCredentialStatus {
  const vaultUnlocked = walletVault.isUnlocked();
  const allowEnv = envFallbackAllowed();
  const allowMainnet = mainnetAllowed();

  const testnetEnvConfigured = Boolean(
    envValue("BINANCE_TESTNET_API_KEY") && envValue("BINANCE_TESTNET_SECRET"),
  );
  const mainnetEnvConfigured = Boolean(
    envValue("BINANCE_API_KEY") && envValue("BINANCE_API_SECRET"),
  );

  let cexSource: LiveCredentialSource | null = null;
  let testnet: boolean | null = null;
  if (vaultUnlocked) {
    cexSource = "vault";
    testnet = null; // exige DB; status é sem I/O
  } else if (allowEnv && testnetEnvConfigured) {
    cexSource = "env";
    testnet = true;
  } else if (allowEnv && mainnetEnvConfigured && allowMainnet) {
    cexSource = "env";
    testnet = false;
  }

  const signerConfigured = Boolean(envValue("SIGNER_SOCKET_PATH"));
  const dexSource: LiveCredentialSource | null =
    envValue("DEX_USE_SIGNER") === "1" && signerConfigured && Boolean(envValue("DEX_SIGNER_WALLET_ID"))
      ? "signer"
      : envValue("DEX_OPERATOR_PRIVATE_KEY")
        ? "env"
        : null;

  return { vaultUnlocked, cexSource, dexSource, testnet };
}
