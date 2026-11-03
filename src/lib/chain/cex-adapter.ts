// src/lib/chain/cex-adapter.ts — execução CEX real via CCXT.
//
// Substitui o mock de live-trader.ts. Nada aqui inventa ordem/preço: se o
// exchange não responde, o resultado é erro tipado. Credenciais NUNCA são
// logadas (nem em stack/erro). A chamada só é alcançável atrás de live-gating.
//
// Superfície:
//   - createCexClient(creds)            → instância CCXT (dynamic import)
//   - placeMarketOrder(client, req)     → ordem a mercado + fill/fee reais
//   - placeLimitOrder(client, req)      → ordem limite (compat. API S20)
//   - fetchCexBalances(client)          → saldos reais
//   - helpers puros: normalizeSymbol, computeAmountFromUsd, parseFee,
//     parseOrderFill, extractStableFeeCost

import type { CexCredentials } from "@/lib/trading/live-credentials";

// ---------------------------------------------------------------------------
// Tipos mínimos do CCXT (evita depender de generics do pacote no compile)
// ---------------------------------------------------------------------------
export interface CexTicker {
  last?: number;
  close?: number;
}

export interface CcxtFee {
  cost?: number;
  currency?: string;
}

export interface CcxtOrder {
  id?: string;
  symbol?: string;
  type?: string;
  side?: string;
  amount?: number;
  filled?: number;
  price?: number;
  average?: number;
  cost?: number;
  status?: string;
  fee?: CcxtFee;
  fees?: CcxtFee[];
  trades?: Array<{ fee?: CcxtFee }>;
  [key: string]: unknown;
}

export interface CcxtBalance {
  free?: Record<string, number>;
  used?: Record<string, number>;
  total?: Record<string, number>;
  [key: string]: unknown;
}

/** Interface mínima usada por placeMarketOrder — plain object, fácil de mockar. */
export interface CexClient {
  id: string;
  loadMarkets(): Promise<unknown>;
  fetchTicker(symbol: string): Promise<CexTicker>;
  createMarketOrder(symbol: string, side: "buy" | "sell", amount: number): Promise<CcxtOrder>;
  createOrder?(
    symbol: string,
    type: string,
    side: "buy" | "sell",
    amount: number,
    price?: number
  ): Promise<CcxtOrder>;
  fetchOrder?(id: string, symbol: string): Promise<CcxtOrder>;
  fetchBalance(): Promise<CcxtBalance>;
}

export type CexOrderErrorCode =
  | "CEX_UNSUPPORTED_EXCHANGE"
  | "CEX_INVALID_AMOUNT"
  | "CEX_INVALID_PRICE"
  | "CEX_PRICE_UNAVAILABLE"
  | "CEX_EXECUTION_FAILED"
  | "CEX_BALANCE_UNAVAILABLE";

export class CexAdapterError extends Error {
  readonly code: CexOrderErrorCode;
  constructor(code: CexOrderErrorCode, message: string) {
    super(message);
    this.name = "CexAdapterError";
    this.code = code;
  }
}

export interface CexOrderSuccess {
  ok: true;
  orderId: string;
  filledPrice: number;
  filledQty: number;
  amountUsd: number;
  feeUsd: number;
  raw: CcxtOrder;
}
export interface CexOrderFailure {
  ok: false;
  error: CexOrderErrorCode;
  reason: string;
}
export type CexOrderResult = CexOrderSuccess | CexOrderFailure;

export interface MarketOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  /** Notional desejado em USD (obrigatório). */
  amountUsd: number;
  /** Quantidade explícita (ex.: sell de uma posição) — sobrepõe o cálculo por
   *  notional, mas nunca ignora validação. */
  amount?: number;
}

export interface LimitOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  amountUsd: number;
  limitPrice: number;
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------
const QUOTE_ASSETS = ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USD", "EUR", "BTC", "ETH", "BNB"];
const STABLE_ASSETS = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USD"]);

/** "BTCUSDT" → "BTC/USDT"; "btc/usdt" → "BTC/USDT". Sem quote reconhecida,
 *  devolve o input uppercased (o exchange rejeita e viramos erro tipado). */
