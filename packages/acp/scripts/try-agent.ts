/**
 * Drives a real Cursor or OpenCode CLI end to end so the integration can be
 * verified without the workbench UI.
 *
 * Usage:
 *   pnpm --filter @nervekit/acp try cursor "write a haiku about caching"
 *   pnpm --filter @nervekit/acp try opencode
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpSession } from "../src/session.js";
import { probeAcpAgent } from "../src/probe.js";
import { ACP_AGENTS, type AcpAgentId } from "../src/agents.js";

const DEFAULT_PROMPT =
  "Create a file called hello.txt containing the word HELLO, then stop.";

function parseAgentId(value: string | undefined): AcpAgentId {
  if (value && value in ACP_AGENTS) return value as AcpAgentId;
  const known = Object.keys(ACP_AGENTS).join(" | ");
  throw new Error(`Usage: try-agent <${known}> [prompt]`);
}

const agentId = parseAgentId(process.argv[2]);
const prompt = process.argv.slice(3).join(" ") || DEFAULT_PROMPT;
// A scratch directory keeps the agent's file edits away from the repository.
const cwd = await mkdtemp(join(tmpdir(), `nerve-acp-${agentId}-`));

const probe = await probeAcpAgent({ agentId, cwd });
console.log(`\n[probe] ${probe.status}: ${probe.detail}`);
if (probe.status !== "ready") process.exit(1);

const session = new AcpSession({
  agentId,
  cwd,
  onUpdate: (update) => {
    if (update.sessionUpdate === "agent_message_chunk") {
      process.stdout.write(update.content?.text ?? "");
    }
    if (update.sessionUpdate === "tool_call") {
      console.log(`\n[tool] ${update.title ?? update.kind ?? "call"}`);
    }
  },
  onPermissionRequest: async (request) => {
    const option =
      request.options.find((entry) => entry.kind === "allow_once") ??
      request.options[0];
    console.log(
      `\n[permission] ${request.toolCall?.title ?? "?"} -> ${option?.name}`,
    );
    return { outcome: "selected", optionId: option?.optionId ?? "" };
  },
});

const started = await session.start();
console.log(`[session] ${started.sessionId}`);
console.log(`[models]  ${started.capabilities.models.length} available`);
console.log(
  `[modes]   ${started.capabilities.modes.map((mode) => mode.value).join(", ") || "none"}`,
);
for (const warning of started.warnings) console.log(`[warn] ${warning}`);

console.log(`\n[prompt] ${prompt}\n`);
const result = await session.prompt(prompt);
console.log(`\n\n[done] stopReason=${result.stopReason}`);
console.log(`[workspace] ${cwd}`);
await session.stop();
