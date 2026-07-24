import { analyzeSkin } from "@/lib/youcam/skin";
import { interpretSkin } from "@/lib/poise/interpret";
import { generateFeedback } from "@/lib/llm/groq";
import { locateConcern } from "@/lib/poise/regions";

/**
 * Poise core endpoint: image → skin analysis → interpretation → spoken text.
 * COSTS API UNITS (one skin-analysis on success).
 *
 * POST { imageUrl }  OR  multipart form-data with an "image" file.
 * Returns the spoken message plus the structured plan (for the UI / captions).
 */
export async function POST(request: Request) {
  try {
    const { bytes, contentType, makeupTips, previousOverall, error } = await readImage(request);
    if (error) return Response.json({ ok: false, error }, { status: 400 });

    // Dev-only: persist the last captured frame + log size so we can diagnose
    // capture/face issues by looking at what the webcam actually sent.
    if (process.env.NODE_ENV !== "production" && bytes) {
      try {
        const fs = await import("node:fs/promises");
        await fs.mkdir(".poise-debug", { recursive: true });
        await fs.writeFile(".poise-debug/last-capture.jpg", bytes);
      } catch {}
      console.log(`[poise] capture: ${bytes.length} bytes, type=${contentType}`);
    }

    let analysis;
    try {
      analysis = await analyzeSkin(bytes!, { contentType });
    } catch (e) {
      console.error("[poise] skin analysis error:", (e as Error).message);
      throw e;
    }
    const plan = interpretSkin(analysis, { makeupTips });

    // Spatial mapping: for the top flagged concerns, find WHERE on the face they
    // are from their detection masks (novel spoken guidance for blind users).
    const locations: Record<string, string> = {};
    await Promise.all(
      plan.concerns.slice(0, 2).map(async (c) => {
        const a = analysis.concerns.find((x) => x.type === c.type);
        const url = a?.mask_urls?.[0];
        if (!url) return;
        const loc = await locateConcern(url);
        if (loc) locations[c.concern] = loc;
      })
    );

    const { text, source } = await generateFeedback(plan, {
      makeupTips,
      previousOverall,
      locations,
    });

    return Response.json({
      ok: true,
      spokenText: text,
      phrasingSource: source, // "groq" | "fallback"
      locations, // concern -> where on the face (from mask analysis)
      headline: plan.headline,
      overall: plan.overallScore,
      skinAge: plan.skinAge,
      positives: plan.positives,
      concerns: plan.concerns,
      scores: analysis.concerns.map((c) => ({
        type: c.type,
        raw_score: c.raw_score,
        ui_score: c.ui_score,
      })),
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

async function readImage(request: Request): Promise<{
  bytes?: Buffer;
  contentType: string;
  makeupTips: boolean;
  previousOverall?: number;
  error?: string;
}> {
  const reqType = request.headers.get("content-type") ?? "";
  let contentType = "image/jpeg";

  if (reqType.includes("application/json")) {
    const body = await request.json();
    const makeupTips = body?.makeupTips === true || body?.makeupTips === "true";
    const previousOverall = Number.isFinite(Number(body?.previousOverall))
      ? Number(body.previousOverall)
      : undefined;
    const imageUrl = body?.imageUrl;
    if (!imageUrl)
      return { contentType, makeupTips, previousOverall, error: "Provide imageUrl or an image file" };
    const img = await fetch(imageUrl);
    if (!img.ok)
      return { contentType, makeupTips, previousOverall, error: `Could not fetch imageUrl (HTTP ${img.status})` };
    contentType = img.headers.get("content-type") ?? contentType;
    return { bytes: Buffer.from(await img.arrayBuffer()), contentType, makeupTips, previousOverall };
  }

  const form = await request.formData();
  const mk = form.get("makeupTips");
  const makeupTips = mk === "true" || mk === "1";
  const prev = Number(form.get("previousOverall"));
  const previousOverall = Number.isFinite(prev) && prev > 0 ? prev : undefined;
  const file = form.get("image");
  if (!(file instanceof Blob))
    return { contentType, makeupTips, previousOverall, error: "Provide an image file" };
  contentType = file.type || contentType;
  return { bytes: Buffer.from(await file.arrayBuffer()), contentType, makeupTips, previousOverall };
}
