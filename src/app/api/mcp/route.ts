import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/rbac";
import { ForbiddenError } from "@/lib/auth/errors";
import { handleApiError } from "@/lib/api/error-handler";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Bridge read-only no estilo MCP (JSON-RPC 2.0): expõe dados do workspace para
// agentes externos SEM nenhuma capacidade de escrita. Cada tool é somente
// leitura e respeita a sessão + RBAC do chamador.

const TOOLS = [
  {
    name: "positions_list",
    description: "Posições abertas do usuário (símbolo, tamanho, entrada, P&L não realizado).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portfolio_summary",
    description: "Resumo do portfólio: posições abertas, capital deployado e último equity registrado.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "orders_list",
    description: "Ordens em paper com estado persistido e histórico de transições.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "risk_status",
    description: "Estado de risco: modo, kill switch e limites configurados.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: ToolName; arguments?: Record<string, unknown> };
}

async function callTool(name: ToolName, userId: string) {
  if (name === "positions_list") {
    const rows = await db.position.findMany({
      where: { ownerId: userId, status: "open" },
      orderBy: { entryAt: "desc" },
      select: {
        id: true,
        symbol: true,
        source: true,
        entryPriceUsd: true,
        entryAmountUsd: true,
        entryAt: true,
      },
    });
    return { positions: rows };
  }

  if (name === "portfolio_summary") {
    const [open, latest] = await Promise.all([
      db.position.findMany({
        where: { ownerId: userId, status: "open" },
        select: { entryAmountUsd: true },
      }),
      db.performanceSnapshot.findFirst({ orderBy: { timestamp: "desc" } }).catch(() => null),
    ]);
    const deployed = open.reduce((sum, p) => sum + (Number.isFinite(p.entryAmountUsd) ? p.entryAmountUsd : 0), 0);
    return {
      openPositions: open.length,
      deployedUsd: Number(deployed.toFixed(2)),
      lastEquityUsd: latest?.totalEquityUsd ?? null,
      lastSnapshotAt: latest?.timestamp ?? null,
    };
  }

  if (name === "orders_list") {
    const rows = await db.paperOrder.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    return { orders: rows };
  }

  const cfg = await db.config.findUnique({ where: { id: "singleton" } });
  return {
    mode: cfg?.mode ?? "paper",
    killSwitchActive: Boolean(cfg?.killSwitchActive),
    killSwitchReason: cfg?.killSwitchReason ?? null,
    limits: {
      maxDailyLossPct: cfg?.maxDailyLossPct ?? null,
      maxDrawdownPct: cfg?.maxDrawdownPct ?? null,
      maxLossPerTradePct: cfg?.maxLossPerTradePct ?? null,
      reservePct: cfg?.reservePct ?? null,
    },
  };
}

export async function GET() {
  return NextResponse.json({
    name: "auto-trader",
    version: "1.0.0",
    transport: "json-rpc-2.0",
    readOnly: true,
    tools: TOOLS,
  });
}

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    if (!hasPermission(session.role, "dashboard:read")) throw new ForbiddenError("dashboard:read");

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const rl = checkRateLimit(ip, "/api/mcp");
    if (!rl.allowed) {
      return NextResponse.json(
        { jsonrpc: "2.0", id: null, error: { code: -32000, message: "rate_limited" } },
        { status: 429 }
      );
    }

    const rpc = (await req.json().catch(() => ({}))) as RpcRequest;
    const id = rpc.id ?? null;
    const reply = (result: unknown) => NextResponse.json({ jsonrpc: "2.0", id, result });
    const error = (code: number, message: string) => NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });

    if (rpc.method === "initialize") {
      return reply({ protocolVersion: "2024-11-05", serverInfo: { name: "auto-trader", version: "1.0.0" }, capabilities: { tools: {} } });
    }
    if (rpc.method === "tools/list") {
      return reply({ tools: TOOLS });
    }
    if (rpc.method === "tools/call") {
      const name = rpc.params?.name;
      if (!name || !TOOLS.some((t) => t.name === name)) return error(-32602, "unknown_tool");
      const data = await callTool(name as ToolName, session.userId);
      return reply({ content: [{ type: "text", text: JSON.stringify(data) }], isError: false });
    }

    return error(-32601, "method_not_found");
  } catch (err) {
    return handleApiError(err, "POST /api/mcp");
  }
}
