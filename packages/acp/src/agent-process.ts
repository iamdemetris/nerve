import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { AcpClient, type AcpClientHandlers } from "./client.js";
import type { AcpClientCapabilities } from "./types.js";

export interface AcpSpawnInput {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface AcpAgentProcessOptions extends AcpClientHandlers {
  spawn: AcpSpawnInput;
  clientCapabilities?: AcpClientCapabilities;
  /** Receives the agent's stderr, which carries its own diagnostics. */
  onStderr?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class AcpSpawnError extends Error {
  constructor(command: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to start ACP agent "${command}": ${detail}`);
    this.name = "AcpSpawnError";
  }
}

/**
 * A running ACP agent subprocess and its client connection.
 *
 * The agent owns its own tool loop, so this is a supervision boundary: keep the
 * process handle and the protocol client together, and tear both down as one.
 */
export class AcpAgentProcess {
  readonly client: AcpClient;
  readonly #child: ChildProcessWithoutNullStreams;
  #exited = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    options: AcpAgentProcessOptions,
  ) {
    this.#child = child;
    this.client = new AcpClient({
      ...options,
      write: (line) => {
        if (this.#exited) return;
        this.#child.stdin.write(line);
      },
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.client.receive(chunk));

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const text = chunk.trim();
      if (text) options.onStderr?.(text);
    });

    // A broken pipe after the agent exits is expected during teardown.
    child.stdin.on("error", () => {});

    child.on("exit", (code, signal) => {
      this.#exited = true;
      this.client.close(
        `agent exited (code ${code ?? "null"}, signal ${signal ?? "none"})`,
      );
      options.onExit?.(code, signal);
    });
  }

  static start(options: AcpAgentProcessOptions): AcpAgentProcess {
    const { command, args, cwd, env } = options.spawn;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, [...args], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        ...(env ? { env } : {}),
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      throw new AcpSpawnError(command, error);
    }

    // `spawn` reports a missing binary asynchronously, so surface it as a close.
    child.on("error", (error) => {
      options.onStderr?.(new AcpSpawnError(command, error).message);
    });

    return new AcpAgentProcess(child, options);
  }

  get pid(): number | undefined {
    return this.#child.pid;
  }

  get exited(): boolean {
    return this.#exited;
  }

  /** Stops the agent, escalating to SIGKILL if it ignores the first signal. */
  async stop(timeoutMs = 5000): Promise<void> {
    if (this.#exited) return;
    this.client.close("stopped by client");
    const exited = new Promise<void>((resolve) => {
      if (this.#exited) {
        resolve();
        return;
      }
      this.#child.once("exit", () => resolve());
    });
    this.#child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!this.#exited) this.#child.kill("SIGKILL");
    }, timeoutMs);
    try {
      await exited;
    } finally {
      clearTimeout(timer);
    }
  }
}
