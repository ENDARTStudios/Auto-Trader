import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Round 2 — live credentials (vault/env) must be FAIL-CLOSED.
// Hermetic: DB + wallet vault are mocked. No real secrets are used.
// ---------------------------------------------------------------------------

// Round 6: live-credentials usa withSystemRls (RLS). O mock do db expõe
// $transaction + $queryRaw e o tx fake delega para os mesmos vi.fn().
vi.mock('@/lib/db', () => {
  const dbMock: Record<string, unknown> = {
    exchangeConnection: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    $queryRaw: vi.fn(async () => []),
  };
  dbMock.$transaction = async (fn: (tx: unknown) => unknown) => fn(dbMock);
  return { db: dbMock };
});

import { db } from '@/lib/db';
import { walletVault } from '@/lib/trading/wallet-crypto';
import {
  LIVE_CRED_ERROR,
  getCexCredentials,
  getDexCredentials,
  getLiveCredentialStatus,
} from '@/lib/trading/live-credentials';

const mockedDb = db as unknown as {
  exchangeConnection: { findFirst: ReturnType<typeof vi.fn> };
  user: { findFirst: ReturnType<typeof vi.fn> };
};

const ENV_KEYS = [
  'LIVE_CREDS_ALLOW_ENV',
  'LIVE_ALLOW_MAINNET',
  'BINANCE_TESTNET_API_KEY',
  'BINANCE_TESTNET_SECRET',
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
  'DEX_USE_SIGNER',
  'SIGNER_SOCKET_PATH',
  'DEX_SIGNER_WALLET_ID',
  'DEX_OPERATOR_PRIVATE_KEY',
  'DEX_RPC_URL_ETHEREUM',
  'DEX_RPC_URL_ETH',
  'DEX_RPC_URL_BASE',
  'ALCHEMY_RPC_URL',
];

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.restoreAllMocks();
  mockedDb.exchangeConnection.findFirst.mockReset();
  mockedDb.user.findFirst.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

function lockVault(): void {
  vi.spyOn(walletVault, 'isUnlocked').mockReturnValue(false);
}

function unlockVault(): void {
  vi.spyOn(walletVault, 'isUnlocked').mockReturnValue(true);
}

describe('getCexCredentials — vault path', () => {
  it('reads the active ExchangeConnection + vault creds (owner = first super_admin)', async () => {
    unlockVault();
    vi.spyOn(walletVault, 'getExchangeCreds').mockReturnValue({
      apiKey: 'vault-api-key',
      apiSecret: 'vault-api-secret',
      apiPassphrase: 'vault-passphrase',
    });
    mockedDb.user.findFirst.mockResolvedValue({ id: 'admin-1' });
    mockedDb.exchangeConnection.findFirst.mockResolvedValue({
      id: 'exchange-1',
      exchange: 'binance',
      testnet: true,
      ownerId: 'admin-1',
    });

    const result = await getCexCredentials();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creds).toMatchObject({
        source: 'vault',
        exchange: 'binance',
        apiKey: 'vault-api-key',
        apiSecret: 'vault-api-secret',
        apiPassphrase: 'vault-passphrase',
        testnet: true,
      });
    }
    expect(mockedDb.exchangeConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, ownerId: 'admin-1' },
      }),
    );
  });

  it('honors an explicit ownerId (RLS) without consulting the super_admin', async () => {
    unlockVault();
    vi.spyOn(walletVault, 'getExchangeCreds').mockReturnValue({
      apiKey: 'k',
      apiSecret: 's',
    });
    mockedDb.exchangeConnection.findFirst.mockResolvedValue({
      id: 'exchange-2',
      exchange: 'binance',
      testnet: true,
      ownerId: 'owner-9',
    });
    const result = await getCexCredentials('owner-9');
    expect(result.ok).toBe(true);
    expect(mockedDb.user.findFirst).not.toHaveBeenCalled();
    expect(mockedDb.exchangeConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, ownerId: 'owner-9' } }),
    );
  });

  it('fails closed when the vault has no active exchange connection', async () => {
    unlockVault();
    mockedDb.user.findFirst.mockResolvedValue({ id: 'admin-1' });
    mockedDb.exchangeConnection.findFirst.mockResolvedValue(null);
    const result = await getCexCredentials();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.NOT_CONFIGURED);
  });

  it('fails closed when the vault auto-locks during credential read', async () => {
    unlockVault();
    vi.spyOn(walletVault, 'getExchangeCreds').mockReturnValue(null);
    mockedDb.user.findFirst.mockResolvedValue({ id: 'admin-1' });
    mockedDb.exchangeConnection.findFirst.mockResolvedValue({
      id: 'exchange-1',
      exchange: 'binance',
      testnet: true,
      ownerId: 'admin-1',
    });
    const result = await getCexCredentials();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.VAULT_LOCKED);
  });

  it('blocks a mainnet vault connection unless LIVE_ALLOW_MAINNET=1', async () => {
    unlockVault();
    vi.spyOn(walletVault, 'getExchangeCreds').mockReturnValue({ apiKey: 'k', apiSecret: 's' });
    mockedDb.user.findFirst.mockResolvedValue({ id: 'admin-1' });
    mockedDb.exchangeConnection.findFirst.mockResolvedValue({
      id: 'exchange-main',
      exchange: 'binance',
      testnet: false,
      ownerId: 'admin-1',
    });

    const blocked = await getCexCredentials();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe(LIVE_CRED_ERROR.MAINNET_NOT_ALLOWED);

    process.env.LIVE_ALLOW_MAINNET = '1';
    const allowed = await getCexCredentials();
    expect(allowed.ok).toBe(true);
    if (allowed.ok) expect(allowed.creds.testnet).toBe(false);
  });
});

