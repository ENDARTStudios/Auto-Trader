// src/lib/etl/etherscan.ts — Etherscan contract source verifier (mock)
export interface ContractSource {
  address: string;
  chain: string;             // "ethereum" | "arbitrum" | "optimism" | "base"
  verified: boolean;
  hasMint: boolean;          // risk flag
  hasBlacklist: boolean;     // risk flag
  isProxy: boolean;          // upgradeable flag
  compilerVersion: string;   // e.g. "v0.8.24+commit.e11b9ed9"
}

const MOCK_SOURCES: ContractSource[] = [
  { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", chain: "ethereum", verified: true, hasMint: false, hasBlacklist: false, isProxy: false, compilerVersion: "v0.8.24+commit.e11b9ed9" },
  { address: "0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da", chain: "ethereum", verified: true, hasMint: false, hasBlacklist: true,  isProxy: false, compilerVersion: "v0.6.6+commit.6cbfd09" },
  { address: "0xC02aaA39b223FE8D000A0e5C4F27eAD9083C756Cc2", chain: "ethereum", verified: true, hasMint: true,  hasBlacklist: false, isProxy: true,  compilerVersion: "v0.8.20+commit.a1b79de6" },
  { address: "0x4200000000000000000000000000000000000042", chain: "optimism", verified: true, hasMint: false, hasBlacklist: false, isProxy: true,  compilerVersion: "v0.8.19+commit.ea26856" },
  { address: "0xDead000000000000000000000000000000000dEaD", chain: "ethereum", verified: false, hasMint: true,  hasBlacklist: true,  isProxy: true,  compilerVersion: "unknown" },
];

export async function fetchEtherscan(): Promise<{ sources: ContractSource[]; source: string }> {
  // Real: fetch https://api.etherscan.io/api?module=contract&action=getsourcecode&address={addr}&apikey=...
  return { sources: MOCK_SOURCES, source: "Etherscan mock" };
}
