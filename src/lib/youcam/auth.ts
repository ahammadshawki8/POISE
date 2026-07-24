import crypto from "node:crypto";
import {
  YOUCAM_API_BASE,
  YOUCAM_API_PREFIX,
  getYouCamCredentials,
} from "./config";

/**
 * Access-token manager for the YouCam S2S API.
 *
 * Tokens are valid for 2 hours; we cache in-module and refresh with a safety
 * margin. This lives server-side only — credentials never reach the browser.
 */

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let cache: TokenCache | null = null;

// Padding fallbacks: Perfect Corp specifies "RSA X.509"; PKCS1 v1.5 is the
// common default, but we try OAEP variants if that is rejected, so a padding
// mismatch surfaces as a clear message instead of a silent auth failure.
const PADDINGS = [
  { name: "PKCS1_v1.5", padding: crypto.constants.RSA_PKCS1_PADDING },
  { name: "OAEP-SHA1", padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
] as const;

/**
 * Builds the id_token: RSA-encrypt "client_id=<id>&timestamp=<ms>" with the
 * client_secret (a Base64-encoded X.509/SPKI RSA public key).
 */
function buildIdToken(
  clientId: string,
  clientSecret: string,
  paddingIndex = 0
): string {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(clientSecret, "base64"),
    format: "der",
    type: "spki",
  });
  const payload = `client_id=${clientId}&timestamp=${Date.now()}`;
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: PADDINGS[paddingIndex].padding },
    Buffer.from(payload, "utf8")
  );
  return encrypted.toString("base64");
}

async function requestToken(idToken: string, clientId: string) {
  const res = await fetch(`${YOUCAM_API_BASE}${YOUCAM_API_PREFIX}/client/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, id_token: idToken }),
  });
  const json = (await res.json().catch(() => null)) as
    | { status?: number; result?: { access_token?: string }; error?: unknown }
    | null;
  return { res, json };
}

/**
 * Returns a valid access token, refreshing if needed.
 * Tries padding variants on the first call so RSA padding mismatches are obvious.
 */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expiresAt > now + 60_000) {
    return cache.token;
  }

  const { clientId, clientSecret } = getYouCamCredentials();

  let lastError = "";
  for (let i = 0; i < PADDINGS.length; i++) {
    const idToken = buildIdToken(clientId, clientSecret, i);
    const { res, json } = await requestToken(idToken, clientId);
    const token = json?.result?.access_token;
    if (res.ok && token) {
      // Valid 2h; cache for 110 min.
      cache = { token, expiresAt: now + 110 * 60_000 };
      return token;
    }
    lastError = `[${PADDINGS[i].name}] HTTP ${res.status}: ${JSON.stringify(
      json
    )?.slice(0, 300)}`;
  }

  throw new Error(`YouCam auth failed. ${lastError}`);
}

/** Clears the cached token (e.g. after a 401). */
export function invalidateToken() {
  cache = null;
}