describe('getCexCredentials — env fallback requires explicit opt-in', () => {
  it('returns VAULT_LOCKED when locked and LIVE_CREDS_ALLOW_ENV is not set (even with env keys)', async () => {
    lockVault();
    process.env.BINANCE_TESTNET_API_KEY = 'env-key';
    process.env.BINANCE_TESTNET_SECRET = 'env-secret';
    const result = await getCexCredentials();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.VAULT_LOCKED);
  });

  it('returns LIVE_CREDS_NOT_CONFIGURED when opt-in is set but no env keys exist', async () => {
    lockVault();
    process.env.LIVE_CREDS_ALLOW_ENV = '1';
    const result = await getCexCredentials();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.NOT_CONFIGURED);
  });

  it('allows testnet env credentials with opt-in (testnet=true, no mainnet flag needed)', async () => {
    lockVault();
    process.env.LIVE_CREDS_ALLOW_ENV = '1';
    process.env.BINANCE_TESTNET_API_KEY = '  testnet-key  ';
    process.env.BINANCE_TESTNET_SECRET = 'testnet-secret';
    const result = await getCexCredentials();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creds.source).toBe('env');
      expect(result.creds.testnet).toBe(true);
      expect(result.creds.apiKey).toBe('testnet-key'); // trimmed
      expect(result.creds.exchange).toBe('binance');
    }
  });

  it('blocks mainnet env credentials without LIVE_ALLOW_MAINNET=1', async () => {
    lockVault();
    process.env.LIVE_CREDS_ALLOW_ENV = '1';
    process.env.BINANCE_API_KEY = 'main-key';
    process.env.BINANCE_API_SECRET = 'main-secret';
    const result = await getCexCredentials();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.MAINNET_NOT_ALLOWED);
  });

  it('allows mainnet env credentials only with BOTH opt-ins', async () => {
    lockVault();
    process.env.LIVE_CREDS_ALLOW_ENV = '1';
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.BINANCE_API_KEY = 'main-key';
    process.env.BINANCE_API_SECRET = 'main-secret';
    const result = await getCexCredentials();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creds.source).toBe('env');
      expect(result.creds.testnet).toBe(false);
    }
  });
});

