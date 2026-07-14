import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { listExchanges, createExchange } from "@/lib/trading/wallet-manager";

// GET /api/exchanges — list all exchange connections
export async function GET() {
  try {
    const exchanges = await listExchanges();
    return NextResponse.json({ exchanges });
  } catch (err) {
    logger.error("api", `Erro listando exchanges: ${String(err)}`);
    return NextResponse.json({ error: "Failed to list exchanges" }, { status: 500 });
  }
}

// POST /api/exchanges — create a new exchange connection
// Body: { label, exchange, apiKey, apiSecret, apiPassphrase?, passphrase, testnet?, ipWhitelistConfigured? }
// SECURITY: passphrase is REQUIRED to encrypt the API credentials.
//          withdraw permission is hardcoded to false.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.label || !body.exchange || !body.apiKey || !body.apiSecret || !body.passphrase) {
      return NextResponse.json(
        { error: "Missing required fields: label, exchange, apiKey, apiSecret, passphrase" },
        { status: 400 }
      );
    }
    const exchange = await createExchange({
      label: String(body.label),
      exchange: String(body.exchange),
      apiKey: String(body.apiKey),
      apiSecret: String(body.apiSecret),
      apiPassphrase: body.apiPassphrase ? String(body.apiPassphrase) : undefined,
      passphrase: String(body.passphrase),
      testnet: body.testnet ?? false,
      ipWhitelistConfigured: body.ipWhitelistConfigured ?? false,
    });
    return NextResponse.json({ exchange });
  } catch (err) {
    logger.error("api", `Erro criando exchange: ${String(err)}`);
    return NextResponse.json({ error: "Failed to create exchange" }, { status: 500 });
  }
}
