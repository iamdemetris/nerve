import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../src/core/application-error.js";
import {
  createOpenAIRealtimeCall,
  OPENAI_REALTIME_MODEL,
} from "../src/domains/voice/openai-realtime.service.js";

function authWithKey(key: string | undefined) {
  return { getApiKey: async () => key };
}

describe("createOpenAIRealtimeCall", () => {
  it("exchanges an SDP offer without exposing the API key to the client", async () => {
    let request: Request | undefined;
    const answer = await createOpenAIRealtimeCall(
      authWithKey("sk-openai-test"),
      "v=0\r\no=nerve-offer",
      async (input, init) => {
        request = new Request(input, init);
        return new Response("v=0\r\no=openai-answer", {
          headers: { "content-type": "application/sdp" },
        });
      },
    );

    assert.equal(answer, "v=0\r\no=openai-answer");
    assert.equal(request?.url, "https://api.openai.com/v1/realtime/calls");
    assert.equal(
      request?.headers.get("authorization"),
      "Bearer sk-openai-test",
    );
    const form = await request?.formData();
    assert.equal(form?.get("sdp"), "v=0\r\no=nerve-offer");
    assert.deepEqual(JSON.parse(String(form?.get("session"))), {
      type: "realtime",
      model: OPENAI_REALTIME_MODEL,
      audio: { output: { voice: "marin" } },
    });
  });

  it("requires a standard OpenAI API key", async () => {
    await assert.rejects(
      () => createOpenAIRealtimeCall(authWithKey(undefined), "v=0"),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationError);
        assert.equal(error.status, 401);
        assert.equal(error.code, "OPENAI_API_KEY_REQUIRED");
        return true;
      },
    );
  });

  it("normalizes OpenAI rate limits into a retryable application error", async () => {
    await assert.rejects(
      () =>
        createOpenAIRealtimeCall(
          authWithKey("sk-openai-test"),
          "v=0",
          async () =>
            new Response('{"error":{"message":"Slow down"}}', {
              status: 429,
              statusText: "Too Many Requests",
            }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationError);
        assert.equal(error.status, 429);
        assert.equal(error.code, "OPENAI_REALTIME_RATE_LIMITED");
        assert.equal(error.options.retryable, true);
        return true;
      },
    );
  });

  it("rejects an empty SDP answer", async () => {
    await assert.rejects(
      () =>
        createOpenAIRealtimeCall(
          authWithKey("sk-openai-test"),
          "v=0",
          async () => new Response(""),
        ),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationError);
        assert.equal(error.code, "OPENAI_REALTIME_EMPTY_ANSWER");
        return true;
      },
    );
  });
});
