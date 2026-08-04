import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cursorModeAllowsEdits,
  formatCursorModelId,
  parseCursorModelId,
  resolveCursorBaseModelId,
  withCursorModelParameters,
} from "../src/cursor.js";

describe("parseCursorModelId", () => {
  it("splits a parameterized id into its base and parameters", () => {
    const parsed = parseCursorModelId(
      "claude-opus-5[thinking=true,context=300k,effort=high,fast=false]",
    );
    assert.equal(parsed.baseId, "claude-opus-5");
    assert.deepEqual(parsed.parameters, {
      thinking: "true",
      context: "300k",
      effort: "high",
      fast: "false",
    });
  });

  it("returns an empty parameter set for a plain id", () => {
    assert.deepEqual(parseCursorModelId("composer-2.5"), {
      baseId: "composer-2.5",
      parameters: {},
    });
  });

  it("handles the empty bracket form Cursor uses for Auto", () => {
    assert.deepEqual(parseCursorModelId("default[]"), {
      baseId: "default",
      parameters: {},
    });
  });

  it("treats a bare flag as enabled", () => {
    assert.deepEqual(parseCursorModelId("grok-4.5[fast]").parameters, {
      fast: "true",
    });
  });

  it("round trips through formatCursorModelId", () => {
    const original = "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]";
    assert.equal(formatCursorModelId(parseCursorModelId(original)), original);
  });
});

describe("resolveCursorBaseModelId", () => {
  it("strips parameters", () => {
    assert.equal(
      resolveCursorBaseModelId("composer-2.5[fast=true]"),
      "composer-2.5",
    );
  });

  it("returns an empty string for a missing model", () => {
    assert.equal(resolveCursorBaseModelId(undefined), "");
    assert.equal(resolveCursorBaseModelId(null), "");
  });
});

describe("withCursorModelParameters", () => {
  it("overrides one parameter and preserves the rest", () => {
    const updated = withCursorModelParameters(
      "claude-opus-5[thinking=true,context=300k,effort=high]",
      { effort: "low" },
    );
    assert.equal(
      updated,
      "claude-opus-5[thinking=true,context=300k,effort=low]",
    );
  });

  it("adds a parameter that was not present", () => {
    assert.equal(
      withCursorModelParameters("composer-2.5", { fast: "true" }),
      "composer-2.5[fast=true]",
    );
  });

  it("removes a parameter when the override is undefined", () => {
    assert.equal(
      withCursorModelParameters("composer-2.5[fast=true]", { fast: undefined }),
      "composer-2.5",
    );
  });
});

describe("cursorModeAllowsEdits", () => {
  it("allows edits only in agent mode", () => {
    assert.equal(cursorModeAllowsEdits("agent"), true);
    assert.equal(cursorModeAllowsEdits("plan"), false);
    assert.equal(cursorModeAllowsEdits("ask"), false);
    assert.equal(cursorModeAllowsEdits(undefined), false);
  });
});
