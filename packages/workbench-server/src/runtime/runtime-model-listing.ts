import { listAvailableModels } from "@nervekit/harness";
import type { ModelInfo } from "@nervekit/contracts";
import type { AcpModelCatalog } from "../domains/acp/acp-model-catalog.js";
import type { ProviderCatalogStore } from "../domains/providers/index.js";

/**
 * The model list offered to clients.
 *
 * External agent CLIs come first because they are the user's own
 * subscriptions; the credential-backed provider catalog follows.
 */
export function listWorkbenchModels(
  providerCatalog: ProviderCatalogStore,
  acp: AcpModelCatalog,
): ModelInfo[] {
  return [
    ...acp.list(),
    ...listAvailableModels(providerCatalog.resolvedModels()).map((model) => ({
      provider: model.provider,
      modelId: model.modelId,
      name: model.name,
      label: model.provider === "nerve-faux" ? "Nerve Faux Fast" : model.name,
      reasoning: model.reasoning,
      input: model.input,
      supportedThinkingLevels: model.supportedThinkingLevels,
      supportsServiceTier: model.supportsServiceTier,
      faux: model.provider === "nerve-faux",
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    })),
  ];
}
