export async function fetchContextResource(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const response = await fetcher(url, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Could not load context (${response.status})`);
  }
  return response;
}
