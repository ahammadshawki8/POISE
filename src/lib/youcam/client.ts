import { YOUCAM_API_BASE } from "./config";
import { getAccessToken, invalidateToken } from "./auth";

/**
 * Low-level YouCam S2S transport: authenticated fetch + shared helpers.
 * Feature-specific flows (skin.ts, …) build on top of `authedFetch`, because
 * different features use different API versions, body shapes and response
 * envelopes (see plan.md §6a vs §6b).
 */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Authenticated fetch against the YouCam API. Refreshes token once on 401. */
export async function authedFetch(
  path: string,
  init: RequestInit = {},
  retry = true
): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${YOUCAM_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401 && retry) {
    invalidateToken();
    return authedFetch(path, init, false);
  }
  return res;
}

/** Parse a YouCam JSON response, throwing a readable error on non-2xx. */
export async function parseJson<T = any>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `YouCam API error HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 1500)}`
    );
  }
  return json as T;
}

/** YouCam v2.x responses wrap payload in `data`; older ones in `result`. */
export function envelope<T = any>(json: any): T {
  return (json?.data ?? json?.result ?? json) as T;
}
