import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACP_AGENTS,
  acpAgentDefinition,
  buildAcpSpawnInput,
  readAcpSessionCapabilities,
} from "../src/agents.js";

describe("buildAcpSpawnInput", () => {
  it("defaults Cursor to cursor-agent so it cannot collide with the Grok CLI", () => {
    const input = buildAcpSpawnInput("cursor", null, "/work");
    assert.equal(input.command, "cursor-agent");
    assert.deepEqual(input.args, ["acp"]);
    assert.equal(input.cwd, "/work");
  });

  it("defaults OpenCode to the opencode binary", () => {
    const input = buildAcpSpawnInput("opencode", null, "/work");
    assert.equal(input.command, "opencode");
    assert.deepEqual(input.args, ["acp"]);
  });

  it("honours an explicit binary path", () => {
    const input = buildAcpSpawnInput(
      "cursor",
      { binaryPath: "/opt/cursor/bin/cursor-agent" },
      "/work",
    );
    assert.equal(input.command, "/opt/cursor/bin/cursor-agent");
  });

  it("passes a Cursor endpoint through -e before the subcommand", () => {
    const input = buildAcpSpawnInput(
      "cursor",
      { apiEndpoint: "https://proxy.internal" },
      "/work",
    );
    assert.deepEqual(input.args, ["-e", "https://proxy.internal", "acp"]);
  });

  it("ignores an endpoint for OpenCode, which has no such flag", () => {
    const input = buildAcpSpawnInput(
      "opencode",
      { apiEndpoint: "https://proxy.internal" },
      "/work",
    );
    assert.deepEqual(input.args, ["acp"]);
  });

  it("treats blank settings as unset", () => {
    const input = buildAcpSpawnInput(
      "cursor",
      { binaryPath: "   ", apiEndpoint: "" },
      "/work",
    );
    assert.equal(input.command, "cursor-agent");
    assert.deepEqual(input.args, ["acp"]);
  });

  it("passes the environment through when supplied", () => {
    const input = buildAcpSpawnInput("cursor", null, "/work", { FOO: "bar" });
    assert.deepEqual(input.env, { FOO: "bar" });
  });
});

describe("acpAgentDefinition", () => {
  it("carries the login command each vendor documents", () => {
    assert.equal(
      acpAgentDefinition("cursor").loginCommand,
      "cursor-agent login",
    );
    assert.equal(
      acpAgentDefinition("opencode").loginCommand,
      "opencode auth login",
    );
  });

  it("carries the auth method id each agent advertises", () => {
    assert.equal(ACP_AGENTS.cursor.authMethodId, "cursor_login");
    assert.equal(ACP_AGENTS.opencode.authMethodId, "opencode-login");
  });
});

describe("readAcpSessionCapabilities", () => {
  it("reads Cursor's top-level models and modes blocks", () => {
    const capabilities = readAcpSessionCapabilities({
      sessionId: "s1",
      models: {
        currentModelId: "composer-2.5[fast=true]",
        availableModels: [
          { modelId: "default[]", name: "Auto" },
          { modelId: "composer-2.5[fast=true]", name: "composer-2.5" },
        ],
      },
      modes: {
        currentModeId: "agent",
        availableModes: [
          { id: "agent", name: "Agent" },
          { id: "plan", name: "Plan" },
        ],
      },
    });

    assert.deepEqual(capabilities.models, [
      { value: "default[]", label: "Auto" },
      { value: "composer-2.5[fast=true]", label: "composer-2.5" },
    ]);
    assert.equal(capabilities.currentModelId, "composer-2.5[fast=true]");
    assert.deepEqual(capabilities.modes, [
      { value: "agent", label: "Agent" },
      { value: "plan", label: "Plan" },
    ]);
    assert.equal(capabilities.currentModeId, "agent");
  });

  it("reads OpenCode's models from configOptions instead", () => {
    const capabilities = readAcpSessionCapabilities({
      sessionId: "ses_1",
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "opencode/big-pickle",
          options: [
            { value: "opencode/big-pickle", name: "Big Pickle" },
            {
              value: "openrouter/aion-labs/aion-2.0",
              name: "OpenRouter/Aion-2.0",
            },
          ],
        },
      ],
    });

    assert.deepEqual(capabilities.models, [
      { value: "opencode/big-pickle", label: "Big Pickle" },
      { value: "openrouter/aion-labs/aion-2.0", label: "OpenRouter/Aion-2.0" },
    ]);
    assert.equal(capabilities.currentModelId, "opencode/big-pickle");
    assert.deepEqual(capabilities.modes, []);
  });

  it("falls back to the option value when no label is given", () => {
    const capabilities = readAcpSessionCapabilities({
      sessionId: "s1",
      configOptions: [{ id: "model", options: [{ value: "raw-model" }] }],
    });
    assert.deepEqual(capabilities.models, [
      { value: "raw-model", label: "raw-model" },
    ]);
  });

  it("returns empty capabilities when the agent reports none", () => {
    const capabilities = readAcpSessionCapabilities({ sessionId: "s1" });
    assert.deepEqual(capabilities.models, []);
    assert.deepEqual(capabilities.modes, []);
    assert.equal(capabilities.currentModelId, undefined);
  });
});