export function normalizeSymbol(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value.includes("/")) {
    const [base, quote] = value.split("/");
    if (!base || !quote) return value.toUpperCase();
    return `${base.toUpperCase()}/${quote.toUpperCase()}`;
  }
  const upper = value.toUpperCase();
  for (const quote of QUOTE_ASSETS) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return `${upper.slice(0, -quote.length)}/${quote}`;
    }
  }
  return upper;
}

/** Converte um notional USD em quantidade usando o último preço. Retorna null
 *  para entradas inválidas (nunca 0/NaN/Infinity). */
export function computeAmountFromUsd(amountUsd: number, lastPrice: number): number | null {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
  const amount = amountUsd / lastPrice;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function stableFeeFromEntry(entry: CcxtFee | undefined): number {
  if (!entry) return 0;
  const cost = entry.cost;
  const currency = String(entry.currency ?? "").toUpperCase();
  if (!Number.isFinite(cost) || typeof cost !== "number" || cost <= 0) return 0;
  // Só somamos fees cotadas em stable/moeda de referência USD; fees em BNB/base
  // são reportadas como 0 (honesto: não temos preço confiável daqui).
  return STABLE_ASSETS.has(currency) ? cost : 0;
}

/** Soma as fees cotadas em stable do pedido (fee, fees[], trades[].fee). */
export function parseFee(order: CcxtOrder | null | undefined): number {
  if (!order) return 0;
  let total = stableFeeFromEntry(order.fee);
  if (Array.isArray(order.fees)) {
    for (const f of order.fees) total += stableFeeFromEntry(f);
  }
  if (Array.isArray(order.trades)) {
    for (const t of order.trades) total += stableFeeFromEntry(t?.fee);
  }
  return total;
}

/** Extrai preço/qty efetivamente executados; null se não houver fill válido. */
export function parseOrderFill(
  order: CcxtOrder | null | undefined,
  fallbackPrice: number
): { filledPrice: number; filledQty: number } | null {
  if (!order) return null;
  const priceCandidate: unknown = order.average ?? order.price ?? fallbackPrice;
  const qtyCandidate: unknown = order.filled ?? order.amount;
  if (typeof priceCandidate !== "number" || !Number.isFinite(priceCandidate) || priceCandidate <= 0) {
    return null;
  }
  if (typeof qtyCandidate !== "number" || !Number.isFinite(qtyCandidate) || qtyCandidate <= 0) {
    return null;
  }
  return { filledPrice: priceCandidate, filledQty: qtyCandidate };
}

function lastPriceFromTicker(ticker: CexTicker | null | undefined): number | null {
  const last = ticker?.last ?? ticker?.close;
  return typeof last === "number" && Number.isFinite(last) && last > 0 ? last : null;
}

function fail(error: CexOrderErrorCode, reason: string): CexOrderFailure {
  return { ok: false, error, reason };
}

// ---------------------------------------------------------------------------
// Client factory (dynamic import — live code path only)
// ---------------------------------------------------------------------------
type ExchangeConstructor = new (config: Record<string, unknown>) => CexClient;

export async function createCexClient(creds: CexCredentials): Promise<CexClient> {
  const exchangeId = String(creds.exchange || "binance").toLowerCase();
  const mod = (await import("ccxt")) as unknown as Record<string, unknown>;
  const root = (mod.default ?? mod) as Record<string, unknown>;
  // Mocks de módulo (e proxies ESM) podem lançar ao acessar export inexistente;
  // tratar como "exchange não suportado" em vez de propagar erro cru.
  let candidate: unknown;
  try {
    candidate = root[exchangeId] ?? mod[exchangeId];
  } catch {
    candidate = undefined;
  }
  if (typeof candidate !== "function") {
    throw new CexAdapterError(
      "CEX_UNSUPPORTED_EXCHANGE",
      `exchange '${exchangeId}' não disponível no ccxt instalado`
    );
  }
  const config: Record<string, unknown> = {
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    enableRateLimit: true,
    options: { adjustForTimeDifference: true },
  };
  if (creds.apiPassphrase) config.password = creds.apiPassphrase;

  const instance = new (candidate as ExchangeConstructor)(config);
  const sandboxable = instance as unknown as { setSandboxMode?: (v: boolean) => void };
  if (creds.testnet && typeof sandboxable.setSandboxMode === "function") {
    sandboxable.setSandboxMode(true);
  }
  return instance;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export async function placeMarketOrder(
  client: CexClient,
  req: MarketOrderRequest
): Promise<CexOrderResult> {
  const symbol = normalizeSymbol(req.symbol);
  if (!symbol) return fail("CEX_INVALID_AMOUNT", "symbol vazio");

  let amount: number | null = null;
  let lastPrice = 0;
  try {
    await client.loadMarkets();
    const ticker = await client.fetchTicker(symbol);
    const last = lastPriceFromTicker(ticker);
    if (last === null) return fail("CEX_PRICE_UNAVAILABLE", `sem last price para ${symbol}`);
    lastPrice = last;
    amount =
      req.amount !== undefined
        ? Number.isFinite(req.amount) && req.amount > 0
          ? req.amount
          : null
        : computeAmountFromUsd(req.amountUsd, lastPrice);
    if (amount === null) return fail("CEX_INVALID_AMOUNT", `amountUsd inválido: ${req.amountUsd}`);

    let order = await client.createMarketOrder(symbol, req.side, amount);
    // fetchOrder é opcional (alguns exchanges preenchem o createMarketOrder).
    if (client.fetchOrder && order?.id) {
      try {
        order = (await client.fetchOrder(order.id, symbol)) ?? order;
      } catch {
        // mantém o retorno do createMarketOrder — não é falha de execução
      }
    }

    const fill = parseOrderFill(order, lastPrice);
    if (!fill) return fail("CEX_EXECUTION_FAILED", `ordem sem fill válido para ${symbol}`);

    return {
      ok: true,
      orderId: String(order.id ?? ""),
      filledPrice: fill.filledPrice,
      filledQty: fill.filledQty,
      amountUsd: fill.filledPrice * fill.filledQty,
      feeUsd: parseFee(order),
      raw: order,
    };
  } catch (err) {
    return fail("CEX_EXECUTION_FAILED", errorMessage(err));
  }
}

export async function placeLimitOrder(
  client: CexClient,
  req: LimitOrderRequest
): Promise<CexOrderResult> {
  const symbol = normalizeSymbol(req.symbol);
  if (!symbol) return fail("CEX_INVALID_AMOUNT", "symbol vazio");
  if (!Number.isFinite(req.limitPrice) || req.limitPrice <= 0) {
    return fail("CEX_INVALID_PRICE", "limitPrice inválido");
  }
  const amount = computeAmountFromUsd(req.amountUsd, req.limitPrice);
  if (amount === null) return fail("CEX_INVALID_AMOUNT", `amountUsd inválido: ${req.amountUsd}`);
  if (!client.createOrder) {
    return fail("CEX_EXECUTION_FAILED", "client sem createOrder (limite não suportado)");
  }
  try {
    await client.loadMarkets();
    const order = await client.createOrder(symbol, "limit", req.side, amount, req.limitPrice);
    const fill = parseOrderFill(order, req.limitPrice);
    return {
      ok: true,
      orderId: String(order.id ?? ""),
      filledPrice: fill?.filledPrice ?? req.limitPrice,
      filledQty: fill?.filledQty ?? amount,
      amountUsd: (fill?.filledPrice ?? req.limitPrice) * (fill?.filledQty ?? amount),
      feeUsd: parseFee(order),
      raw: order,
    };
  } catch (err) {
    return fail("CEX_EXECUTION_FAILED", errorMessage(err));
  }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------
export interface CexBalanceRow {
  asset: string;
  free: number;
  locked: number;
}

export async function fetchCexBalances(client: CexClient): Promise<CexBalanceRow[]> {
  let balance: CcxtBalance;
  try {
    balance = await client.fetchBalance();
  } catch (err) {
    throw new CexAdapterError("CEX_BALANCE_UNAVAILABLE", errorMessage(err));
  }
  const free = balance.free ?? {};
  const used = balance.used ?? {};
  const assets = new Set<string>([...Object.keys(free), ...Object.keys(used)]);
  const rows: CexBalanceRow[] = [];
  for (const asset of assets) {
    const freeQty = typeof free[asset] === "number" && Number.isFinite(free[asset]) ? free[asset] : 0;
    const lockedQty = typeof used[asset] === "number" && Number.isFinite(used[asset]) ? used[asset] : 0;
    if (freeQty === 0 && lockedQty === 0) continue;
    rows.push({ asset, free: freeQty, locked: lockedQty });
  }
  rows.sort((a, b) => a.asset.localeCompare(b.asset));
  return rows;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
