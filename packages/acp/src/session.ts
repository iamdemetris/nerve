import { AcpAgentProcess } from "./agent-process.js";
import {
  acpAgentDefinition,
  buildAcpSpawnInput,
  readAcpSessionCapabilities,
  type AcpAgentId,
  type AcpAgentSettings,
  type AcpSessionCapabilities,
} from "./agents.js";
import { textBlock } from "./client.js";
import type {
  AcpContentBlock,
  AcpPermissionOutcome,
  AcpPermissionRequest,
  AcpPromptResult,
  AcpSessionUpdate,
} from "./types.js";

export interface AcpSessionOptions {
  agentId: AcpAgentId;
  settings?: AcpAgentSettings | null;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Resumes a prior agent session when the agent supports `session/load`. */
  resumeSessionId?: string;
  modelId?: string | null;
  modeId?: string | null;
  onUpdate: (update: AcpSessionUpdate) => void;
  onPermissionRequest?: (
    request: AcpPermissionRequest,
  ) => Promise<AcpPermissionOutcome>;
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface AcpSessionStartResult {
  sessionId: string;
  capabilities: AcpSessionCapabilities;
  /** Present when the requested model or mode could not be applied. */
  warnings: string[];
}

/**
 * One conversation backed by an external agent CLI.
 *
 * Owns the subprocess for its lifetime: the agent holds session state in
 * memory, so the process must outlive individual prompts and be stopped
 * explicitly when the conversation ends.
 */
export class AcpSession {
  #process: AcpAgentProcess | undefined;
  #sessionId: string | undefined;
  #capabilities: AcpSessionCapabilities | undefined;
  readonly #options: AcpSessionOptions;

  constructor(options: AcpSessionOptions) {
    this.#options = options;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  get capabilities(): AcpSessionCapabilities | undefined {
    return this.#capabilities;
  }

  get running(): boolean {
    return Boolean(this.#process && !this.#process.exited);
  }

  async start(): Promise<AcpSessionStartResult> {
    const definition = acpAgentDefinition(this.#options.agentId);
    const agent = AcpAgentProcess.start({
      spawn: buildAcpSpawnInput(
        this.#options.agentId,
        this.#options.settings,
        this.#options.cwd,
        this.#options.env,
      ),
      onSessionUpdate: (_sessionId, update) => this.#options.onUpdate(update),
      ...(this.#options.onPermissionRequest
        ? { onPermissionRequest: this.#options.onPermissionRequest }
        : {}),
      ...(this.#options.onStderr ? { onStderr: this.#options.onStderr } : {}),
      ...(this.#options.onExit ? { onExit: this.#options.onExit } : {}),
    });
    this.#process = agent;

    const initialize = await agent.client.initialize();
    const advertised = initialize.authMethods?.some(
      (method) => method.id === definition.authMethodId,
    );
    if (!advertised) {
      await this.stop();
      throw new Error(
        `${definition.label} did not advertise the "${definition.authMethodId}" ` +
          `auth method. Run "${definition.loginCommand}" and try again.`,
      );
    }

    const resumeId = this.#options.resumeSessionId;
    const session =
      resumeId && agent.client.supportsLoadSession
        ? await agent.client.loadSession({
            sessionId: resumeId,
            cwd: this.#options.cwd,
          })
        : await agent.client.newSession({ cwd: this.#options.cwd });

    // `session/load` echoes the id it was given rather than minting a new one.
    this.#sessionId = session.sessionId ?? resumeId;
    this.#capabilities = readAcpSessionCapabilities(session);

    const warnings = await this.#applySelection();
    return {
      sessionId: this.#sessionId ?? "",
      capabilities: this.#capabilities,
      warnings,
    };
  }

  /**
   * Runs one turn and resolves when the agent stops. Streaming output arrives
   * through `onUpdate` while this is pending.
   */
  async prompt(
    text: string,
    extra: AcpContentBlock[] = [],
  ): Promise<AcpPromptResult> {
    const { client, sessionId } = this.#require();
    return await client.prompt({
      sessionId,
      prompt: [textBlock(text), ...extra],
    });
  }

  /** Requests cancellation; the pending prompt settles with its own stop reason. */
  cancel(): void {
    if (!this.#process || this.#process.exited || !this.#sessionId) return;
    this.#process.client.cancel(this.#sessionId);
  }

  async setModel(modelId: string): Promise<void> {
    const { client, sessionId } = this.#require();
    await client.setModel(sessionId, modelId);
  }

  async setMode(modeId: string): Promise<void> {
    const { client, sessionId } = this.#require();
    await client.setMode(sessionId, modeId);
  }

  async stop(): Promise<void> {
    await this.#process?.stop();
    this.#process = undefined;
  }

  /**
   * Applies the requested model and mode. Failures are reported rather than
   * thrown: a stale saved selection should not prevent the session opening.
   */
  async #applySelection(): Promise<string[]> {
    const warnings: string[] = [];
    const { modelId, modeId } = this.#options;

    if (modelId) {
      try {
        await this.setModel(modelId);
      } catch (error) {
        warnings.push(
          `Could not select model "${modelId}": ${describe(error)}`,
        );
      }
    }
    if (modeId) {
      try {
        await this.setMode(modeId);
      } catch (error) {
        warnings.push(`Could not select mode "${modeId}": ${describe(error)}`);
      }
    }
    return warnings;
  }

  #require(): { client: AcpAgentProcess["client"]; sessionId: string } {
    if (!this.#process || this.#process.exited) {
      throw new Error("ACP session is not running");
    }
    if (!this.#sessionId) throw new Error("ACP session has not been started");
    return { client: this.#process.client, sessionId: this.#sessionId };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
