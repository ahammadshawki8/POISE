import { analyzeSkinTone } from "@/lib/youcam/skinTone";
import { analyzeColor, describeColorProfile } from "@/lib/poise/color";
import { generateColorText } from "@/lib/llm/groq";

/**
 * Personal color analysis: image → Facial Color Tones → season + palette →
 * spoken reveal. COSTS API UNITS. POST { imageUrl } or multipart "image".
 */
export async function POST(request: Request) {
  try {
    const { bytes, contentType, error } = await readImage(request);
    if (error) return Response.json({ ok: false, error }, { status: 400 });

    let tone;
    try {
      tone = await analyzeSkinTone(bytes!, { contentType });
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[poise] skin-tone error:", msg);
      return Response.json({ ok: false, error: msg }, { status: 500 });
    }

    const profile = analyzeColor(tone);
    const spokenText = (await generateColorText(profile)) ?? describeColorProfile(profile);

    return Response.json({ ok: true, spokenText, profile });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

async function readImage(request: Request): Promise<{ bytes?: Buffer; contentType: string; error?: string }> {
  const reqType = request.headers.get("content-type") ?? "";
  let contentType = "image/jpeg";
  if (reqType.includes("application/json")) {
    const { imageUrl } = await request.json();
    if (!imageUrl) return { contentType, error: "Provide imageUrl or an image file" };
    const img = await fetch(imageUrl);
    if (!img.ok) return { contentType, error: `Could not fetch imageUrl (HTTP ${img.status})` };
    contentType = img.headers.get("content-type") ?? contentType;
    return { bytes: Buffer.from(await img.arrayBuffer()), contentType };
  }
  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof Blob)) return { contentType, error: "Provide an image file" };
  contentType = file.type || contentType;
  return { bytes: Buffer.from(await file.arrayBuffer()), contentType };
}
