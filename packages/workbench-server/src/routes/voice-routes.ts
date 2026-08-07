import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { createOpenAIRealtimeCall } from "../domains/voice/openai-realtime.service.js";
import { HttpError } from "../http/errors.js";
import { routeHandler } from "../http/responses.js";

const MAX_SDP_BYTES = 1024 * 1024;

export function createVoiceRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.post(
    "/voice/openai/session",
    routeHandler(async (c) => {
      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("application/sdp")) {
        throw new HttpError(
          415,
          "SDP_CONTENT_TYPE_REQUIRED",
          "ChatGPT Voice session offers must use application/sdp.",
        );
      }
      const offerSdp = await c.req.text();
      if (!offerSdp.trim()) {
        throw new HttpError(
          400,
          "SDP_OFFER_REQUIRED",
          "An SDP offer is required to start ChatGPT Voice.",
        );
      }
      if (new TextEncoder().encode(offerSdp).byteLength > MAX_SDP_BYTES) {
        throw new HttpError(
          413,
          "SDP_OFFER_TOO_LARGE",
          "The ChatGPT Voice SDP offer is too large.",
        );
      }
      const answerSdp = await createOpenAIRealtimeCall(state.auth, offerSdp);
      return c.body(answerSdp, 200, { "Content-Type": "application/sdp" });
    }),
  );

  return app;
}
