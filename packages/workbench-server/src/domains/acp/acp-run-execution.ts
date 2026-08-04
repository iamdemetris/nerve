import {
  AcpSession,
  ACP_AGENTS,
  type AcpAgentId,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
} from "@nervekit/acp";
import type {
  ConversationEntry,
  RunPromptRecord,
  RunRecord,
} from "@nervekit/contracts";
import type {
  RunExecution,
  RunExecutionOutcome,
  RunExecutionSink,
} from "../runs/runtime/index.js";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../runtime/types.js";
import type { WorkbenchLiveExecutionControl } from "../runs/run-live-executions.js";
import { AcpToolCallBuffer } from "./acp-tool-call-buffer.js";
import { AcpTranscriptMapper } from "./acp-transcript-mapper.js";

/**
 * Runs a turn on an external agent CLI over the Agent Client Protocol.
 *
 * The contrast with the harness adapter matters: there, Nerve owns the model
 * loop and executes every tool itself. Here the agent owns both, and Nerve is a
 * client that streams the result. So this adapter projects rather than drives —
 * it never decides what runs next, it reports what the agent did.
 */

export interface AcpRunContext {
  agentId: AcpAgentId;
  /** Model id as the agent names it, taken from the picker selection. */
  modelId: string;
  /** Directory the agent operates in; the project root for this run. */
  cwd: string;
  nerveAgentId: string;
  conversationId: string;
  projectId: string;
}

export interface AcpRunExecutionDeps {
  resolveContext(run: RunRecord): Promise<AcpRunContext>;
  /** Persists the agent's session id so a later turn can resume the thread. */
  loadSessionId(conversationId: string): Promise<string | undefined>;
  saveSessionId(conversationId: string, sessionId: string): Promise<void>;
  /**
   * Writes an entry to the conversation store. The run sink only journals for
   * checkpointing, so an entry that skips this never reaches the transcript.
   */
  appendEntry(
    input: AppendEntryInput,
    options?: AppendEntryOptions,
  ): Promise<ConversationEntry>;
  now(): string;
  log(message: string, error?: unknown): void;
}

