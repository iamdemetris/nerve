import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CustomProvider } from "@nervekit/contracts";
import {
  discoverCustomProviderModels,
  ProviderCatalogStore,
} from "../src/domains/providers/index.js";

const provider: CustomProvider = {
  id: "local-models",
  displayName: "Local models",
  api: "openai-completions",
  baseUrl: "http://127.0.0.1:11434/v1",
  headers: { "x-tenant": "test" },
};

describe("custom provider model discovery", () => {
  it("fetches an OpenAI-compatible models endpoint with provider auth", async () => {
    let requestedUrl = "";
    let requestedHeaders: HeadersInit | undefined;
    const models = await discoverCustomProviderModels(
      provider,
      "secret-key",
      async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = init?.headers;
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "model-b", name: "Model B" },
              { id: "model-a" },
              { id: "model-a" },
            ],
          }),
        };
      },
    );

    assert.equal(requestedUrl, "http://127.0.0.1:11434/v1/models");
    assert.deepEqual(requestedHeaders, {
      "x-tenant": "test",
      authorization: "Bearer secret-key",
    });
    assert.deepEqual(models, [
      { id: "model-b", name: "Model B" },
      { id: "model-a", name: "model-a" },
    ]);
  });

  it("merges discovered models without replacing manual definitions", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-provider-models-"));
    try {
      const store = new ProviderCatalogStore(join(home, "providers.json"));
      await store.upsertProvider(provider);
      await store.upsertModel({
        provider: provider.id,
        modelId: "manual",
        name: "Manual model",
        reasoning: true,
        supportedThinkingLevels: ["off", "high"],
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_000,
      });

      const catalog = await store.mergeDiscoveredModels(provider.id, [
        { id: "manual", name: "Remote manual" },
        { id: "discovered", name: "Discovered model" },
      ]);

      assert.equal(catalog.models.length, 2);
      assert.equal(
        catalog.models.find((model) => model.modelId === "manual")?.name,
        "Manual model",
      );
      assert.equal(
        catalog.models.find((model) => model.modelId === "discovered")?.name,
        "Discovered model",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
