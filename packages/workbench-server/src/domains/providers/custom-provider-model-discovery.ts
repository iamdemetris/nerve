import type { CustomProvider } from "@nervekit/contracts";

export type DiscoveredProviderModel = {
  id: string;
  name: string;
};

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const needle = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === needle);
}

function modelsUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models`;
  url.search = "";
  url.hash = "";
  return url;
}

function modelArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  return Array.isArray(record.models) ? record.models : [];
}

function parseModels(payload: unknown): DiscoveredProviderModel[] {
  const models = new Map<string, DiscoveredProviderModel>();
  for (const value of modelArray(payload).slice(0, 10_000)) {
    const record =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : undefined;
    const id =
      typeof value === "string"
        ? value.trim()
        : typeof record?.id === "string"
          ? record.id.trim()
          : typeof record?.name === "string"
            ? record.name.trim()
            : "";
    if (!id) continue;
    const name =
      typeof record?.display_name === "string"
        ? record.display_name.trim()
        : typeof record?.name === "string"
          ? record.name.trim()
          : id;
    models.set(id, { id, name: name || id });
  }
  return [...models.values()];
}

/** Best-effort discovery for the common provider `/models` contract. */
export async function discoverCustomProviderModels(
  provider: CustomProvider,
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<DiscoveredProviderModel[]> {
  const headers = { ...provider.headers };
  if (apiKey && provider.api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers["x-api-key"] = apiKey;
    if (!hasHeader(headers, "anthropic-version")) {
      headers["anthropic-version"] = "2023-06-01";
    }
  } else if (apiKey && !hasHeader(headers, "authorization")) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const response = await fetchImpl(modelsUrl(provider.baseUrl), {
    headers,
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) return [];
  return parseModels(await response.json());
}
