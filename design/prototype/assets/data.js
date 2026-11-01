/* data.js — deterministic mock data for the Auto Trader prototype */

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261101);

export function series(n, start, drift, vol, seed = 7) {
  const r = mulberry32(seed);
  const out = [];
  let v = start;
  for (let i = 0; i < n; i++) {
    const shock = (r() - 0.5) * vol + drift;
    v = Math.max(1, v * (1 + shock));
    out.push(+v.toFixed(2));
  }
  return out;
}

/* ---------- Assets ---------- */
export const assets = [
  { sym: "BTC", name: "Bitcoin", pair: "BTC/USDT", px: 96420.18, chg: 2.41, m5: 0.18, vol: "1.24B", spread: "0.01%", liq: "98.4M", age: "14y", risk: "low", score: 94, color: "#F7931A", tag: "core" },
  { sym: "ETH", name: "Ethereum", pair: "ETH/USDT", px: 3418.72, chg: 1.86, m5: 0.42, vol: "684M", spread: "0.02%", liq: "62.1M", age: "9y", risk: "low", score: 91, color: "#627EEA", tag: "core" },
  { sym: "SOL", name: "Solana", pair: "SOL/USDT", px: 208.44, chg: 6.12, m5: 1.24, vol: "312M", spread: "0.03%", liq: "28.4M", age: "5y", risk: "mid", score: 82, color: "#14F195", tag: "momentum" },
  { sym: "BNB", name: "BNB", pair: "BNB/USDT", px: 662.11, chg: -0.84, m5: -0.21, vol: "184M", spread: "0.02%", liq: "19.2M", age: "7y", risk: "low", score: 88, color: "#F3BA2F", tag: "core" },
  { sym: "ARB", name: "Arbitrum", pair: "ARB/USDT", px: 0.9184, chg: -3.42, m5: -0.62, vol: "96M", spread: "0.04%", liq: "8.4M", age: "2y", risk: "mid", score: 71, color: "#28A0F0", tag: "watch" },
  { sym: "TIA", name: "Celestia", pair: "TIA/USDT", px: 5.412, chg: 11.8, m5: 2.06, vol: "74M", spread: "0.06%", liq: "4.1M", age: "1y", risk: "high", score: 58, color: "#7B2BF9", tag: "momentum" },
  { sym: "PEPE", name: "Pepe", pair: "PEPE/USDT", px: 0.0000112, chg: 24.6, m5: 3.14, vol: "412M", spread: "0.12%", liq: "2.9M", age: "2y", risk: "high", score: 34, color: "#3D8130", tag: "degen" },
  { sym: "JUP", name: "Jupiter", pair: "JUP/USDT", px: 1.084, chg: 3.94, m5: 0.44, vol: "51M", spread: "0.05%", liq: "6.8M", age: "1y", risk: "mid", score: 76, color: "#C7F284", tag: "watch" },
];

export const marketStats = [
  { label: "Fear & Greed", value: "72", delta: "+4", foot: "Greed · 7d", tone: "pos" },
  { label: "BTC dominance", value: "54.2%", delta: "+0.3", foot: "24h", tone: "pos" },
  { label: "Total market cap", value: "$3.42T", delta: "+1.8%", foot: "24h", tone: "pos" },
  { label: "Funding (avg)", value: "0.011%", delta: "-0.002", foot: "8h", tone: "neg" },
  { label: "Open interest", value: "$68.4B", delta: "+2.4%", foot: "24h", tone: "pos" },
];

/* ---------- Equity ---------- */
export const equity30 = series(30, 18400, 0.0042, 0.019, 11);
export const equity90 = series(90, 15200, 0.0035, 0.022, 22);
export const equityAll = series(180, 12000, 0.0028, 0.026, 33);
export const benchmark90 = series(90, 15200, 0.0018, 0.02, 44);

export const equityPoint = {
  total: 24812.44,
  currency: "USD",
  initial: 10000,
  pnl30d: 3128.19,
  pnl30dPct: 14.42,
  pnlAll: 14812.44,
  pnlAllPct: 148.12,
  peak: 25904.12,
  drawdown: -4.22,
  cash: 6120.44,
  deployed: 18692.0,
  bench: 8.12,
  sharpe: 1.84,
  sortino: 2.41,
  winRate: 61.8,
  profitFactor: 1.92,
  expectancy: 42.18,
  trades: 148,
  avgHold: "3h 42m",
};

