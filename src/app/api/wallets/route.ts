import { NextResponse } from "next/server";
import { logger } from "@/lib/trading/logger";
import { listWallets, createWallet } from "@/lib/trading/wallet-manager";
import { getVaultStatus } from "@/lib/trading/wallet-manager";

// GET /api/wallets — list all wallet connections
export async function GET() {
  try {
    const [wallets, vaultStatus] = await Promise.all([listWallets(), Promise.resolve(getVaultStatus())]);
    return NextResponse.json({ wallets, vaultStatus });
  } catch (err) {
    logger.error("api", `Erro listando wallets: ${String(err)}`);
    return NextResponse.json({ error: "Failed to list wallets" }, { status: 500 });
  }
}

// POST /api/wallets — create a new wallet connection
// Body: { label, type, address, chain?, readOnly?, publicKey?, privateKey?, passphrase? }
// If privateKey is provided, passphrase is REQUIRED (used to encrypt).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.label || !body.type || !body.address) {
      return NextResponse.json(
        { error: "Missing required fields: label, type, address" },
        { status: 400 }
      );
    }
    if (body.privateKey && !body.passphrase) {
      return NextResponse.json(
        { error: "Passphrase required when privateKey is provided" },
        { status: 400 }
      );
    }
    const wallet = await createWallet({
      label: String(body.label),
      type: String(body.type),
      address: String(body.address),
      chain: body.chain ? String(body.chain) : undefined,
      readOnly: body.readOnly ?? false,
      publicKey: body.publicKey ? String(body.publicKey) : undefined,
      privateKey: body.privateKey ? String(body.privateKey) : undefined,
      passphrase: body.passphrase ? String(body.passphrase) : undefined,
    });
    return NextResponse.json({ wallet });
  } catch (err) {
    logger.error("api", `Erro criando wallet: ${String(err)}`);
    return NextResponse.json({ error: "Failed to create wallet" }, { status: 500 });
  }
}
