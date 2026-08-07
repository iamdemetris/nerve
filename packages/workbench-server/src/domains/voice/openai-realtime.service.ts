import { ApplicationError } from "../../core/application-error.js";
import type { AuthManager } from "../auth/index.js";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export const OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";

type OpenAIRealtimeAuth = Pick<AuthManager, "getApiKey">;
type Fetch = typeof fetch;

function upstreamMessage(body: string, fallback: string): string {
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === "string" && message.trim()
      ? message.trim()
      : fallback;
  } catch {
    return fallback;
  }
}

export async function createOpenAIRealtimeCall(
  auth: OpenAIRealtimeAuth,
  offerSdp: string,
  fetcher: Fetch = fetch,
): Promise<string> {
  const apiKey = await auth.getApiKey("openai");
  if (!apiKey) {
    throw new ApplicationError(
      401,
      "OPENAI_API_KEY_REQUIRED",
      "ChatGPT Voice needs a standard OpenAI API key. Add one under Providers & authentication.",
    );
  }

  const form = new FormData();
  form.set("sdp", offerSdp);
  form.set(
    "session",
    JSON.stringify({
      type: "realtime",
      model: OPENAI_REALTIME_MODEL,
      audio: { output: { voice: "marin" } },
    }),
  );

  let response: Response;
  try {
    response = await fetcher(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (error) {
    throw new ApplicationError(
      503,
      "OPENAI_REALTIME_UNAVAILABLE",
      `Could not connect to ChatGPT Voice: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = upstreamMessage(
      body,
      response.statusText || "OpenAI rejected the realtime session.",
    );
    if (response.status === 401 || response.status === 403) {
      throw new ApplicationError(
        response.status,
        "OPENAI_API_KEY_REJECTED",
        `OpenAI rejected the API key: ${message}`,
      );
    }
    if (response.status === 429) {
      throw new ApplicationError(
        429,
        "OPENAI_REALTIME_RATE_LIMITED",
        `ChatGPT Voice is rate limited: ${message}`,
        { retryable: true },
      );
    }
    throw new ApplicationError(
      response.status,
      "OPENAI_REALTIME_FAILED",
      `ChatGPT Voice could not start: ${message}`,
      { retryable: response.status >= 500 },
    );
  }

  const answerSdp = await response.text();
  if (!answerSdp.trim()) {
    throw new ApplicationError(
      502,
      "OPENAI_REALTIME_EMPTY_ANSWER",
      "OpenAI returned an empty realtime connection answer.",
      { retryable: true },
    );
  }
  return answerSdp;
}
