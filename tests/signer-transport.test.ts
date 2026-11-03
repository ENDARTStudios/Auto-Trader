import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import {
  SIGNER_TRANSPORT_ERROR,
  UnixSocketSignerTransport,
  makeSignerAdapterFromEnv,
  maskSignerSocketPath,
} from '@/lib/chain/signer-transport';
import { SignerAdapter, type SignerTransport } from '@/lib/chain/signer-adapter';
import type { SignerRequest } from '@/lib/chain/pipeline';
import { JSONRPC_VERSION, SIGNER_PROTOCOL_VERSION } from '@/lib/signer-protocol';

// Round 2 — REAL signer transport (newline-delimited JSON-RPC over a socket).
// Tests use an in-process TCP mock server (works on Windows where AF_UNIX is
// restricted). The production wire is a Unix socket; the framing/parsing code
// path is identical, only the connect target differs.

interface MockSignerServer {
  port: number;
  url: string;
  connections: () => number;
  methods: () => string[];
  close: () => Promise<void>;
}

type FrameHandler = (line: string, socket: net.Socket) => void;

async function startMockSigner(handler: FrameHandler): Promise<MockSignerServer> {
  let connectionCount = 0;
  const methodsSeen: string[] = [];
  const openSockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    connectionCount += 1;
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) {
          try {
            methodsSeen.push(String((JSON.parse(line) as { method?: unknown }).method));
          } catch {
            methodsSeen.push('<invalid-json>');
          }
          handler(line, socket);
        }
        newline = buffer.indexOf('\n');
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    url: 'tcp://127.0.0.1:' + address.port,
    connections: () => connectionCount,
    methods: () => methodsSeen,
    close: async () => {
      for (const socket of openSockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const servers: MockSignerServer[] = [];

async function mockSigner(handler: FrameHandler): Promise<MockSignerServer> {
  const srv = await startMockSigner(handler);
  servers.push(srv);
  return srv;
}

function parseRequest(line: string): { id: string; method: string; params?: unknown } {
  return JSON.parse(line) as { id: string; method: string; params?: unknown };
}

function writeSuccess(socket: net.Socket, id: string, result: unknown): void {
  socket.write(JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, result }) + '\n');
}

function writeError(socket: net.Socket, id: string, code: number, message: string): void {
  socket.write(JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, error: { code, message } }) + '\n');
}

afterEach(async () => {
  while (servers.length > 0) {
    const srv = servers.pop();
    if (srv) await srv.close();
  }
  delete process.env.SIGNER_SOCKET_PATH;
  delete process.env.SIGNER_PROTOCOL_VERSION;
});

describe('UnixSocketSignerTransport — JSON-RPC framing', () => {
  it('health_check: sends a JSON-RPC 2.0 request without params and parses the result', async () => {
    let received: { id: string; method: string; hasParams: boolean; jsonrpc?: string } | null = null;
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line) as unknown as { id: string; method: string; jsonrpc?: string };
      received = {
        id: req.id,
        method: req.method,
        hasParams: line.includes('"params"'),
        jsonrpc: req.jsonrpc,
      };
      writeSuccess(socket, req.id, { version: SIGNER_PROTOCOL_VERSION });
    });

    const transport = new UnixSocketSignerTransport({ socketPath: srv.url, connectTimeoutMs: 1000 });
    const res = await transport.rpc('health_check', undefined, 2000);

    expect(res.ok).toBe(true);
    expect((res.result as { version: string }).version).toBe(SIGNER_PROTOCOL_VERSION);
    expect(received).not.toBeNull();
    expect(received!.method).toBe('health_check');
    expect(received!.hasParams).toBe(false);
    expect(received!.jsonrpc).toBe(JSONRPC_VERSION);
    expect(srv.connections()).toBe(1);
  });

  it('returns ok=false with the signer error code/message (application-level rejection)', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      writeError(socket, req.id, -32008, 'SIGNER_VAULT_LOCKED: vault is locked');
    });
    const transport = new UnixSocketSignerTransport({ socketPath: srv.url });
    const res = await transport.rpc('getVaultStatus', undefined, 2000);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe(-32008);
    expect(res.error?.message).toContain('VAULT_LOCKED');
  });

  it('rejects a malformed (non-JSON) frame as SIGNER_INVALID_RESPONSE', async () => {
    const srv = await mockSigner((_line, socket) => {
      socket.write('this-is-not-json\n');
    });
    const transport = new UnixSocketSignerTransport({ socketPath: srv.url });
    await expect(transport.rpc('health_check', undefined, 2000)).rejects.toThrow(
      /SIGNER_INVALID_RESPONSE/,
    );
  });

  it('rejects a response whose id does not match the request id', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      writeSuccess(socket, req.id + '-confused', { version: SIGNER_PROTOCOL_VERSION });
    });
    const transport = new UnixSocketSignerTransport({ socketPath: srv.url });
    await expect(transport.rpc('health_check', undefined, 2000)).rejects.toThrow(
      /SIGNER_INVALID_RESPONSE/,
    );
  });

  it('rejects a response without jsonrpc/result/error fields', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      socket.write(JSON.stringify({ id: req.id, result: { version: 'x' } }) + '\n');
    });
    const transport = new UnixSocketSignerTransport({ socketPath: srv.url });
    await expect(transport.rpc('health_check', undefined, 2000)).rejects.toThrow(
      /SIGNER_INVALID_RESPONSE/,
    );
  });

  it('enforces maxFrameBytes on an unbounded frame (no newline)', async () => {
    const srv = await mockSigner((_line, socket) => {
      socket.write('x'.repeat(4096));
    });
    const transport = new UnixSocketSignerTransport({
      socketPath: srv.url,
      maxFrameBytes: 512,
    });
    await expect(transport.rpc('health_check', undefined, 2000)).rejects.toThrow(
      /SIGNER_INVALID_RESPONSE/,
    );
  });

  it('enforces maxFrameBytes on a complete oversized frame', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      socket.write('y'.repeat(1024) + '\n');
    });
    const transport = new UnixSocketSignerTransport({
      socketPath: srv.url,
      maxFrameBytes: 512,
    });
    await expect(transport.rpc('health_check', undefined, 2000)).rejects.toThrow(
      /SIGNER_INVALID_RESPONSE/,
    );
  });
});

