import { describeOutfitOpenRouter } from "@/lib/llm/openrouter";

/**
 * "I changed my clothes" — describe the user's current outfit (OpenRouter vision)
 * and return items to remember in the wardrobe.
 * POST multipart "image" or JSON { imageUrl } -> { ok, description, items }
 */
export async function POST(request: Request) {
  try {
    let bytes: Buffer;
    let mime = "image/jpeg";
    const reqType = request.headers.get("content-type") ?? "";
    if (reqType.includes("application/json")) {
      const { imageUrl } = await request.json();
      if (!imageUrl) return Response.json({ ok: false, error: "no image" }, { status: 400 });
      const img = await fetch(imageUrl);
      if (!img.ok) return Response.json({ ok: false, error: "fetch failed" }, { status: 400 });
      mime = img.headers.get("content-type") ?? mime;
      bytes = Buffer.from(await img.arrayBuffer());
    } else {
      const form = await request.formData();
      const file = form.get("image");
      if (!(file instanceof Blob)) return Response.json({ ok: false, error: "no image" }, { status: 400 });
      mime = file.type || mime;
      bytes = Buffer.from(await file.arrayBuffer());
    }

    // OpenRouter free vision (multiple free models with internal fallback).
    const result = await describeOutfitOpenRouter(bytes.toString("base64"), mime);
    if (!result) return Response.json({ ok: false, error: "vision unavailable" }, { status: 502 });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
