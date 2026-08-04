import { AcpAgentProcess } from "./agent-process.js";
import {
  acpAgentDefinition,
  buildAcpSpawnInput,
  readAcpSessionCapabilities,
  type AcpAgentId,
  type AcpAgentSettings,
  type AcpSessionCapabilities,
} from "./agents.js";

export type AcpProbeStatus =
  | "ready"
  | "binary-missing"
  | "not-authenticated"
  | "handshake-failed";

export interface AcpProbeResult {
  agentId: AcpAgentId;
  status: AcpProbeStatus;
  /** Operator-facing explanation, including the command to run when relevant. */
  detail: string;
  agentVersion?: string;
  capabilities?: AcpSessionCapabilities;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Verifies an agent CLI is installed, speaks ACP, and holds credentials.
 *
 * A failing probe is the most common first-run problem, so every outcome
 * carries the exact next action instead of a generic failure.
 */
export async function probeAcpAgent(options: {
  agentId: AcpAgentId;
  settings?: AcpAgentSettings | null;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<AcpProbeResult> {
  const definition = acpAgentDefinition(options.agentId);
  const spawn = buildAcpSpawnInput(
    options.agentId,
    options.settings,
    options.cwd,
    options.env,
  );
  const binary = spawn.command;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stderr: string[] = [];
  let agent: AcpAgentProcess | undefined;

  try {
    agent = AcpAgentProcess.start({
      spawn,
      onStderr: (text) => stderr.push(text),
    });

    const initialize = await withTimeout(
      agent.client.initialize(),
      timeoutMs,
      "initialize",
    );
    const agentVersion = initialize.agentInfo?.version;

    const advertised = initialize.authMethods?.some(
      (method) => method.id === definition.authMethodId,
    );
    if (!advertised) {
      return {
        agentId: options.agentId,
        status: "handshake-failed",
        detail:
          `${binary} completed the ACP handshake but did not advertise the ` +
          `"${definition.authMethodId}" auth method. Update the CLI and try again.`,
        ...(agentVersion ? { agentVersion } : {}),
      };
    }

    // Session creation is the first call needing real credentials, so it is
    // what distinguishes "installed" from "logged in".
    const session = await withTimeout(
      agent.client.newSession({ cwd: options.cwd }),
      timeoutMs,
      "session/new",
    );
    const capabilities = readAcpSessionCapabilities(session);

    if (capabilities.models.length === 0) {
      return {
        agentId: options.agentId,
        status: "not-authenticated",
        detail: `${binary} returned no models. Run "${definition.loginCommand}" and try again.`,
        capabilities,
        ...(agentVersion ? { agentVersion } : {}),
      };
    }

    return {
      agentId: options.agentId,
      status: "ready",
      detail: `${definition.label} is authenticated with ${capabilities.models.length} models available.`,
      capabilities,
      ...(agentVersion ? { agentVersion } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const combined = `${message} ${stderr.join(" ")}`.toLowerCase();

    if (
      combined.includes("enoent") ||
      combined.includes("failed to start acp agent") ||
      combined.includes("command not found")
    ) {
      return {
        agentId: options.agentId,
        status: "binary-missing",
        detail:
          `Could not run "${binary}". Install the ${definition.label} CLI ` +
          `(${definition.installUrl}), or set an explicit binary path if it is ` +
          `installed outside PATH.`,
      };
    }
    if (
      combined.includes("auth") ||
      combined.includes("login") ||
      combined.includes("unauthorized")
    ) {
      return {
        agentId: options.agentId,
        status: "not-authenticated",
        detail: `${binary} is installed but not authenticated. Run "${definition.loginCommand}".`,
      };
    }
    return {
      agentId: options.agentId,
      status: "handshake-failed",
      detail: `${binary} failed the ACP handshake: ${message}`,
    };
  } finally {
    await agent?.stop(2000);
  }
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
