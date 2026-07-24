/**
 * YouCam / Perfect Corp S2S API configuration.
 *
 * Auth flow (confirmed from Perfect Corp docs, see plan.md §6a):
 *   POST {base}/s2s/v1.0/client/auth  { client_id, id_token }
 *   where id_token = RSA-encrypt("client_id=<id>&timestamp=<ms>")
 *   using the Base64-decoded client_secret as an X.509 (SPKI) RSA public key.
 */

export const YOUCAM_API_BASE = (
  process.env.YOUCAM_API_BASE ?? "https://yce-api-01.perfectcorp.com"
).replace(/\/+$/, "");

export const YOUCAM_API_PREFIX = "/s2s/v1.0";

export interface YouCamCredentials {
  clientId: string;
  clientSecret: string;
}

/** Reads credentials from env. Throws a clear error if missing. */
export function getYouCamCredentials(): YouCamCredentials {
  const clientId = process.env.YOUCAM_API_KEY;
  const clientSecret = process.env.YOUCAM_SECRET_KEY;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing YouCam credentials. Set YOUCAM_API_KEY and YOUCAM_SECRET_KEY in .env.local (or .env)."
    );
  }
  return { clientId, clientSecret };
}
