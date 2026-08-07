import { ACP_AGENTS, probeAcpAgent, type AcpAgentId } from "@nervekit/acp";
import type { AuthProviderMetadata, ModelInfo } from "@nervekit/contracts";
import {
  atomicWriteJson,
  readJsonFile,
} from "../../infrastructure/storage/index.js";
import { join } from "node:path";

/**
 * Model catalog for agents driven over the Agent Client Protocol.
 *
 * These agents are CLIs the user installs and authenticates themselves, so
 * their model lists are only discoverable by launching them. That costs a
 * process spawn and a round trip, which is far too slow for a request handler,
 * so discovery happens in the background and results are cached on disk. A
 * stale list is much better than a blocked model picker: choosing a model that
 * has since disappeared fails at prompt time with a clear message.
 */

const CACHE_FILE = "acp-models.json";
// Model catalogs change slowly; avoid launching external CLIs on every app
// launch while still refreshing periodically for newly available models.
const MODEL_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Provider ids are suffixed because agent names collide with hosted providers
 * that pi-ai already ships: `opencode` is OpenCode Zen's HTTP API, which is a
 * different thing from the OpenCode CLI driven here.
 */
const PROVIDER_SUFFIX = "-cli";

export function acpProviderId(agentId: AcpAgentId): string {
  return `${agentId}${PROVIDER_SUFFIX}`;
}

export function acpAgentIdForProvider(
  provider: string,
): AcpAgentId | undefined {
  if (!provider.endsWith(PROVIDER_SUFFIX)) return undefined;
  const agentId = provider.slice(0, -PROVIDER_SUFFIX.length);
  return agentId in ACP_AGENTS ? (agentId as AcpAgentId) : undefined;
}

interface CachedAgent {
  agentId: AcpAgentId;
  refreshedAt: string;
  models: ModelInfo[];
}

interface CacheFile {
  agents: CachedAgent[];
}

export interface AcpAgentAvailability {
  agentId: AcpAgentId;
  label: string;
  status: "ready" | "binary-missing" | "not-authenticated" | "handshake-failed";
  detail: string;
  modelCount: number;
  refreshedAt?: string;
}

export class AcpModelCatalog {
  readonly #home: string;
  readonly #cache = new Map<AcpAgentId, CachedAgent>();
  readonly #availability = new Map<AcpAgentId, AcpAgentAvailability>();
  readonly #log: (message: string, error?: unknown) => void;
  #refreshing: Promise<void> | undefined;

  constructor(
    home: string,
    log: (message: string, error?: unknown) => void = () => undefined,
  ) {
    this.#home = home;
    this.#log = log;
  }

  /** Serves the last known models; never spawns a process. */
  list(): ModelInfo[] {
    return [...this.#cache.values()].flatMap((entry) => entry.models);
  }

  availability(): AcpAgentAvailability[] {
    return [...this.#availability.values()];
  }

  /**
   * Presents each usable agent as a configured provider.
   *
   * The model picker only offers models whose provider is configured, and
   * these agents carry their own credentials in the CLI rather than in Nerve's
   * credential store. Reporting an agent that returned models as configured is
   * what makes its models selectable; it advertises no API key or OAuth flow
   * because Nerve has no way to authenticate it.
   */
  providerMetadata(): AuthProviderMetadata[] {
    return [...this.#cache.values()]
      .filter((entry) => entry.models.length > 0)
      .map((entry) => ({
        provider: acpProviderId(entry.agentId),
        displayName: ACP_AGENTS[entry.agentId].label,
        supportsApiKey: false,
        supportsOAuth: false,
        configured: true,
      }));
  }

  /** Resolves the agent that owns a provider id, if any. */
  agentForProvider(provider: string): AcpAgentId | undefined {
    return acpAgentIdForProvider(provider);
  }

  async hydrate(): Promise<void> {
    const cached = await readJsonFile<CacheFile>(this.#path()).catch(
      () => undefined,
    );
    for (const entry of cached?.agents ?? []) {
      if (!(entry.agentId in ACP_AGENTS)) continue;
      this.#cache.set(entry.agentId, entry);
    }
  }

  /**
   * Re-probes every agent. Safe to call at any time and collapses concurrent
   * callers, since each probe launches a subprocess.
   */
  async refresh(cwd: string, options: { force?: boolean } = {}): Promise<void> {
    this.#refreshing ??= this.#refreshAll(cwd, options.force ?? false).finally(
      () => {
        this.#refreshing = undefined;
      },
    );
    await this.#refreshing;
  }

  async #refreshAll(cwd: string, force: boolean): Promise<void> {
    await Promise.all(
      (Object.keys(ACP_AGENTS) as AcpAgentId[]).map(async (agentId) => {
        const definition = ACP_AGENTS[agentId];
        try {
          const cached = this.#cache.get(agentId);
          if (!force && cached && isFresh(cached.refreshedAt)) return;

          const probe = await probeAcpAgent({ agentId, cwd });
          this.#availability.set(agentId, {
            agentId,
            label: definition.label,
            status: probe.status,
            detail: probe.detail,
            modelCount: probe.capabilities?.models.length ?? 0,
            refreshedAt: new Date().toISOString(),
          });

          if (probe.status !== "ready" || !probe.capabilities) {
            // Keep any previously discovered models: a CLI that is temporarily
            // logged out should not empty the picker.
            return;
          }
          this.#cache.set(agentId, {
            agentId,
            refreshedAt: new Date().toISOString(),
            models: probe.capabilities.models.map((model) =>
              toModelInfo(agentId, model.value, model.label),
            ),
          });
        } catch (error) {
          this.#log(`ACP model discovery failed for ${agentId}`, error);
        }
      }),
    );
    await this.#persist();
  }

  async #persist(): Promise<void> {
    const file: CacheFile = { agents: [...this.#cache.values()] };
    await atomicWriteJson(this.#path(), file, 0o600).catch((error: unknown) => {
      this.#log("Could not cache ACP models", error);
    });
  }

  #path(): string {
    return join(this.#home, CACHE_FILE);
  }
}

function isFresh(refreshedAt: string): boolean {
  const timestamp = Date.parse(refreshedAt);
  return (
    Number.isFinite(timestamp) &&
    Date.now() - timestamp < MODEL_CACHE_MAX_AGE_MS
  );
}

function toModelInfo(
  agentId: AcpAgentId,
  modelId: string,
  label: string,
): ModelInfo {
  const displayName = acpModelDisplayName(agentId, modelId, label);
  return {
    provider: acpProviderId(agentId),
    modelId,
    name: displayName,
    label: displayName,
    // The agent runs its own loop and never reports these, so they stay unset
    // rather than being guessed; the UI already renders "unknown" for zero.
    reasoning: false,
    input: ["text"],
    supportedThinkingLevels: ["off"],
    supportsServiceTier: false,
    contextWindow: 0,
    maxOutputTokens: 0,
  };
}

export function acpModelDisplayName(
  agentId: AcpAgentId,
  modelId: string,
  label: string,
): string {
  if (agentId === "cursor" && modelId.startsWith("composer-2.5")) {
    return modelId.includes("fast=true") ? "Composer 2.5 Fast" : "Composer 2.5";
  }
  return label;
}
