import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ToolCallTranscriptRecord } from "@nervekit/contracts";
import { AcpSessionStore } from "../src/domains/acp/acp-session-store.js";
import { AcpToolCallBuffer } from "../src/domains/acp/acp-tool-call-buffer.js";

function toolCall(id: string, status: ToolCallTranscriptRecord["status"]) {
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "read",
    risk: "read",
    cwd: ".",
    status,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:01.000Z",
  } satisfies ToolCallTranscriptRecord;
}

describe("ACP concurrent persistence", () => {
  it("coalesces sparse patches to the latest record for every tool", async () => {
    const writes: ToolCallTranscriptRecord[][] = [];
    const buffer = new AcpToolCallBuffer(
      async (records) => void writes.push([...records]),
      (error) => assert.fail(String(error)),
      60_000,
    );

    buffer.push(toolCall("tool_one", "requested"));
    buffer.push(toolCall("tool_two", "running"));
    buffer.push(toolCall("tool_one", "completed"));
    await buffer.close();

    assert.equal(writes.length, 1);
    assert.deepEqual(
      writes[0]?.map(({ id, status }) => ({ id, status })),
      [
        { id: "tool_one", status: "completed" },
        { id: "tool_two", status: "running" },
      ],
    );
  });

  it("loads existing session ids for simultaneous first readers", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-acp-sessions-"));
    try {
      await writeFile(
        join(home, "acp-sessions.json"),
        JSON.stringify({ conv_existing: "session_existing" }),
      );
      const store = new AcpSessionStore(home);

      const values = await Promise.all(
        Array.from({ length: 10 }, () => store.get("conv_existing")),
      );

      assert.deepEqual(values, Array(10).fill("session_existing"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("persists simultaneous session updates without losing a chat", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-acp-sessions-"));
    try {
      const store = new AcpSessionStore(home);
      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          store.set(`conv_${index}`, `session_${index}`),
        ),
      );

      const persisted = JSON.parse(
        await readFile(join(home, "acp-sessions.json"), "utf8"),
      ) as Record<string, string>;
      assert.deepEqual(
        persisted,
        Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [
            `conv_${index}`,
            `session_${index}`,
          ]),
        ),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
