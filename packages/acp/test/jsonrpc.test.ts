import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AcpClosedError,
  AcpRpcError,
  JsonRpcConnection,
} from "../src/jsonrpc.js";

function harness() {
  const written: string[] = [];
  const decodeErrors: string[] = [];
  const notifications: { method: string; params: unknown }[] = [];
  let onRequest:
    | ((method: string, params: unknown) => Promise<unknown>)
    | undefined;

  const connection = new JsonRpcConnection({
    write: (line) => written.push(line),
    onDecodeError: (line) => decodeErrors.push(line),
    onNotification: (method, params) => notifications.push({ method, params }),
    onRequest: (method, params) => {
      if (!onRequest) throw new Error("no handler");
      return onRequest(method, params);
    },
  });

  return {
    connection,
    written,
    decodeErrors,
    notifications,
    setRequestHandler(
      handler: (method: string, params: unknown) => Promise<unknown>,
    ) {
      onRequest = handler;
    },
    lastSent(): Record<string, unknown> {
      return JSON.parse(written[written.length - 1] ?? "{}") as Record<
        string,
        unknown
      >;
    },
  };
}

describe("JsonRpcConnection framing", () => {
  it("resolves a request when the matching response arrives", async () => {
    const h = harness();
    const pending = h.connection.request<{ ok: boolean }>("initialize", {
      a: 1,
    });

    const sent = h.lastSent();
    assert.equal(sent.jsonrpc, "2.0");
    assert.equal(sent.method, "initialize");
    assert.deepEqual(sent.params, { a: 1 });

    h.connection.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { ok: true } })}\n`,
    );
    assert.deepEqual(await pending, { ok: true });
  });

  it("reassembles a message split across chunks", async () => {
    const h = harness();
    const pending = h.connection.request<string>("ping");
    const id = h.lastSent().id;
    const encoded = JSON.stringify({ jsonrpc: "2.0", id, result: "pong" });

    h.connection.receive(encoded.slice(0, 10));
    h.connection.receive(encoded.slice(10));
    h.connection.receive("\n");

    assert.equal(await pending, "pong");
  });

  it("dispatches several messages delivered in one chunk", async () => {
    const h = harness();
    const first = h.connection.request<number>("a");
    const firstId = h.lastSent().id;
    const second = h.connection.request<number>("b");
    const secondId = h.lastSent().id;

    h.connection.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: firstId, result: 1 })}\n` +
        `${JSON.stringify({ jsonrpc: "2.0", id: secondId, result: 2 })}\n`,
    );

    assert.equal(await first, 1);
    assert.equal(await second, 2);
  });

  it("skips malformed lines without breaking later messages", async () => {
    const h = harness();
    const pending = h.connection.request<string>("ping");
    const id = h.lastSent().id;

    h.connection.receive("Downloading update...\n");
    h.connection.receive("{not json\n");
    h.connection.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id, result: "ok" })}\n`,
    );

    assert.equal(await pending, "ok");
    assert.deepEqual(h.decodeErrors, ["Downloading update...", "{not json"]);
  });

  it("rejects with AcpRpcError when the peer returns an error", async () => {
    const h = harness();
    const pending = h.connection.request("session/new");
    const id = h.lastSent().id;

    h.connection.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "not authenticated" },
      })}\n`,
    );

    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof AcpRpcError);
    assert.equal(error.code, -32000);
    assert.match(error.message, /session\/new: not authenticated/);
  });

  it("routes notifications to the notification handler", () => {
    const h = harness();
    h.connection.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "s1" },
      })}\n`,
    );
    assert.deepEqual(h.notifications, [
      { method: "session/update", params: { sessionId: "s1" } },
    ]);
  });

  it("answers requests from the peer with a result", async () => {
    const h = harness();
    h.setRequestHandler(async (method) => ({ echoed: method }));

    h.connection.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "session/request_permission",
        params: {},
      })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(h.lastSent(), {
      jsonrpc: "2.0",
      id: 99,
      result: { echoed: "session/request_permission" },
    });
  });

  it("reports method-not-found when no request handler is registered", async () => {
    const written: string[] = [];
    const connection = new JsonRpcConnection({
      write: (line) => written.push(line),
    });

    connection.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file" })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));

    const response = JSON.parse(written[0] ?? "{}") as {
      error?: { code: number; message: string };
    };
    assert.equal(response.error?.code, -32601);
    assert.match(response.error?.message ?? "", /fs\/read_text_file/);
  });

  it("converts a handler failure into an internal error response", async () => {
    const h = harness();
    h.setRequestHandler(async () => {
      throw new Error("approval UI unavailable");
    });

    h.connection.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "session/request_permission" })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));

    const sent = h.lastSent() as { error?: { code: number; message: string } };
    assert.equal(sent.error?.code, -32603);
    assert.equal(sent.error?.message, "approval UI unavailable");
  });

  it("rejects in-flight calls when the connection closes", async () => {
    const h = harness();
    const pending = h.connection.request("session/prompt");
    assert.equal(h.connection.pendingCount, 1);

    h.connection.close("agent exited");

    const error = await pending.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    assert.ok(error instanceof AcpClosedError);
    assert.match(error.message, /agent exited/);
    assert.equal(h.connection.pendingCount, 0);
  });

  it("ignores a response for an unknown id", () => {
    const h = harness();
    h.connection.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: 4321, result: 1 })}\n`,
    );
    assert.equal(h.decodeErrors.length, 0);
  });
});
