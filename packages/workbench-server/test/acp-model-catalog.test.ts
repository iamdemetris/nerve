import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acpModelDisplayName } from "../src/domains/acp/acp-model-catalog.js";

describe("ACP model catalog labels", () => {
  it("surfaces both Cursor Composer 2.5 variants clearly", () => {
    assert.equal(
      acpModelDisplayName("cursor", "composer-2.5", "composer-2.5"),
      "Composer 2.5",
    );
    assert.equal(
      acpModelDisplayName("cursor", "composer-2.5[fast=true]", "composer-2.5"),
      "Composer 2.5 Fast",
    );
  });
});
