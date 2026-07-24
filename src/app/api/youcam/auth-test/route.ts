import { getAccessToken } from "@/lib/youcam/auth";

/**
 * Diagnostic: verifies the RSA auth flow returns an access token.
 * Costs zero API units. Visit /api/youcam/auth-test in dev.
 */
export async function GET() {
  try {
    const token = await getAccessToken(true);
    return Response.json({
      ok: true,
      tokenPreview: `${token.slice(0, 10)}…${token.slice(-6)}`,
      length: token.length,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
