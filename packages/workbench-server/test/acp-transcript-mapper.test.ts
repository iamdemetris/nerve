import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AcpTranscriptMapper,
  mapAcpToolRisk,
  mapAcpToolStatus,
  normalizeToolCallId,
  type AcpTranscriptContext,
} from "../src/domains/acp/acp-transcript-mapper.js";

const context: AcpTranscriptContext = {
  agentId: "agent_1",
  conversationId: "conv_1",
  projectId: "proj_1",
  runId: "run_1",
  turnId: "turn_1",
  cwd: "/repo",
};

function mapper(): AcpTranscriptMapper {
  let tick = 0;
  return new AcpTranscriptMapper(context, () =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
  );
}

describe("mapAcpToolRisk", () => {
  it("maps read-like kinds to read", () => {
    assert.equal(mapAcpToolRisk("read"), "read");
    assert.equal(mapAcpToolRisk("search"), "read");
    assert.equal(mapAcpToolRisk("think"), "read");
  });

  it("maps mutating kinds to their matching risk", () => {
    assert.equal(mapAcpToolRisk("edit"), "workspace_write");
    assert.equal(mapAcpToolRisk("move"), "workspace_write");
    assert.equal(mapAcpToolRisk("delete"), "destructive");
    assert.equal(mapAcpToolRisk("execute"), "command");
    assert.equal(mapAcpToolRisk("fetch"), "network");
  });

  it("treats an unknown or missing kind as a command rather than a read", () => {
    assert.equal(mapAcpToolRisk("teleport"), "command");
    assert.equal(mapAcpToolRisk(undefined), "command");
  });
});

describe("mapAcpToolStatus", () => {
  it("maps every ACP status onto a Nerve status", () => {
    assert.equal(mapAcpToolStatus("pending"), "requested");
    assert.equal(mapAcpToolStatus("in_progress"), "running");
    assert.equal(mapAcpToolStatus("completed"), "completed");
    assert.equal(mapAcpToolStatus("failed"), "error");
    assert.equal(mapAcpToolStatus(undefined), "requested");
  });
});

describe("normalizeToolCallId", () => {
  it("keeps an already-prefixed id", () => {
    assert.equal(normalizeToolCallId("tool_abc"), "tool_abc");
  });

  it("adds the prefix Nerve identifiers require", () => {
    assert.equal(normalizeToolCallId("abc"), "tool_abc");
  });
});

describe("AcpTranscriptMapper text accumulation", () => {
  it("accumulates assistant chunks and reports each delta", () => {
    const map = mapper();
    assert.deepEqual(
      map.apply({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hel" },
      }),
      { type: "assistant_delta", text: "Hel" },
    );
    map.apply({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "lo" },
    });
    assert.equal(map.assistantText, "Hello");
  });

  it("keeps reasoning separate from assistant text", () => {
    const map = mapper();
    map.apply({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "hmm" },
    });
    map.apply({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "answer" },
    });
    assert.equal(map.reasoningText, "hmm");
    assert.equal(map.assistantText, "answer");
  });

  it("ignores a chunk with no text payload", () => {
    const map = mapper();
    assert.equal(
      map.apply({
        sessionUpdate: "agent_message_chunk",
        content: { type: "image" },
      }),
      undefined,
    );
    assert.equal(map.assistantText, "");
  });
});

