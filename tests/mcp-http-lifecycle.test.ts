import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppService } from "../src/server/app-service";
import type { Db } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";

const boundary = vi.hoisted(() => ({ fetch: vi.fn<(request: Request) => Promise<Response>>(), authenticate: vi.fn() }));
// This suite isolates the HTTP adapter's ownership of a real TCP connection.
// Authentication, SDK negotiation and domain effects have their own real-SDK suite.
vi.mock("../src/server/mcp", () => ({
  createTasktopiaMcpHandler: () => ({ fetch: boundary.fetch }),
  getMcpAuthentication: async () => { await boundary.authenticate(); return { authInfo: { token: "isolated-route-test", clientId: "route-test", scopes: [] } }; },
}));

type Connection = {
  request: IncomingMessage;
  response: ServerResponse;
  requestAbortedListeners: number;
  responseCloseListeners: number;
  responseCloseListenerBaseline: ReturnType<ServerResponse["listeners"]>;
};

describe("MCP HTTP adapter connection ownership", () => {
  let app: FastifyInstance;
  let url: string;
  let connections: Connection[];
  beforeEach(async () => {
    boundary.fetch.mockReset();
    boundary.authenticate.mockReset();
    connections = [];
    app = Fastify();
    app.addHook("onRequest", (request, reply, done) => {
      connections.push({ request: request.raw, response: reply.raw,
        requestAbortedListeners: request.raw.listenerCount("aborted"),
        responseCloseListeners: reply.raw.listenerCount("close"),
        responseCloseListenerBaseline: reply.raw.listeners("close") });
      done();
    });
    registerMcpHttp(app, {} as Db, {} as AppService, "http://localhost:3000");
    url = await app.listen({ host: "127.0.0.1", port: 0 }) + "/mcp";
  });
  afterEach(async () => { await app?.close(); });

  const post = () => fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const expectReleased = async (connection: Connection) => {
    await vi.waitFor(() => {
      expect(connection.request.listenerCount("aborted")).toBe(connection.requestAbortedListeners);
      expect(connection.response.listenerCount("close")).toBe(connection.responseCloseListeners);
    }, { timeout: 1000 });
  };

  it("releases adapter listeners after each successful empty response without aborting its signal", async () => {
    const signals: AbortSignal[] = [];
    boundary.fetch.mockImplementation(async request => {
      signals.push(request.signal);
      return new Response(null, { status: 204 });
    });
    for (let index = 0; index < 3; index++) {
      expect((await post()).status).toBe(204);
      await expectReleased(connections[index]!);
    }
    expect(signals).toHaveLength(3);
    expect(signals.every(signal => !signal.aborted)).toBe(true);
  });

  it("releases adapter listeners when the SDK boundary rejects before returning a response", async () => {
    boundary.fetch.mockRejectedValueOnce(new Error("isolated upstream failure"));
    expect((await post()).status).toBe(500);
    await expectReleased(connections[0]!);
  });

  it("finishes a real response stream without aborting the SDK signal or retaining its close listener", async () => {
    let signal: AbortSignal | undefined;
    let adapterCloseListeners: ReturnType<ServerResponse["listeners"]> = [];
    boundary.fetch.mockImplementationOnce(async request => {
      signal = request.signal;
      const connection = connections[0]!;
      adapterCloseListeners = connection.response.listeners("close")
        .filter(listener => !connection.responseCloseListenerBaseline.includes(listener));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
        headers: { "content-type": "application/json" },
      });
    });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
    expect(adapterCloseListeners).toHaveLength(1);
    await vi.waitFor(() => {
      const connection = connections[0]!;
      expect(connection.request.listenerCount("aborted")).toBe(connection.requestAbortedListeners);
      expect(adapterCloseListeners.every(listener => !connection.response.listeners("close").includes(listener))).toBe(true);
    }, { timeout: 1000 });
    expect(signal?.aborted).toBe(false);
  });

  it("aborts pending SDK work when the client disconnects after its complete request body", async () => {
    let entered!: () => void;
    let release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    let signal: AbortSignal | undefined;
    boundary.fetch.mockImplementationOnce(async request => {
      signal = request.signal;
      entered();
      await held;
      return new Response(null, { status: 204 });
    });
    const request = httpRequest(url, { method: "POST", headers: { "content-type": "application/json" } });
    request.on("error", () => { /* The test deliberately disconnects this socket. */ });
    request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    try {
      await entering;
      expect(connections[0]!.request.complete).toBe(true);
      request.destroy();
      await vi.waitFor(() => { expect(signal?.aborted).toBe(true); }, { timeout: 1000 });
    } finally {
      request.destroy();
      release();
      await expectReleased(connections[0]!);
    }
  });

  it("preserves a disconnect that occurs while token authentication is pending", async () => {
    let entered!: () => void, release!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    boundary.authenticate.mockImplementationOnce(async () => { entered(); await held; });
    let signal: AbortSignal | undefined;
    boundary.fetch.mockImplementationOnce(async request => { signal = request.signal; return new Response(null, { status: 204 }); });
    const request = httpRequest(url, { method: "POST", headers: { "content-type": "application/json" } });
    request.on("error", () => { /* Intentionally disconnected before authorization completes. */ });
    request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    try {
      await entering; request.destroy();
      await vi.waitFor(() => expect(connections[0]!.response.destroyed).toBe(true), { interval: 10 });
      release();
      await vi.waitFor(() => expect(signal?.aborted).toBe(true), { interval: 10 });
      await expectReleased(connections[0]!);
    } finally { release(); request.destroy(); }
  });
});
