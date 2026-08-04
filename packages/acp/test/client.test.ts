import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AcpClient, textBlock } from "../src/client.js";
import type { AcpPermissionRequest, AcpSessionUpdate } from "../src/types.js";

interface AgentScript {
  /**
   * Replies to a client request. Returning undefined produces an error
   * response, so an unscripted method fails the test instead of hanging it.
   */
  respond?: (method: string, params: Record<string, unknown>) => unknown;
  /** Emitted after a matching request is answered. */
  after?: (
    method: string,
    params: Record<string, unknown>,
    agent: FakeAgent,
  ) => void | Promise<void>;
}

/**
 * A scripted ACP agent wired to a client over in-memory pipes, so the protocol
 * can be exercised without spawning `cursor-agent`.
 */
class FakeAgent {
  readonly client: AcpClient;
  readonly received: { method: string; params: Record<string, unknown> }[] = [];
  readonly updates: { sessionId: string; update: AcpSessionUpdate }[] = [];
  readonly permissionRequests: AcpPermissionRequest[] = [];
  #nextRequestId = 1000;
  #inbound = "";

  constructor(
    private readonly script: AgentScript,
    handlers: {
      onPermissionRequest?: (
        request: AcpPermissionRequest,
      ) => Promise<
        { outcome: "selected"; optionId: string } | { outcome: "cancelled" }
      >;
    } = {},
  ) {
    this.client = new AcpClient({
      write: (line) => this.#consume(line),
      onSessionUpdate: (sessionId, update) =>
        this.updates.push({ sessionId, update }),
      ...(handlers.onPermissionRequest
        ? { onPermissionRequest: handlers.onPermissionRequest }
        : {}),
    });
  }

  /** Pushes a `session/update` notification toward the client. */
  emitUpdate(sessionId: string, update: AcpSessionUpdate): void {
    this.client.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId, update },
      })}\n`,
    );
  }

  /** Sends an agent-to-client request and resolves with the client's response. */
  async ask(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.#nextRequestId++;
    const answered = new Promise<Record<string, unknown>>((resolve) => {
      this.#awaiting.set(id, resolve);
    });
    this.client.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    return await answered;
  }

  readonly #awaiting = new Map<
    number,
    (value: Record<string, unknown>) => void
  >();

  #consume(line: string): void {
    this.#inbound += line;
    let newline = this.#inbound.indexOf("\n");
    while (newline >= 0) {
      const raw = this.#inbound.slice(0, newline).trim();
      this.#inbound = this.#inbound.slice(newline + 1);
      if (raw) this.#handle(raw);
      newline = this.#inbound.indexOf("\n");
    }
  }

  #handle(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { message: string };
    };

    // A response to one of our agent-to-client requests.
    if (message.id !== undefined && message.method === undefined) {
      const resolve = this.#awaiting.get(message.id);
      if (resolve) {
        this.#awaiting.delete(message.id);
        resolve(message.result ?? { error: message.error });
      }
      return;
    }

    if (!message.method) return;
    const params = message.params ?? {};
    this.received.push({ method: message.method, params });

    if (message.id === undefined) return;

    const result = this.script.respond?.(message.method, params);
    if (result === undefined) {
      this.client.receive(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32601,
            message: `script did not handle ${message.method}`,
          },
        })}\n`,
      );
      return;
    }
    this.client.receive(
      `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`,
    );
    void this.script.after?.(message.method, params, this);
  }
}