describe("AcpTranscriptMapper tool calls", () => {
  it("builds a record when a tool call is introduced", () => {
    const map = mapper();
    const event = map.apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool_1",
      title: "Edit File",
      kind: "edit",
      status: "pending",
      rawInput: {},
    });

    assert.equal(event?.type, "tool_call");
    const record = event?.type === "tool_call" ? event.record : undefined;
    assert.equal(record?.id, "tool_1");
    assert.equal(record?.toolName, "Edit File");
    assert.equal(record?.risk, "workspace_write");
    assert.equal(record?.status, "requested");
    assert.equal(record?.cwd, "/repo");
    assert.equal(record?.runId, "run_1");
    assert.equal(record?.sourceToolCallId, "tool_1");
    // Cursor introduces calls with an empty rawInput; that must not be stored.
    assert.equal(record?.argsPreview, undefined);
  });

  it("merges a sparse update onto the introduced call", () => {
    const map = mapper();
    map.apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool_1",
      title: "Edit File",
      kind: "edit",
      status: "pending",
    });
    const event = map.apply({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool_1",
      status: "completed",
    });

    const record = event?.type === "tool_call" ? event.record : undefined;
    assert.equal(record?.status, "completed");
    // The patch carried no title or kind, so both must survive the merge.
    assert.equal(record?.toolName, "Edit File");
    assert.equal(record?.risk, "workspace_write");
  });

  it("advances updatedAt while preserving createdAt", () => {
    const map = mapper();
    const first = map.apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool_1",
      title: "Read",
      kind: "read",
    });
    const created = first?.type === "tool_call" ? first.record.createdAt : "";

    const second = map.apply({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool_1",
      status: "completed",
    });
    const record = second?.type === "tool_call" ? second.record : undefined;

    assert.equal(record?.createdAt, created);
    assert.notEqual(record?.updatedAt, created);
  });

  it("records arguments and results once they arrive", () => {
    const map = mapper();
    map.apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool_1",
      kind: "read",
    });
    const event = map.apply({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool_1",
      status: "completed",
      rawInput: { path: "/repo/a.ts" },
      rawOutput: { content: "ok" },
    });

    const record = event?.type === "tool_call" ? event.record : undefined;
    assert.deepEqual(record?.argsPreview, { path: "/repo/a.ts" });
    assert.deepEqual(record?.resultPreview, { content: "ok" });
  });

  it("tracks several concurrent calls independently", () => {
    const map = mapper();
    map.apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool_a",
      title: "A",
      kind: "read",
    });
    map.apply({
      sessionUpdate: "tool_call",
      toolCallId: "tool_b",
      title: "B",
      kind: "execute",
    });
    map.apply({
      sessionUpdate: "tool_call_update",
      toolCallId: "tool_a",
      status: "completed",
    });

    const calls = map.toolCalls;
    assert.deepEqual(
      calls.map((call) => [call.id, call.status, call.risk]),
      [
        ["tool_a", "completed", "read"],
        ["tool_b", "requested", "command"],
      ],
    );
  });

  it("ignores a tool update with no id", () => {
    const map = mapper();
    assert.equal(
      map.apply({
        sessionUpdate: "tool_call_update",
        status: "completed",
      } as never),
      undefined,
    );
    assert.deepEqual(map.toolCalls, []);
  });
});

describe("AcpTranscriptMapper session metadata", () => {
  it("surfaces a generated session title", () => {
    const map = mapper();
    assert.deepEqual(
      map.apply({ sessionUpdate: "session_info_update", title: " Fix login " }),
      {
        type: "title",
        title: "Fix login",
      },
    );
  });

  it("ignores a blank title", () => {
    const map = mapper();
    assert.equal(
      map.apply({ sessionUpdate: "session_info_update", title: "  " }),
      undefined,
    );
  });

  it("surfaces a mode change", () => {
    const map = mapper();
    assert.deepEqual(
      map.apply({
        sessionUpdate: "current_mode_update",
        currentModeId: "plan",
      }),
      {
        type: "mode",
        modeId: "plan",
      },
    );
  });

  it("surfaces plan entries", () => {
    const map = mapper();
    assert.deepEqual(
      map.apply({ sessionUpdate: "plan", entries: [{ content: "step" }] }),
      {
        type: "plan",
        entries: [{ content: "step" }],
      },
    );
  });

  it("ignores update kinds it does not model", () => {
    const map = mapper();
    assert.equal(
      map.apply({
        sessionUpdate: "available_commands_update",
        availableCommands: [],
      }),
      undefined,
    );
  });
});
