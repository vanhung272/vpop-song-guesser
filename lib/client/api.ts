/** Thin fetch wrapper for our own JSON API routes (browser side). */

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

export async function apiFetch<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? 'GET';
  const init: RequestInit = { method, cache: 'no-store', credentials: 'same-origin' };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { 'content-type': 'application/json' };
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: 'NETWORK' };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body: fall through with null.
  }
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  const error =
    json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
      ? (json as { error: string }).error
      : 'INTERNAL';
  return { ok: false, status: res.status, error };
}