describe('UnixSocketSignerTransport — failure modes (no retry, no fallback)', () => {
  it('times out as SIGNER_TIMEOUT when the signer never answers', async () => {
    const srv = await mockSigner(() => {
      /* accept and never respond */
    });
    const transport = new UnixSocketSignerTransport({ socketPath: srv.url, connectTimeoutMs: 500 });
    await expect(transport.rpc('health_check', undefined, 120)).rejects.toThrow(/SIGNER_TIMEOUT/);
    // No retry: exactly one connection for one rpc() call.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(srv.connections()).toBe(1);
  });

  it('rejects as SIGNER_UNAVAILABLE when the socket is not listening (connection refused)', async () => {
    const dead = await startMockSigner(() => {
      /* never used */
    });
    const deadUrl = dead.url;
    await dead.close();
    const transport = new UnixSocketSignerTransport({ socketPath: deadUrl, connectTimeoutMs: 500 });
    await expect(transport.rpc('health_check', undefined, 1000)).rejects.toThrow(
      /SIGNER_UNAVAILABLE/,
    );
  });

  it('classifies transport errors with stable code prefixes', () => {
    expect(SIGNER_TRANSPORT_ERROR.TIMEOUT).toBe('SIGNER_TIMEOUT');
    expect(SIGNER_TRANSPORT_ERROR.UNAVAILABLE).toBe('SIGNER_UNAVAILABLE');
    expect(SIGNER_TRANSPORT_ERROR.INVALID_RESPONSE).toBe('SIGNER_INVALID_RESPONSE');
  });

  it('passes the unix socket path to the injected connection factory', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      writeSuccess(socket, req.id, { version: SIGNER_PROTOCOL_VERSION });
    });
    let capturedPath: string | undefined;
    const transport = new UnixSocketSignerTransport({
      socketPath: '/tmp/signer-test.sock',
      protocol: 'unix',
      createConnection: (target) => {
        capturedPath = target.path;
        // Ignore the unix path (Windows CI) and talk to the TCP mock instead.
        return net.createConnection({ host: '127.0.0.1', port: srv.port });
      },
    });
    const res = await transport.rpc('health_check', undefined, 2000);
    expect(res.ok).toBe(true);
    expect(capturedPath).toBe('/tmp/signer-test.sock');
  });
});