/* ---------- Positions ---------- */
export const positions = [
  { sym: "SOL", name: "Solana", pair: "SOL/USDT", side: "LONG", size: 8420.5, entry: 196.2, mark: 208.44, pnl: 525.4, pnlPct: 6.24, weight: 34.1, stop: 186.4, target: 232.0, strategy: "Momentum Breakout", opened: "2h 14m", lev: "1x", color: "#14F195", conf: 78 },
  { sym: "BTC", name: "Bitcoin", pair: "BTC/USDT", side: "LONG", size: 6120.0, entry: 94180.0, mark: 96420.18, pnl: 145.6, pnlPct: 2.38, weight: 24.9, stop: 91200.0, target: 102000.0, strategy: "Trend Core", opened: "18h 06m", lev: "1x", color: "#F7931A", conf: 86 },
  { sym: "ETH", name: "Ethereum", pair: "ETH/USDT", side: "LONG", size: 3120.0, entry: 3496.0, mark: 3418.72, pnl: -69.4, pnlPct: -2.21, weight: 13.4, stop: 3280.0, target: 3860.0, strategy: "Mean Reversion", opened: "5h 41m", lev: "1x", color: "#627EEA", conf: 54 },
  { sym: "ARB", name: "Arbitrum", pair: "ARB/USDT", side: "SHORT", size: 1031.5, entry: 0.9512, mark: 0.9184, pnl: 36.8, pnlPct: 3.45, weight: 4.2, stop: 0.992, target: 0.86, strategy: "Breakdown", opened: "54m", lev: "1x", color: "#28A0F0", conf: 63 },
];

/* ---------- Trades ---------- */
export const trades = [
  { ts: "Today · 14:22:08", sym: "SOL", side: "BUY", qty: "41.20", px: 207.82, notional: 8562.2, fee: 2.14, pnl: null, strategy: "Momentum Breakout", status: "open", round: "R-4128" },
  { ts: "Today · 11:04:51", sym: "TIA", side: "SELL", qty: "812.4", px: 5.388, notional: 4377.2, fee: 1.09, pnl: 412.6, strategy: "Momentum Breakout", status: "closed", round: "R-4127" },
  { ts: "Today · 09:41:12", sym: "ETH", side: "BUY", qty: "0.912", px: 3496.0, notional: 3188.4, fee: 0.8, pnl: null, strategy: "Mean Reversion", status: "open", round: "R-4126" },
  { ts: "Yesterday · 22:18:44", sym: "PEPE", side: "SELL", qty: "184.2M", px: 0.0000108, notional: 1989.4, fee: 1.99, pnl: -84.2, strategy: "Degen Guard", status: "rejected", round: "R-4125" },
  { ts: "Yesterday · 20:02:31", sym: "BTC", side: "BUY", qty: "0.065", px: 94180.0, notional: 6117.7, fee: 1.53, pnl: null, strategy: "Trend Core", status: "open", round: "R-4124" },
  { ts: "Yesterday · 16:48:09", sym: "JUP", side: "SELL", qty: "1840", px: 1.092, notional: 2009.3, fee: 0.5, pnl: 96.4, strategy: "Range Fade", status: "closed", round: "R-4123" },
  { ts: "31 Oct · 13:12:58", sym: "BNB", side: "SELL", qty: "4.2", px: 668.4, notional: 2807.3, fee: 0.7, pnl: 128.4, strategy: "Trend Core", status: "closed", round: "R-4122" },
];

export const rounds = [
  { id: "R-4128", started: "14:22:08", dur: "running", symbols: 18, candidates: 3, traded: 1, pnl: "+$525.40", state: "live" },
  { id: "R-4127", started: "11:04:51", dur: "3m 12s", symbols: 18, candidates: 2, traded: 1, pnl: "+$412.60", state: "done" },
  { id: "R-4126", started: "09:41:12", dur: "2m 47s", symbols: 18, candidates: 4, traded: 1, pnl: "-$69.40", state: "done" },
  { id: "R-4125", started: "22:18:44", dur: "1m 02s", symbols: 18, candidates: 1, traded: 0, pnl: "rejected", state: "veto" },
  { id: "R-4124", started: "20:02:31", dur: "4m 18s", symbols: 18, candidates: 2, traded: 1, pnl: "+$145.60", state: "done" },
];

/* ---------- Alerts ---------- */
export const alerts = [
  { sev: "crit", title: "Circuit breaker · drawdown 3.8%", desc: "Loss streak of 3 closed trades reached the daily soft cap. Sizing reduced to 50% until 00:00 UTC.", time: "12m", unread: true, icon: "alert" },
  { sev: "warn", title: "PEPE rejected by liquidity gate", desc: "Pool depth $2.9M below the $5M threshold; honeypot simulation also failed the sell test.", time: "1h", unread: true, icon: "shield" },
  { sev: "info", title: "New strategy promoted", desc: "Momentum Breakout v12 passed forward validation (21d) and replaced v11 in the live queue.", time: "3h", unread: false, icon: "sparkles" },
  { sev: "pos", title: "SOL target 62% reached", desc: "Trailing stop moved to break-even. Position risk now zero.", time: "4h", unread: false, icon: "target" },
  { sev: "warn", title: "RPC latency spike · BSC", desc: "Median latency 410ms for 4 minutes (threshold 250ms). Failover to publicnode kept quorum.", time: "6h", unread: false, icon: "server" },
  { sev: "info", title: "Weekly report ready", desc: "+14.4% in 30 days, Sharpe 1.84, 148 trades. Export as CSV available in Journal.", time: "1d", unread: false, icon: "file" },
];

