import {
  ApiRequestError,
  parseApiErrorBody,
} from "@nervekit/ui-kit/core/api/client";

export async function createOpenAIRealtimeSession(
  offerSdp: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/voice/openai/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/sdp" },
    body: offerSdp,
    signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const apiError = parseApiErrorBody(body);
    throw new ApiRequestError(
      response.status,
      apiError.code,
      apiError.message ||
        body ||
        response.statusText ||
        "Voice session failed.",
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/sdp")) {
    throw new ApiRequestError(
      response.status,
      undefined,
      `Expected an SDP answer, received ${contentType || "an unknown content type"}.`,
    );
  }
  const answerSdp = await response.text();
  if (!answerSdp.trim()) {
    throw new ApiRequestError(
      502,
      "OPENAI_REALTIME_EMPTY_ANSWER",
      "OpenAI returned an empty voice connection answer.",
    );
  }
  return answerSdp;
}
