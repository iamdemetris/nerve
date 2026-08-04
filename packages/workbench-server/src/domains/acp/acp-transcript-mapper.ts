import type {
  AcpSessionUpdate,
  AcpToolCall,
  AcpToolCallStatus,
} from "@nervekit/acp";
import type {
  ToolCallStatus,
  ToolCallTranscriptRecord,
  ToolRisk,
} from "@nervekit/contracts";

/**
 * Translates Agent Client Protocol session updates into Nerve transcript
 * records.
 *
 * An ACP agent owns its own tool loop, so this is a projection rather than a
 * control path: text and reasoning arrive as chunks that must be accumulated,
 * and tool calls arrive as an introduction followed by sparse patches that must
 * be merged onto the previously known state.
 */

/** Identity of the conversation a mapped update belongs to. */
export interface AcpTranscriptContext {
  agentId: string;
  conversationId: string;
  projectId: string;
  runId?: string;
  turnId?: string;
  cwd: string;
}

export type AcpMappedEvent =
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call"; record: ToolCallTranscriptRecord }
  | { type: "title"; title: string }
  | { type: "mode"; modeId: string }
  | { type: "plan"; entries: readonly unknown[] };

/**
 * ACP tool kinds mapped onto Nerve's risk vocabulary.
 *
 * Risk drives how prominently the workbench surfaces a call, so anything
 * unrecognised is treated as a command rather than a read.
 */
const TOOL_KIND_RISK: Record<string, ToolRisk> = {
  read: "read",
  search: "read",
  think: "read",
  fetch: "network",
  edit: "workspace_write",
  move: "workspace_write",
  delete: "destructive",
  execute: "command",
  switch_mode: "interaction",
};

const TOOL_STATUS: Record<AcpToolCallStatus, ToolCallStatus> = {
  pending: "requested",
  in_progress: "running",
  completed: "completed",
  failed: "error",
};

export function mapAcpToolRisk(kind: string | undefined): ToolRisk {
  if (!kind) return "command";
  return TOOL_KIND_RISK[kind] ?? "command";
}

export function mapAcpToolStatus(
  status: AcpToolCallStatus | undefined,
): ToolCallStatus {
  if (!status) return "requested";
  return TOOL_STATUS[status] ?? "requested";
}

/**
 * Nerve identifiers are prefix-validated. Cursor already emits `tool_`-prefixed
 * ids, but other ACP agents do not, so the prefix is enforced here.
 */
export function normalizeToolCallId(toolCallId: string): string {
  return toolCallId.startsWith("tool_") ? toolCallId : `tool_${toolCallId}`;
}

/**
 * Accumulates ACP updates for a single turn.
 *
 * Tool-call state is retained because `tool_call_update` carries only changed
 * fields; emitting a record built solely from a patch would blank the title and
 * arguments captured when the call was introduced.
 */
export class AcpTranscriptMapper {
  readonly #context: AcpTranscriptContext;
  readonly #now: () => string;
  readonly #toolCalls = new Map<string, ToolCallTranscriptRecord>();
  #assistantText = "";
  #reasoningText = "";

  constructor(
    context: AcpTranscriptContext,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#context = context;
    this.#now = now;
  }

  /** Assistant text accumulated so far, for the durable entry at turn end. */
  get assistantText(): string {
    return this.#assistantText;
  }

  /** Reasoning text accumulated so far. */
  get reasoningText(): string {
    return this.#reasoningText;
  }

  /** Every tool call seen this turn, in first-seen order. */
  get toolCalls(): readonly ToolCallTranscriptRecord[] {
    return [...this.#toolCalls.values()];
  }

  apply(update: AcpSessionUpdate): AcpMappedEvent | undefined {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = readChunkText(update);
        if (!text) return undefined;
        this.#assistantText += text;
        return { type: "assistant_delta", text };
      }
      case "agent_thought_chunk": {
        const text = readChunkText(update);
        if (!text) return undefined;
        this.#reasoningText += text;
        return { type: "reasoning_delta", text };
      }
      case "tool_call":
      case "tool_call_update": {
        const record = this.#mergeToolCall(update as AcpToolCall);
        return record ? { type: "tool_call", record } : undefined;
      }
      case "session_info_update": {
        const title = (update as { title?: unknown }).title;
        return typeof title === "string" && title.trim()
          ? { type: "title", title: title.trim() }
          : undefined;
      }
      case "current_mode_update": {
        const modeId = (update as { currentModeId?: unknown }).currentModeId;
        return typeof modeId === "string"
          ? { type: "mode", modeId }
          : undefined;
      }
      case "plan": {
        const entries = (update as { entries?: unknown }).entries;
        return Array.isArray(entries) ? { type: "plan", entries } : undefined;
      }
      default:
        return undefined;
    }
  }

  #mergeToolCall(update: AcpToolCall): ToolCallTranscriptRecord | undefined {
    if (!update.toolCallId) return undefined;
    const id = normalizeToolCallId(update.toolCallId);
    const timestamp = this.#now();
    const existing = this.#toolCalls.get(id);

    const merged: ToolCallTranscriptRecord = {
      ...(existing ?? {
        id,
        agentId: this.#context.agentId,
        conversationId: this.#context.conversationId,
        projectId: this.#context.projectId,
        toolName: update.title || update.kind || "tool",
        sourceToolCallId: update.toolCallId,
        risk: mapAcpToolRisk(update.kind),
        cwd: this.#context.cwd,
        status: "requested" as ToolCallStatus,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(this.#context.runId ? { runId: this.#context.runId } : {}),
        ...(this.#context.turnId ? { turnId: this.#context.turnId } : {}),
      }),
      updatedAt: timestamp,
    };

    // Only overwrite descriptive fields the patch actually carries: a
    // `tool_call_update` that reports just a status must not erase the title.
    if (update.title) merged.toolName = update.title;
    if (update.kind) merged.risk = mapAcpToolRisk(update.kind);
    if (update.status) merged.status = mapAcpToolStatus(update.status);
    if (update.rawInput !== undefined && !isEmptyRecord(update.rawInput)) {
      merged.argsPreview = update.rawInput;
    }
    if (update.rawOutput !== undefined) merged.resultPreview = update.rawOutput;
    else if (update.content !== undefined)
      merged.resultPreview = update.content;

    this.#toolCalls.set(id, merged);
    return merged;
  }
}

function readChunkText(update: AcpSessionUpdate): string {
  const content = (update as { content?: { text?: unknown } }).content;
  return typeof content?.text === "string" ? content.text : "";
}

/** Cursor sends `rawInput: {}` when introducing a call, before arguments exist. */
function isEmptyRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}
