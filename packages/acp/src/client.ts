import { JsonRpcConnection } from "./jsonrpc.js";
import {
  ACP_PROTOCOL_VERSION,
  AcpMethod,
  type AcpClientCapabilities,
  type AcpConfigOption,
  type AcpContentBlock,
  type AcpInitializeResult,
  type AcpNewSessionResult,
  type AcpPermissionOutcome,
  type AcpPermissionRequest,
  type AcpPromptResult,
  type AcpSessionNotification,
  type AcpSessionUpdate,
} from "./types.js";

export interface AcpClientHandlers {
  /**
   * Called when the agent asks to run something that needs approval. Returning
   * `{ outcome: "cancelled" }` aborts the tool call.
   *
   * Not every agent uses this: Cursor's ACP server self-approves in `agent`
   * mode, so gating there comes from the session mode instead.
   */
  onPermissionRequest?: (
    request: AcpPermissionRequest,
  ) => Promise<AcpPermissionOutcome>;
  /** Reads a file on the agent's behalf when `fs.readTextFile` is advertised. */
  onReadTextFile?: (params: {
    path: string;
    line?: number | null;
    limit?: number | null;
  }) => Promise<string>;
  /** Writes a file on the agent's behalf when `fs.writeTextFile` is advertised. */
  onWriteTextFile?: (params: {
    path: string;
    content: string;
  }) => Promise<void>;
  /** Receives every `session/update` notification, keyed by session. */
  onSessionUpdate?: (sessionId: string, update: AcpSessionUpdate) => void;
  /** Reports protocol noise without interrupting the session. */
  onDecodeError?: (line: string, error: unknown) => void;
}

export interface AcpClientOptions extends AcpClientHandlers {
  write: (line: string) => void;
  clientCapabilities?: AcpClientCapabilities;
}

const DEFAULT_CAPABILITIES: AcpClientCapabilities = {
  fs: { readTextFile: true, writeTextFile: true },
};

/**
 * Client half of the Agent Client Protocol.
 *
 * Transport-agnostic on purpose: it is handed a `write` sink and fed bytes via
 * {@link receive}, so tests drive it over a pair of in-memory pipes and
 * production drives it over a child process's stdio.
 */
export class AcpClient {
  readonly #connection: JsonRpcConnection;
  readonly #handlers: AcpClientHandlers;
  readonly #clientCapabilities: AcpClientCapabilities;
  #initializeResult: AcpInitializeResult | undefined;

  constructor(options: AcpClientOptions) {
    this.#handlers = options;
    this.#clientCapabilities =
      options.clientCapabilities ?? DEFAULT_CAPABILITIES;
    this.#connection = new JsonRpcConnection({
      write: options.write,
      onDecodeError: options.onDecodeError,
      onNotification: (method, params) =>
        this.#handleNotification(method, params),
      onRequest: (method, params) => this.#handleRequest(method, params),
    });
  }

  get initializeResult(): AcpInitializeResult | undefined {
    return this.#initializeResult;
  }

  get supportsLoadSession(): boolean {
    return this.#initializeResult?.agentCapabilities?.loadSession === true;
  }

  receive(chunk: string): void {
    this.#connection.receive(chunk);
  }

  close(reason?: string): void {
    this.#connection.close(reason);
  }

  async initialize(): Promise<AcpInitializeResult> {
    const result = await this.#connection.request<AcpInitializeResult>(
      AcpMethod.Initialize,
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: this.#clientCapabilities,
      },
    );
    this.#initializeResult = result;
    return result;
  }

  /**
   * Presents stored credentials for the given auth method. Cursor uses
   * `cursor_login`, which reuses the credentials written by `cursor-agent login`.
   */
  async authenticate(methodId: string): Promise<void> {
    await this.#connection.request(AcpMethod.Authenticate, { methodId });
  }

  async newSession(params: {
    cwd: string;
    mcpServers?: unknown[];
  }): Promise<AcpNewSessionResult> {
    return await this.#connection.request<AcpNewSessionResult>(
      AcpMethod.SessionNew,
      {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
      },
    );
  }

  async loadSession(params: {
    sessionId: string;
    cwd: string;
    mcpServers?: unknown[];
  }): Promise<AcpNewSessionResult> {
    return await this.#connection.request<AcpNewSessionResult>(
      AcpMethod.SessionLoad,
      {
        sessionId: params.sessionId,
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
      },
    );
  }

  /**
   * Runs one turn. Resolves when the agent stops, so callers observe streaming
   * output through {@link AcpClientHandlers.onSessionUpdate}.
   */
  async prompt(params: {
    sessionId: string;
    prompt: AcpContentBlock[];
  }): Promise<AcpPromptResult> {
    return await this.#connection.request<AcpPromptResult>(
      AcpMethod.SessionPrompt,
      {
        sessionId: params.sessionId,
        prompt: params.prompt,
      },
    );
  }

  /** Cancellation is a notification: the in-flight prompt settles on its own. */
  cancel(sessionId: string): void {
    this.#connection.notify(AcpMethod.SessionCancel, { sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.#connection.request(AcpMethod.SessionSetMode, {
      sessionId,
      modeId,
    });
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.#connection.request(AcpMethod.SessionSetModel, {
      sessionId,
      modelId,
    });
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string | boolean | number,
  ): Promise<void> {
    await this.#connection.request(AcpMethod.SessionSetConfigOption, {
      sessionId,
      configId,
      value,
    });
  }

  #handleNotification(method: string, params: unknown): void {
    if (method !== AcpMethod.SessionUpdate) return;
    const notification = params as AcpSessionNotification | undefined;
    if (!notification?.sessionId || !notification.update) return;
    this.#handlers.onSessionUpdate?.(
      notification.sessionId,
      notification.update,
    );
  }

  async #handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case AcpMethod.SessionRequestPermission: {
        const handler = this.#handlers.onPermissionRequest;
        const request = params as AcpPermissionRequest;
        if (!handler) return { outcome: rejectOutcome(request) };
        return { outcome: await handler(request) };
      }
      case AcpMethod.FsReadTextFile: {
        const handler = this.#handlers.onReadTextFile;
        if (!handler) throw new Error("fs/read_text_file is not supported");
        const content = await handler(
          params as {
            path: string;
            line?: number | null;
            limit?: number | null;
          },
        );
        return { content };
      }
      case AcpMethod.FsWriteTextFile: {
        const handler = this.#handlers.onWriteTextFile;
        if (!handler) throw new Error("fs/write_text_file is not supported");
        await handler(params as { path: string; content: string });
        return null;
      }
      default:
        throw new Error(`unhandled agent request: ${method}`);
    }
  }
}

/**
 * Falls back to an explicit rejection when no approval UI is wired up, so an
 * unattended client denies rather than silently granting.
 */
function rejectOutcome(request: AcpPermissionRequest): AcpPermissionOutcome {
  const reject = request.options?.find(
    (option) =>
      option.kind === "reject_once" || option.kind === "reject_always",
  );
  return reject
    ? { outcome: "selected", optionId: reject.optionId }
    : { outcome: "cancelled" };
}

export function textBlock(text: string): AcpContentBlock {
  return { type: "text", text };
}

/** Picks a config option by id from a `session/new` result. */
export function findConfigOption(
  configOptions: AcpConfigOption[] | undefined,
  id: string,
): AcpConfigOption | undefined {
  return configOptions?.find((option) => option.id === id);
}
