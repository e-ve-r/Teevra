/** Shared network layer for the reporter API; supports injection for contract tests. */
export async function requestWithBase<T>(base: string, path: string, options: RequestInit = {}, send: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  let response: Response;
  try {
    response = await send(`${base}${path}`, { ...options, signal: options.signal || controller.signal });
  } catch (failure) {
    if (failure instanceof Error && failure.name === 'AbortError') throw new Error('The request timed out. Please try again.');
    throw new Error('Cannot reach the server. Check its address and your connection.');
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'The request failed. Please check the details and try again.');
  return data as T;
}