describe("AcpClient handshake", () => {
  it("sends the protocol version and client capabilities", async () => {
    const agent = new FakeAgent({
      respond: (method) =>
        method === "initialize"
          ? {
              protocolVersion: 1,
              agentCapabilities: { loadSession: true },
              authMethods: [{ id: "cursor_login" }],
            }
          : undefined,
    });

    const result = await agent.client.initialize();

    assert.equal(result.protocolVersion, 1);
    assert.equal(agent.client.supportsLoadSession, true);
    assert.deepEqual(agent.received[0]?.params, {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
  });

  it("reports loadSession as unsupported when the agent omits it", async () => {
    const agent = new FakeAgent({
      respond: () => ({ protocolVersion: 1, agentCapabilities: {} }),
    });
    await agent.client.initialize();
    assert.equal(agent.client.supportsLoadSession, false);
  });
});

describe("AcpClient session lifecycle", () => {
  it("creates a session and forwards streaming updates in order", async () => {
    const agent = new FakeAgent({
      respond: (method) => {
        if (method === "initialize") return { protocolVersion: 1 };
        if (method === "session/new") {
          return {
            sessionId: "sess-1",
            modes: {
              currentModeId: "agent",
              availableModes: [{ id: "agent" }],
            },
            models: { currentModelId: "composer-2.5[fast=true]" },
          };
        }
        if (method === "session/prompt") return { stopReason: "end_turn" };
        return undefined;
      },
      after: (method, params, self) => {
        if (method !== "session/prompt") return;
        const sessionId = params.sessionId as string;
        self.emitUpdate(sessionId, {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "thinking" },
        });
        self.emitUpdate(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        });
        self.emitUpdate(sessionId, {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "Edit File",
          kind: "edit",
          status: "pending",
        });
        self.emitUpdate(sessionId, {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "completed",
        });
      },
    });

    await agent.client.initialize();
    const session = await agent.client.newSession({ cwd: "/work" });
    assert.equal(session.sessionId, "sess-1");

    const result = await agent.client.prompt({
      sessionId: session.sessionId,
      prompt: [textBlock("hi")],
    });
    assert.equal(result.stopReason, "end_turn");

    assert.deepEqual(
      agent.updates.map((entry) => entry.update.sessionUpdate),
      [
        "agent_thought_chunk",
        "agent_message_chunk",
        "tool_call",
        "tool_call_update",
      ],
    );
    assert.ok(agent.updates.every((entry) => entry.sessionId === "sess-1"));
  });

  it("passes cwd and an empty mcpServers list by default", async () => {
    const agent = new FakeAgent({ respond: () => ({ sessionId: "s" }) });
    await agent.client.newSession({ cwd: "/repo" });
    assert.deepEqual(agent.received[0]?.params, {
      cwd: "/repo",
      mcpServers: [],
    });
  });

  it("sends model and mode selection for the session", async () => {
    const agent = new FakeAgent({ respond: () => ({}) });
    await agent.client.setModel("s1", "claude-opus-5[thinking=true]");
    await agent.client.setMode("s1", "plan");

    assert.deepEqual(agent.received, [
      {
        method: "session/set_model",
        params: { sessionId: "s1", modelId: "claude-opus-5[thinking=true]" },
      },
      {
        method: "session/set_mode",
        params: { sessionId: "s1", modeId: "plan" },
      },
    ]);
  });

  it("cancels with a notification rather than a request", () => {
    const agent = new FakeAgent({});
    agent.client.cancel("s1");
    assert.deepEqual(agent.received, [
      { method: "session/cancel", params: { sessionId: "s1" } },
    ]);
  });

  it("ignores a session/update that carries no update payload", async () => {
    const agent = new FakeAgent({});
    agent.client.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "s1" },
      })}\n`,
    );
    assert.equal(agent.updates.length, 0);
  });
});

describe("AcpClient permission handling", () => {
  it("returns the option chosen by the approval handler", async () => {
    const agent = new FakeAgent(
      {},
      {
        onPermissionRequest: async (request) => {
          const allow = request.options.find(
            (option) => option.kind === "allow_once",
          );
          return { outcome: "selected", optionId: allow?.optionId ?? "" };
        },
      },
    );

    const response = await agent.ask("session/request_permission", {
      sessionId: "s1",
      toolCall: { toolCallId: "t1", title: "Write file" },
      options: [
        { optionId: "reject", kind: "reject_once" },
        { optionId: "allow", kind: "allow_once" },
      ],
    });

    assert.deepEqual(response, {
      outcome: { outcome: "selected", optionId: "allow" },
    });
  });

  it("denies by default when no approval handler is wired up", async () => {
    const agent = new FakeAgent({});
    const response = await agent.ask("session/request_permission", {
      sessionId: "s1",
      options: [
        { optionId: "allow", kind: "allow_once" },
        { optionId: "no", kind: "reject_once" },
      ],
    });

    assert.deepEqual(response, {
      outcome: { outcome: "selected", optionId: "no" },
    });
  });

  it("cancels when denying is not an offered option", async () => {
    const agent = new FakeAgent({});
    const response = await agent.ask("session/request_permission", {
      sessionId: "s1",
      options: [{ optionId: "allow", kind: "allow_once" }],
    });

    assert.deepEqual(response, { outcome: { outcome: "cancelled" } });
  });
});

describe("AcpClient filesystem bridge", () => {
  it("serves fs/read_text_file from the handler", async () => {
    const written: string[] = [];
    const client = new AcpClient({
      write: (line) => written.push(line),
      onReadTextFile: async ({ path }) => `contents of ${path}`,
    });

    client.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "fs/read_text_file",
        params: { path: "/repo/a.ts" },
      })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));

    const response = JSON.parse(written[0] ?? "{}") as {
      result?: { content: string };
    };
    assert.equal(response.result?.content, "contents of /repo/a.ts");
  });

  it("reports an error when a filesystem handler is absent", async () => {
    const written: string[] = [];
    const client = new AcpClient({ write: (line) => written.push(line) });

    client.receive(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "fs/write_text_file",
        params: { path: "/repo/a.ts", content: "x" },
      })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));

    const response = JSON.parse(written[0] ?? "{}") as {
      error?: { message: string };
    };
    assert.match(
      response.error?.message ?? "",
      /fs\/write_text_file is not supported/,
    );
  });
});
