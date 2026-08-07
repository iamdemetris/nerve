import assert from "node:assert/strict";
import test from "node:test";
import { fetchContextResource } from "./context-export.js";

test("fetchContextResource returns the same-origin export without navigating", async () => {
  let requestedUrl: string | undefined;
  const response = new Response("# Context", { status: 200 });

  const result = await fetchContextResource(
    "/api/conversations/conv_1/export.md",
    async (url) => {
      requestedUrl = String(url);
      return response;
    },
  );

  assert.equal(requestedUrl, "/api/conversations/conv_1/export.md");
  assert.equal(await result.text(), "# Context");
});

test("fetchContextResource rejects failed exports", async () => {
  await assert.rejects(
    fetchContextResource(
      "/api/agents/agent_1/system-prompt",
      async () => new Response("missing", { status: 404 }),
    ),
    /Could not load context \(404\)/,
  );
});
