// src/lib/etl/goplus.ts — GoPlus security scanner (mock, 5 token security audits)
export interface SecurityAudit {
  address: string;
  chain: string;
  isHoneypot: boolean;
  buyTax: number;     // %
  sellTax: number;    // %
  cannotSell: boolean;
  cannotBuy: boolean;
  contractVerified: boolean;
  riskScore: number;  // 0..100
}

const MOCK_AUDITS: SecurityAudit[] = [
  { address: "0xA0b86991c6218b36c1d1D4F73CA3dab40Eb8Fd9Da", chain: "ethereum", isHoneypot: false, buyTax: 0, sellTax: 0, cannotSell: false, cannotBuy: false, contractVerified: true, riskScore: 5 },     // USDC
  { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", chain: "ethereum", isHoneypot: false, buyTax: 0, sellTax: 0, cannotSell: false, cannotBuy: false, contractVerified: true, riskScore: 3 },     // WETH
  { address: "0xC02aaA39b223FE8D000A0e5C4F27eAD9083C756Cc2", chain: "ethereum", isHoneypot: false, buyTax: 2, sellTax: 5, cannotSell: false, cannotBuy: false, contractVerified: true, riskScore: 35 },   // UNI
  { address: "0x6982508145454Ce325dDbE47a25d4EC3d2311933", chain: "ethereum", isHoneypot: false, buyTax: 0, sellTax: 0, cannotSell: false, cannotBuy: false, contractVerified: true, riskScore: 8 },     // SHIB
  { address: "0x4d224452801ACEd8B2F0aabE07034923929AfC15", chain: "ethereum", isHoneypot: true, buyTax: 10, sellTax: 99, cannotSell: true, cannotBuy: false, contractVerified: false, riskScore: 95 },   // honeypot example
];

export async function fetchGoPlus(): Promise<{ audits: SecurityAudit[]; source: string }> {
  // Real: fetch https://api.gopluslabs.io/api/v1/token_security/{chain_id}?contract_addresses={addr}
  return { audits: MOCK_AUDITS, source: "GoPlus mock" };
}