export const channels = [
  { name: "Telegram", desc: "@autotrader_ops · critical + digest", on: true, icon: "send", status: "connected" },
  { name: "Email", desc: "ops@example.com · daily digest", on: true, icon: "mail", status: "connected" },
  { name: "Discord webhook", desc: "#trading-alerts · critical only", on: false, icon: "link", status: "not configured" },
  { name: "Push (PWA)", desc: "This device · all events", on: false, icon: "bell", status: "permission needed" },
];

/* ---------- Sources / integrations ---------- */
export const sources = [
  { name: "Binance Public", kind: "Market data", latency: "38ms", uptime: 99.98, icon: "wifi", health: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], status: "ok" },
  { name: "DexScreener", kind: "DEX pairs", latency: "142ms", uptime: 99.41, icon: "radar", health: [1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1], status: "degraded" },
  { name: "BSC RPC quorum", kind: "Chain", latency: "20ms", uptime: 99.99, icon: "server", health: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], status: "ok" },
  { name: "CoinGecko", kind: "Reference prices", latency: "96ms", uptime: 99.82, icon: "globe", health: [1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1], status: "ok" },
];

export const integrations = [
  { name: "Binance", kind: "Exchange · read-only keys", icon: "BN", status: "connected", sub: "Balances synced 12s ago · rate 1,204/1,200", tone: "pos" },
  { name: "Bybit", kind: "Exchange · not connected", icon: "BB", status: "connect", sub: "Add API keys to include this venue", tone: "" },
  { name: "Wallet 0x7a…4f21", kind: "BSC · signer", icon: "0x", status: "connected", sub: "Paper signer · 0 live broadcasts", tone: "pos" },
  { name: "Stripe", kind: "Billing", icon: "ST", status: "connected", sub: "Pro plan · next invoice Nov 30", tone: "pos" },
];

/* ---------- Users & audit ---------- */
export const users = [
  { email: "admin@local", role: "super_admin", active: true, last: "now", created: "01/11/2026", initials: "AD" },
  { email: "trader@local", role: "trader", active: true, last: "2h ago", created: "01/11/2026", initials: "TR" },
  { email: "viewer@local", role: "viewer", active: true, last: "yesterday", created: "01/11/2026", initials: "VW" },
  { email: "ops@example.com", role: "trader", active: false, last: "12d ago", created: "18/10/2026", initials: "OP" },
];

export const auditLog = [
  { who: "admin@local", what: "updated risk_config.json", detail: "max_risk_per_trade 0.5% → 0.35%", time: "14:08" },
  { who: "system", what: "promoted strategy", detail: "momentum-breakout v12 (forward 21d, Sharpe 1.9)", time: "13:42" },
  { who: "trader@local", what: "enabled kill switch", detail: "manual · reason: exchange maintenance", time: "11:16" },
  { who: "system", what: "rejected trade", detail: "PEPE/USDT · honeypot simulation failed", time: "10:04" },
];

/* ---------- Copilot ---------- */
export const threads = [
  { title: "Why did SOL get promoted?", time: "12m", active: true },
  { title: "Is my drawdown within limits?", time: "1h" },
  { title: "Explain the liquidity gate", time: "yesterday" },
  { title: "Draft a weekly summary", time: "2d" },
  { title: "Compare v11 and v12", time: "3d" },
];

/* ---------- Invoices ---------- */
export const invoices = [
  { date: "30 Oct 2026", desc: "Pro · monthly", amount: "$49.00", status: "paid" },
  { date: "30 Sep 2026", desc: "Pro · monthly", amount: "$49.00", status: "paid" },
  { date: "30 Aug 2026", desc: "Pro · monthly", amount: "$49.00", status: "paid" },
  { date: "30 Jul 2026", desc: "Pro · monthly", amount: "$49.00", status: "refunded" },
];

/* ---------- Helpers ---------- */
export const fmt = {
  usd(n, dp = 2) {
    const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    return `${n < 0 ? "−" : ""}$${s}`;
  },
  money(n, dp = 0) {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(dp)}`;
  },
  pct(n, dp = 2) {
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(dp)}%`;
  },
  px(n) {
    if (n >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.001) return n.toFixed(4);
    return n.toFixed(7);
  },
  compact(n) {
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${n}`;
  },
  signed(n, dp = 2) {
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  },
};

export { rand };