export function createAcpRunExecution(
  run: RunRecord,
  sink: RunExecutionSink,
  deps: AcpRunExecutionDeps,
): RunExecution {
  let session: AcpSession | undefined;
  let cancelled = false;
  /** Prompts that arrived before or during a turn, drained on the next one. */
  const queued: RunPromptRecord[] = [];

  const control: WorkbenchLiveExecutionControl = {
    // The agent has no mid-turn injection channel, so steering becomes a
    // follow-up prompt rather than silently doing nothing.
    steer: async (prompt) => {
      queued.push(prompt);
    },
    followUp: async (prompt) => {
      queued.push(prompt);
    },
    continue: async () => undefined,
    cancel: async () => {
      cancelled = true;
      session?.cancel();
    },
    removeQueuedPrompt: async (promptId) => {
      const index = queued.findIndex((prompt) => prompt.id === promptId);
      if (index === -1) return false;
      queued.splice(index, 1);
      return true;
    },
  };

  async function execute(input: {
    run: RunRecord;
    prompt?: string;
    signal: AbortSignal;
  }): Promise<RunExecutionOutcome> {
    const context = await deps.resolveContext(input.run);
    const definition = ACP_AGENTS[context.agentId];
    const mapper = new AcpTranscriptMapper(
      {
        agentId: context.nerveAgentId,
        conversationId: context.conversationId,
        projectId: context.projectId,
        runId: input.run.runId,
        cwd: context.cwd,
      },
      deps.now,
    );

    // ACP agents can emit several sparse patches for one tool in a few
    // milliseconds. Keep the latest record for each tool and commit them as a
    // small live batch instead of creating a durable run transition per patch.
    const toolCalls = new AcpToolCallBuffer(
      (records) => sink.upsertToolCalls(records),
      (error) => {
        deps.log("Could not record ACP tool call", error);
      },
    );

    // Resuming a session replays the whole thread as ordinary updates, which
    // would otherwise be captured as if the agent had just said it and appended
    // to this turn's reply. Only updates after the prompt belong to this turn.
    let capturing = false;

    session = new AcpSession({
      agentId: context.agentId,
      cwd: context.cwd,
      modelId: context.modelId,
      resumeSessionId: await deps.loadSessionId(context.conversationId),
      onUpdate: (update) => {
        if (!capturing) return;
        const event = mapper.apply(update);
        if (!event) return;
        if (event.type === "tool_call") {
          toolCalls.push(event.record);
          return;
        }
      },
      onPermissionRequest: (request) => resolvePermission(request),
      onStderr: (text) => deps.log(`[${context.agentId}] ${text.trim()}`),
    });

    const abort = () => {
      cancelled = true;
      session?.cancel();
    };
    input.signal.addEventListener("abort", abort, { once: true });

    try {
      const started = await session.start();
      if (started.sessionId) {
        await deps.saveSessionId(context.conversationId, started.sessionId);
      }
      for (const warning of started.warnings) deps.log(warning);

      const text = [input.prompt, ...queued.splice(0).map((item) => item.text)]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join("\n\n");
      if (!text) {
        return { status: "completed" };
      }

      // Recorded before the turn so the transcript shows the question even if
      // the agent fails to answer it.
      await appendConversationEntry(
        sink,
        deps,
        context,
        input.run.runId,
        "user",
        text,
      );

      capturing = true;
      const result = await session.prompt(text);

      await toolCalls.flush();
      await persistTurn(mapper, sink, deps, context, input.run.runId);

      if (cancelled || result.stopReason === "cancelled") {
        return { status: "interrupted", message: "Run cancelled." };
      }
      if (result.stopReason === "refusal") {
        return {
          status: "failed",
          failure: {
            code: "ACP_REFUSED",
            message: `${definition.label} declined to complete the request.`,
            retryable: false,
          },
        };
      }
      return { status: "completed" };
    } catch (error) {
      // Persist whatever streamed before the failure so the transcript is not
      // silently truncated.
      await toolCalls.flush();
      await persistTurn(mapper, sink, deps, context, input.run.runId).catch(
        () => undefined,
      );
      if (cancelled)
        return { status: "interrupted", message: "Run cancelled." };
      return {
        status: "failed",
        failure: {
          code: "ACP_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      };
    } finally {
      input.signal.removeEventListener("abort", abort);
      capturing = false;
      await session?.stop().catch(() => undefined);
      await toolCalls.close();
      session = undefined;
    }
  }

  return { control, execute };
}

/**
 * Answers the agent's permission prompts.
 *
 * Nerve's own approval flow is driven by its tool dispatcher, which an ACP
 * agent bypasses entirely. Until those are joined up, the safe reading of an
 * explicit user model choice is to allow the call for this turn only, never to
 * grant a standing "always allow".
 */
async function resolvePermission(
  request: AcpPermissionRequest,
): Promise<AcpPermissionOutcome> {
  const once =
    request.options.find((option) => option.kind === "allow_once") ??
    request.options.find((option) => option.kind === "allow_always");
  if (!once) return { outcome: "cancelled" };
  return { outcome: "selected", optionId: once.optionId };
}

/** Commits the turn's assistant text as a durable conversation entry. */
async function persistTurn(
  mapper: AcpTranscriptMapper,
  sink: RunExecutionSink,
  deps: AcpRunExecutionDeps,
  context: AcpRunContext,
  runId: string,
): Promise<void> {
  const text = mapper.assistantText.trim();
  if (!text) return;
  await appendConversationEntry(sink, deps, context, runId, "assistant", text);
}

/**
 * Writes an entry to the conversation and mirrors it into the run journal.
 *
 * Harness mirroring is skipped because the external agent keeps its own
 * conversation history; duplicating it into Nerve's harness storage would feed
 * the same turns back on resume.
 */
async function appendConversationEntry(
  sink: RunExecutionSink,
  deps: AcpRunExecutionDeps,
  context: AcpRunContext,
  runId: string,
  role: ConversationEntry["role"],
  text: string,
): Promise<void> {
  const entry = await deps.appendEntry(
    {
      conversationId: context.conversationId,
      agentId: context.nerveAgentId,
      runId,
      role,
      kind: "message",
      text,
      createdAt: deps.now(),
    },
    { mirrorToHarness: false },
  );
  await sink.appendEntries([entry]);
}