describe('getDexCredentials — fail-closed', () => {
  it('rejects an unsupported chain', () => {
    const result = getDexCredentials('solana');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.UNSUPPORTED_CHAIN);
  });

  it('blocks mainnet DEX without LIVE_ALLOW_MAINNET=1 (even fully configured)', () => {
    process.env.DEX_USE_SIGNER = '1';
    process.env.SIGNER_SOCKET_PATH = '/tmp/signer.sock';
    process.env.DEX_RPC_URL_ETHEREUM = 'https://rpc.example';
    const result = getDexCredentials('ethereum');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.MAINNET_NOT_ALLOWED);
  });

  it('uses the signer as source when DEX_USE_SIGNER=1 (private key never loaded)', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_USE_SIGNER = '1';
    process.env.SIGNER_SOCKET_PATH = '/tmp/signer.sock';
    process.env.DEX_SIGNER_WALLET_ID = 'wallet-abc';
    process.env.DEX_RPC_URL_ETH = 'https://rpc.example';
    const result = getDexCredentials('eth');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creds.source).toBe('signer');
      expect(result.creds.chain).toBe('ethereum');
      expect(result.creds.rpcUrl).toBe('https://rpc.example');
      expect(result.creds.signerSocketPath).toBe('/tmp/signer.sock');
      expect(result.creds.signerWalletId).toBe('wallet-abc');
      expect('privateKey' in result.creds).toBe(false);
    }
  });

  it('fails closed when DEX_USE_SIGNER=1 but DEX_SIGNER_WALLET_ID is missing', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_USE_SIGNER = '1';
    process.env.SIGNER_SOCKET_PATH = '/tmp/signer.sock';
    process.env.DEX_RPC_URL_ETHEREUM = 'https://rpc.example';
    const result = getDexCredentials('ethereum');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.DEX_SIGNER_WALLET_ID_REQUIRED);
  });

  it('falls back to DEX_OPERATOR_PRIVATE_KEY env when signer is not selected', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_OPERATOR_PRIVATE_KEY = '0xprivate-key';
    process.env.DEX_RPC_URL_BASE = 'https://base.example';
    const result = getDexCredentials('base');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.creds.source).toBe('env');
      expect(result.creds.privateKey).toBe('0xprivate-key');
    }
  });

  it('fails closed when signer is requested but the socket path is missing', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_USE_SIGNER = '1';
    process.env.DEX_RPC_URL_ETHEREUM = 'https://rpc.example';
    const result = getDexCredentials('ethereum');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.NOT_CONFIGURED);
  });

  it('fails closed when no RPC URL is configured', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_OPERATOR_PRIVATE_KEY = '0xkey';
    const result = getDexCredentials('optimism');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.RPC_NOT_CONFIGURED);
  });

  it('fails closed when neither signer nor private key is available', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_RPC_URL_ETHEREUM = 'https://rpc.example';
    const result = getDexCredentials('ethereum');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(LIVE_CRED_ERROR.NOT_CONFIGURED);
  });

  it('uses ALCHEMY_RPC_URL as a shared fallback', () => {
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.DEX_OPERATOR_PRIVATE_KEY = '0xkey';
    process.env.ALCHEMY_RPC_URL = 'https://alchemy.example';
    const result = getDexCredentials('optimism');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.creds.rpcUrl).toBe('https://alchemy.example');
  });
});

describe('getLiveCredentialStatus — masked, no secrets, no I/O', () => {
  it('reports a locked vault and no CEX/DEX source by default', () => {
    lockVault();
    const status = getLiveCredentialStatus();
    expect(status).toEqual({
      vaultUnlocked: false,
      cexSource: null,
      dexSource: null,
      testnet: null,
    });
  });

  it('does not reflect env keys without the explicit opt-in', () => {
    lockVault();
    process.env.BINANCE_TESTNET_API_KEY = 'SECRET_KEY_VALUE';
    process.env.BINANCE_TESTNET_SECRET = 'SECRET_VALUE';
    const status = getLiveCredentialStatus();
    expect(status.cexSource).toBeNull();
    expect(status.testnet).toBeNull();
  });

  it('reports env as CEX source only with opt-in (testnet)', () => {
    lockVault();
    process.env.LIVE_CREDS_ALLOW_ENV = '1';
    process.env.BINANCE_TESTNET_API_KEY = 'k';
    process.env.BINANCE_TESTNET_SECRET = 's';
    const status = getLiveCredentialStatus();
    expect(status.cexSource).toBe('env');
    expect(status.testnet).toBe(true);
  });

  it('reports vault as CEX source when unlocked', () => {
    unlockVault();
    const status = getLiveCredentialStatus();
    expect(status.vaultUnlocked).toBe(true);
    expect(status.cexSource).toBe('vault');
    expect(status.testnet).toBeNull();
  });

  it('reports the DEX source (signer) only when fully configured (socket + walletId)', () => {
    lockVault();
    process.env.DEX_USE_SIGNER = '1';
    process.env.SIGNER_SOCKET_PATH = '/tmp/signer.sock';
    expect(getLiveCredentialStatus().dexSource).toBeNull(); // falta DEX_SIGNER_WALLET_ID
    process.env.DEX_SIGNER_WALLET_ID = 'wallet-abc';
    expect(getLiveCredentialStatus().dexSource).toBe('signer');
  });

  it('never includes credential material in the status payload', () => {
    lockVault();
    process.env.LIVE_CREDS_ALLOW_ENV = '1';
    process.env.LIVE_ALLOW_MAINNET = '1';
    process.env.BINANCE_API_KEY = 'SUPER_SECRET_API_KEY_VALUE';
    process.env.BINANCE_API_SECRET = 'SUPER_SECRET_API_VALUE';
    process.env.DEX_OPERATOR_PRIVATE_KEY = 'SUPER_SECRET_PRIVATE_KEY_VALUE';
    const serialized = JSON.stringify(getLiveCredentialStatus());
    expect(serialized).not.toContain('SUPER_SECRET');
    expect(serialized).not.toContain('PRIVATE_KEY');
  });
});
