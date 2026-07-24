import { analyzeSkin } from "@/lib/youcam/skin";

/**
 * Diagnostic: runs one real skin-analysis (COSTS API UNITS on success).
 * POST { imageUrl } — server downloads the image, analyzes, returns scores.
 * Also accepts multipart form-data with an "image" file.
 */
export async function POST(request: Request) {
  try {
    let bytes: Buffer;
    let contentType = "image/jpeg";

    const reqType = request.headers.get("content-type") ?? "";
    if (reqType.includes("application/json")) {
      const { imageUrl } = await request.json();
      if (!imageUrl) {
        return Response.json({ ok: false, error: "Provide imageUrl" }, { status: 400 });
      }
      const img = await fetch(imageUrl);
      if (!img.ok) {
        return Response.json(
          { ok: false, error: `Could not fetch imageUrl (HTTP ${img.status})` },
          { status: 400 }
        );
      }
      contentType = img.headers.get("content-type") ?? contentType;
      bytes = Buffer.from(await img.arrayBuffer());
    } else {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof Blob)) {
        return Response.json({ ok: false, error: "Provide an image file" }, { status: 400 });
      }
      contentType = file.type || contentType;
      bytes = Buffer.from(await file.arrayBuffer());
    }

    const result = await analyzeSkin(bytes, { contentType });

    // Trim mask URLs for a readable diagnostic payload.
    const scores = result.concerns.map((c) => ({
      type: c.type,
      raw_score: c.raw_score,
      ui_score: c.ui_score,
    }));

    const debug = request.headers.get("x-debug-raw") === "1";
    return Response.json({
      ok: true,
      all: result.all,
      skin_age: result.skin_age,
      count: scores.length,
      scores,
      ...(debug ? { raw: result.raw } : {}),
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
