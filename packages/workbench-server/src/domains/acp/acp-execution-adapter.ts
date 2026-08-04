import type {
  AgentRecord,
  ConversationEntry,
  RunRecord,
} from "@nervekit/contracts";
import type {
  AppendEntryInput,
  AppendEntryOptions,
} from "../../runtime/types.js";
import type { RunExecution, RunExecutionSink } from "../runs/runtime/index.js";
import type { WorkbenchRunExecutionAdapter } from "../runs/run-execution.js";
import type { AcpModelCatalog } from "./acp-model-catalog.js";
import { createAcpRunExecution } from "./acp-run-execution.js";

/**
 * Chooses the execution backend for a run.
 *
 * A run is delegated to an external CLI agent purely on the strength of the
 * model the user picked: provider ids for ACP agents are reserved, so a
 * selection of `opencode/...` is an unambiguous request to run there. Anything
 * else stays on the built-in harness, which remains the default.
 */
export class AcpDispatchingExecutionAdapter implements WorkbenchRunExecutionAdapter {
  constructor(
    private readonly harness: WorkbenchRunExecutionAdapter,
    private readonly catalog: AcpModelCatalog,
    private readonly deps: {
      getAgent(
        agentId: string,
      ): Promise<AgentRecord | undefined> | AgentRecord | undefined;
      loadSessionId(conversationId: string): Promise<string | undefined>;
      saveSessionId(conversationId: string, sessionId: string): Promise<void>;
      appendEntry(
        input: AppendEntryInput,
        options?: AppendEntryOptions,
      ): Promise<ConversationEntry>;
      log(message: string, error?: unknown): void;
    },
  ) {}

  async create(run: RunRecord, sink: RunExecutionSink): Promise<RunExecution> {
    const agent = await this.deps.getAgent(run.agentId);
    const provider = agent?.model?.provider;
    const acpAgentId = provider
      ? this.catalog.agentForProvider(provider)
      : undefined;

    if (!agent || !acpAgentId || !agent.model) {
      return this.harness.create(run, sink);
    }

    const model = agent.model;
    return createAcpRunExecution(run, sink, {
      resolveContext: async () => ({
        agentId: acpAgentId,
        modelId: model.modelId,
        cwd: agent.projectDir,
        nerveAgentId: agent.id,
        conversationId: agent.conversationId,
        projectId: agent.projectId,
      }),
      loadSessionId: this.deps.loadSessionId,
      saveSessionId: this.deps.saveSessionId,
      appendEntry: this.deps.appendEntry,
      now: () => new Date().toISOString(),
      log: this.deps.log,
    });
  }
}
