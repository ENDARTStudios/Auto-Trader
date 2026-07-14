import { Broadcaster, BroadcasterError } from "./src/lib/chain/broadcaster";
import { QuorumRpcClient, type RpcEndpoint, type Transport, type BroadcastResult } from "./src/lib/chain/rpc-resilience";
import { SignerAdapter, type SignerTransport, type SignerWireRequest, type RpcResponse } from "./src/lib/chain/signer-adapter";
import { Wallet } from "ethers";
import { SIGNER_PROTOCOL_VERSION } from "./src/lib/signer-protocol";

const TEST_WALLET = Wallet.createRandom();

const rpcTransportObj = {
  calls: [] as any[],
  scripts: {} as Record<string, any[]>,
  broadcastHandler: null as null | ((rawTx: string) => Promise<BroadcastResult>),
  asTransport(): Transport {
    return async (url, method, params) => {
      this.calls.push({ url, method, params });
      if (method === "eth_sendRawTransaction") {
        if (this.broadcastHandler) {
          const r = await this.broadcastHandler(params[0] as string);
          if (!r.ok) throw new Error(r.error ?? "broadcast failed");
          return r.txHash;
        }
        return "0x" + "00".repeat(32);
      }
      const s = this.scripts[method];
      if (!s) throw new Error("no script for " + method);
      for (const e of s) {
        if (e.kind === "value") return e.value;
        if (e.kind === "error") throw new Error(e.message);
      }
      throw new Error("exhausted " + method);
    };
  },
};

const signerTransport: SignerTransport = {
  async rpc(method, params, timeoutMs) {
    if (method === "health_check") return { ok: true, result: { status: "ok", pid: 1, version: SIGNER_PROTOCOL_VERSION, uptimeMs: 1 } };
    if (method === "signTransaction") {
      const wireReq = params as SignerWireRequest;
      const tx = wireReq.payload.tx as any;
      const rawSignedTx = await TEST_WALLET.signTransaction({ to: tx.to, value: tx.value, data: tx.data, nonce: tx.nonce ?? 0, gasLimit: tx.gasLimit ?? "0x5208", maxFeePerGas: tx.maxFeePerGas ?? "0x2540be400", maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? "0x9502f900", type: 2, chainId: 1 });
      const { Transaction } = await import("ethers");
      const txHash = Transaction.from(rawSignedTx).hash;
      return { ok: true, result: { ok: true, txHash, rawSignedTx, requestId: wireReq.requestId, receivedPayloadHash: wireReq.payloadHash, signerVersion: SIGNER_PROTOCOL_VERSION } };
    }
    return { ok: false, error: { code: -32601, message: "nf" } };
  },
};

rpcTransportObj.scripts["eth_getTransactionCount"] = [{ kind: "value", value: "0x5" }];
rpcTransportObj.scripts["eth_estimateGas"] = [{ kind: "value", value: "0x5208" }];
rpcTransportObj.scripts["eth_feeHistory"] = [{ kind: "value", value: { baseFeePerGas: ["0x1","0x2","0x3","0x4","0x5"], reward: [["0x3e8"]] } }];
rpcTransportObj.broadcastHandler = async () => ({ ok: false, broadcastBy: null, failedOver: false, error: "nonce too low" });

const rpcClient = new QuorumRpcClient({ endpoints: [{ id: "alpha", url: "https://alpha.example", priority: 100 }], transport: rpcTransportObj.asTransport(), callTimeoutMs: 1000 });
const signerAdapter = new SignerAdapter({ transport: signerTransport, expectedProtocolVersion: SIGNER_PROTOCOL_VERSION });
const broadcaster = new Broadcaster({ rpc: rpcClient, signerAdapter });

const result = await broadcaster.submit({ tx: { from: TEST_WALLET.address, to: "0x0000000000000000000000000000000000000002", value: "0", data: "0x" }, expectedDiff: { changes: [] }, approvedAmount: "0", slippageLimitBps: 300, sandwichScore: 0 });
console.log("RESULT:", JSON.stringify(result, null, 2));