describe('UnixSocketSignerTransport + SignerAdapter (real wire contract)', () => {
  const validRequest: SignerRequest = {
    tx: { from: '0xfrom', to: '0xto', value: '0', data: '0x' },
    expectedDiff: { changes: [] },
    approvedAmount: '1.0',
    slippageLimitBps: 50,
    sandwichScore: 0,
  };

  it('verifies protocol then signs through the real transport', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      if (req.method === 'health_check') {
        writeSuccess(socket, req.id, { version: SIGNER_PROTOCOL_VERSION });
        return;
      }
      if (req.method === 'signTransaction') {
        const params = req.params as { requestId: string; payloadHash: string };
        writeSuccess(socket, req.id, {
          ok: true,
          txHash: '0xabc123',
          requestId: params.requestId,
          receivedPayloadHash: params.payloadHash,
          signerVersion: SIGNER_PROTOCOL_VERSION,
        });
        return;
      }
      writeError(socket, req.id, -32601, 'Method not found');
    });

    const transport = new UnixSocketSignerTransport({ socketPath: srv.url });
    const adapter = new SignerAdapter({
      transport,
      expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
      requestTimeoutMs: 3000,
      probeTimeoutMs: 3000,
    });

    const result = await adapter.submit(validRequest);
    expect(result).toEqual({ ok: true, txHash: '0xabc123' });
    expect(srv.methods()).toEqual(['health_check', 'signTransaction']);
    // one connection per RPC call — no pooling/reconnection
    expect(srv.connections()).toBe(2);
  });

  it('fails closed on protocol mismatch and never sends the sign request', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      writeSuccess(socket, req.id, { version: '0.0.0-incompatible' });
    });
    const transport: SignerTransport = new UnixSocketSignerTransport({ socketPath: srv.url });
    const adapter = new SignerAdapter({
      transport,
      expectedProtocolVersion: SIGNER_PROTOCOL_VERSION,
      probeTimeoutMs: 3000,
    });
    const result = await adapter.submit(validRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^SIGNER_PROTOCOL_MISMATCH/);
    expect(srv.methods()).toEqual(['health_check']);
  });
});

describe('makeSignerAdapterFromEnv', () => {
  it('fails closed (throws) when SIGNER_SOCKET_PATH is not configured', () => {
    delete process.env.SIGNER_SOCKET_PATH;
    expect(() => makeSignerAdapterFromEnv()).toThrow(/SIGNER_SOCKET_PATH/);
  });

  it('builds an adapter from SIGNER_SOCKET_PATH (tcp:// for tests) and verifies the protocol', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      writeSuccess(socket, req.id, { version: SIGNER_PROTOCOL_VERSION });
    });
    process.env.SIGNER_SOCKET_PATH = srv.url;
    delete process.env.SIGNER_PROTOCOL_VERSION;
    const adapter = makeSignerAdapterFromEnv({ probeTimeoutMs: 3000 });
    await expect(adapter.verifyProtocol()).resolves.toEqual({ ok: true });
    expect(srv.methods()).toEqual(['health_check']);
  });

  it('honors SIGNER_PROTOCOL_VERSION as the expected version', async () => {
    const srv = await mockSigner((line, socket) => {
      const req = parseRequest(line);
      writeSuccess(socket, req.id, { version: '9.9.9-test' });
    });
    process.env.SIGNER_SOCKET_PATH = srv.url;
    process.env.SIGNER_PROTOCOL_VERSION = '9.9.9-test';
    const adapter = makeSignerAdapterFromEnv({ probeTimeoutMs: 3000 });
    await expect(adapter.verifyProtocol()).resolves.toEqual({ ok: true });
  });
});

describe('maskSignerSocketPath — never leaks the full path', () => {
  it('masks a unix socket path', () => {
    const masked = maskSignerSocketPath('/run/signer/signer-1234.sock');
    expect(masked).not.toBeNull();
    expect(masked).not.toContain('/run/signer');
    expect(masked).not.toContain('signer-1234.sock');
    expect(masked).toContain('…/');
  });

  it('masks a tcp socket path (port hidden)', () => {
    const masked = maskSignerSocketPath('tcp://127.0.0.1:7654');
    expect(masked).toBe('tcp://127.0.0.1:****');
    expect(masked).not.toContain('7654');
  });

  it('returns null for empty/absent paths', () => {
    expect(maskSignerSocketPath(null)).toBeNull();
    expect(maskSignerSocketPath(undefined)).toBeNull();
    expect(maskSignerSocketPath('   ')).toBeNull();
  });
});

describe('GET /api/signer/health — auth gate', () => {
  it('401 without a session cookie', async () => {
    const mod = await import('@/app/api/signer/health/route');
    const res = await mod.GET(new Request('http://localhost/api/signer/health'));
    expect([401, 403]).toContain(res.status);
  });

  it('401 with a forged session cookie (checked before touching the signer)', async () => {
    const mod = await import('@/app/api/signer/health/route');
    const res = await mod.GET(
      new Request('http://localhost/api/signer/health', {
        headers: { cookie: 'session=' + 'a'.repeat(64) + '.' + '0'.repeat(64) },
      }),
    );
    expect([401, 403]).toContain(res.status);
  });
});
