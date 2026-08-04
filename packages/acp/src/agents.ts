import type { AcpSpawnInput } from "./agent-process.js";
import type { AcpConfigOption, AcpNewSessionResult } from "./types.js";

/**
 * Definitions for the external agent CLIs Nerve can drive over ACP.
 *
 * Nerve drives these CLIs but never ships them: each is installed and
 * authenticated by the user, and runs against their own subscription.
 */

export type AcpAgentId = "cursor" | "opencode";

export interface AcpAgentSettings {
  /** Absolute path or PATH-resolvable name. Falls back to the agent default. */
  binaryPath?: string | null;
  /** Overrides the provider API endpoint where the CLI supports it. */
  apiEndpoint?: string | null;
}

export interface AcpAgentDefinition {
  id: AcpAgentId;
  label: string;
  /** Default executable name, matching what each vendor documents. */
  defaultBinary: string;
  /** Auth method id the agent advertises during initialize. */
  authMethodId: string;
  /** Command the user runs to authenticate. */
  loginCommand: string;
  installUrl: string;
  buildArgs: (settings: AcpAgentSettings | null | undefined) => string[];
}

export const ACP_AGENTS: Record<AcpAgentId, AcpAgentDefinition> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    // The bare name `agent` collides with Grok CLI's `grok agent` subcommand.
    defaultBinary: "cursor-agent",
    authMethodId: "cursor_login",
    loginCommand: "cursor-agent login",
    installUrl: "https://cursor.com/docs/cli/installation",
    buildArgs: (settings) => {
      const endpoint = settings?.apiEndpoint?.trim();
      return [...(endpoint ? ["-e", endpoint] : []), "acp"];
    },
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    defaultBinary: "opencode",
    authMethodId: "opencode-login",
    loginCommand: "opencode auth login",
    installUrl: "https://opencode.ai",
    buildArgs: () => ["acp"],
  },
};

export function acpAgentDefinition(id: AcpAgentId): AcpAgentDefinition {
  return ACP_AGENTS[id];
}

export function buildAcpSpawnInput(
  id: AcpAgentId,
  settings: AcpAgentSettings | null | undefined,
  cwd: string,
  env?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  const definition = acpAgentDefinition(id);
  return {
    command: settings?.binaryPath?.trim() || definition.defaultBinary,
    args: definition.buildArgs(settings),
    cwd,
    ...(env ? { env } : {}),
  };
}

export interface AcpSelectableOption {
  value: string;
  label: string;
}

export interface AcpSessionCapabilities {
  models: AcpSelectableOption[];
  currentModelId: string | undefined;
  modes: AcpSelectableOption[];
  currentModeId: string | undefined;
}

/**
 * Normalizes the two shapes agents use to describe their models and modes.
 *
 * Cursor returns top-level `models` and `modes` blocks, while OpenCode returns
 * everything through `configOptions`. Reading both keeps one capability type
 * for the UI regardless of which agent is selected.
 */
export function readAcpSessionCapabilities(
  session: AcpNewSessionResult,
): AcpSessionCapabilities {
  const configModels = optionsFromConfig(session.configOptions, "model");
  const configModes = optionsFromConfig(session.configOptions, "mode");

  const models = session.models?.availableModels?.length
    ? session.models.availableModels.map((model) => ({
        value: model.modelId,
        label: model.name ?? model.modelId,
      }))
    : configModels.options;

  const modes = session.modes?.availableModes?.length
    ? session.modes.availableModes.map((mode) => ({
        value: mode.id,
        label: mode.name ?? mode.id,
      }))
    : configModes.options;

  return {
    models,
    currentModelId: session.models?.currentModelId ?? configModels.current,
    modes,
    currentModeId: session.modes?.currentModeId ?? configModes.current,
  };
}

function optionsFromConfig(
  configOptions: AcpConfigOption[] | undefined,
  id: string,
): { options: AcpSelectableOption[]; current: string | undefined } {
  const option = configOptions?.find((entry) => entry.id === id);
  if (!option) return { options: [], current: undefined };
  return {
    options: (option.options ?? []).map((choice) => ({
      value: choice.value,
      label: choice.name ?? choice.value,
    })),
    current:
      typeof option.currentValue === "string" ? option.currentValue : undefined,
  };
}
