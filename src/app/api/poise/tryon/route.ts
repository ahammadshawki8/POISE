import { CATALOG } from "@/lib/poise/wardrobe";
import { garmentVerdict, type ColorProfile } from "@/lib/poise/color";
import { parseGarment } from "@/lib/poise/garments";
import { buildGarmentRef, garmentRefBytes } from "@/lib/poise/garmentImage";
import { deriveSkinDirective, skinFacePenalty, isFaceZone, type SkinConcern } from "@/lib/poise/skinStyle";
import { tryOnGarmentBytes } from "@/lib/youcam/cloth";
import { generateStyleAdvice } from "@/lib/llm/groq";

/**
 * Voice try-on. Two ways in:
 *  - garmentId  → a catalog garment (deterministic verdict + cloth-v3 render).
 *  - garment    → free-text described garment ("white shirt"): we build a
 *                 reference image (real photo if the colour is close, else a
 *                 recoloured neutral) and render it, then speak a verdict that
 *                 weighs palette + occasion + weather.
 * multipart: image? (full-body) + garmentId | garment + profile? + occasion? + weather?
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const garmentId = String(form.get("garmentId") ?? "");
    const garmentText = String(form.get("garment") ?? "");
    const occasion = String(form.get("occasion") ?? "").toLowerCase();
    // A saved real-garment photo ("that purple punjabi") to try back on, instead
    // of generating a stand-in. Data URL or raw base64.
    const refImageRaw = String(form.get("refImage") ?? "");
    const refCategory = String(form.get("refCategory") ?? "");
    const garmentDescription = String(form.get("garmentDescription") ?? "");

    let profile: ColorProfile | null = null;
    try {
      const raw = form.get("profile");
      profile = raw ? (JSON.parse(String(raw)) as ColorProfile) : null;
    } catch {
      profile = null;
    }
    let weather: unknown = null;
    try {
      const raw = form.get("weather");
      weather = raw ? JSON.parse(String(raw)) : null;
    } catch {
      weather = null;
    }
    let skin: SkinConcern[] | undefined;
    try {
      const raw = form.get("skin");
      skin = raw ? (JSON.parse(String(raw)) as SkinConcern[]) : undefined;
    } catch {
      skin = undefined;
    }

    const file = form.get("image");
    const bodyBytes = file instanceof Blob ? Buffer.from(await file.arrayBuffer()) : null;

    // ---- Catalog garment -------------------------------------------------
    if (garmentId) {
      const garment = CATALOG.find((g) => g.id === garmentId);
      if (!garment) return Response.json({ ok: false, error: "unknown garment" }, { status: 400 });

      let spoken: string;
      let rating = "good";
      if (profile) {
        const v = garmentVerdict(profile, garment.colorHex);
        rating = v.rating;
        const lead = v.rating === "great" ? "Ooh, lovely choice." : v.rating === "good" ? "That works nicely." : "Honestly, not your best.";
        const occ = occasion
          ? garment.occasions.some((o) => occasion.includes(o) || o.includes(occasion))
            ? ` And it's right for a ${occasion}.`
            : ` For a ${occasion}, something else might suit better.`
          : "";
        spoken = `The ${garment.name}? ${lead} ${v.note}.${occ}`;
      } else {
        spoken = `Here's the ${garment.name}. Tell me your colours first and I can say how well it suits you.`;
      }

      // Render by recolouring the verified base to the garment's real colour
      // (the catalog stock photos are unreliable for colour).
      let renderUrl: string | null = null;
      let renderNote: string | undefined;
      let previewUrl: string | null = null;
      try {
        const refBytes = await garmentRefBytes(garment.colorHex);
        previewUrl = `data:image/jpeg;base64,${refBytes.toString("base64")}`;
        if (bodyBytes) renderUrl = await tryOnGarmentBytes(bodyBytes, refBytes, "upper_body", { maxWaitMs: 60_000 });
      } catch (e) {
        renderNote = (e as Error).message;
        console.warn("[poise] tryon render failed:", renderNote);
      }
      return Response.json({ ok: true, spokenText: spoken, rating, renderUrl, previewUrl, garment: { id: garment.id, name: garment.name, colorHex: garment.colorHex }, renderNote });
    }

    // ---- Described garment ("how would I look in a white shirt") ----------
    const parsed = parseGarment(garmentText);
    if (!parsed) return Response.json({ ok: false, error: "no garment recognized" }, { status: 400 });

    // The reference garment image: a SAVED real garment photo if we have one,
    // else a generated stand-in recoloured to the requested hue.
    const CLOTH: Record<string, "upper_body" | "lower_body" | "full_body"> = {
      top: "upper_body",
      bottom: "lower_body",
      full_body: "full_body",
    };
    let refBytes: Buffer | null = null;
    let clothCategory: "upper_body" | "lower_body" | "full_body" = "upper_body";
    let previewFromRef: string | null = null;
    let renderNote: string | undefined;

    if (refImageRaw) {
      try {
        const b64 = refImageRaw.includes(",") ? refImageRaw.split(",")[1] : refImageRaw;
        refBytes = Buffer.from(b64, "base64");
        clothCategory = CLOTH[refCategory] ?? CLOTH[parsed.category] ?? "upper_body";
        previewFromRef = refImageRaw.startsWith("data:") ? refImageRaw : `data:image/jpeg;base64,${b64}`;
      } catch (e) {
        renderNote = (e as Error).message;
      }
    }
    if (!refBytes) {
      try {
        const built = await buildGarmentRef(parsed.category, parsed.colorHex);
        if (built) {
          refBytes = built.refBytes;
          clothCategory = built.clothCategory;
          previewFromRef = built.previewDataUrl;
        }
      } catch (e) {
        renderNote = (e as Error).message;
        console.warn("[poise] garment ref build failed:", renderNote);
      }
    }

    // Render it onto the body if we have both a ref and a body shot.
    let renderUrl: string | null = null;
    if (refBytes && bodyBytes) {
      try {
        renderUrl = await tryOnGarmentBytes(bodyBytes, refBytes, clothCategory, { maxWaitMs: 60_000 });
      } catch (e) {
        renderNote = (e as Error).message;
        console.warn("[poise] described tryon render failed:", renderNote);
      }
    }
    const ref = refBytes ? { previewDataUrl: previewFromRef ?? "" } : null;

    // Spoken verdict: palette + occasion + weather + today's skin state.
    const verdict = profile ? garmentVerdict(profile, parsed.colorHex) : null;
    const dir = deriveSkinDirective(skin);
    const skinPenalty = dir && isFaceZone(parsed.category) ? skinFacePenalty(parsed.colorHex, dir) : 0;
    const summary = {
      mode: "describe",
      garment: parsed.name,
      garmentColour: parsed.colorName,
      // When it's a saved real garment, this is its actual vision description —
      // so the speech is about the exact garment they own, not a generic one.
      garmentDescription: garmentDescription || undefined,
      fromWardrobe: refImageRaw ? true : undefined,
      verdict: verdict ? { rating: verdict.rating, note: verdict.note } : undefined,
      season: profile?.season,
      undertone: profile?.undertone,
      metals: profile?.metals,
      occasion: occasion || undefined,
      weather: weather || undefined,
      skinNote: dir?.note,
      skinSteer: dir && isFaceZone(parsed.category)
        ? skinPenalty >= 0.5
          ? `Their skin is ${dir.reasons.join(", ")} today, so this colour is one to keep OFF the face right now — suggest it lower down, or favour ${dir.favor} up top.`
          : `Their skin is ${dir.reasons.join(", ")} today, and this colour sits fine with that near the face.`
        : undefined,
    };
    const spokenText = (await generateStyleAdvice(summary)) ?? fallbackVerdict(parsed.name, verdict?.rating, occasion);

    return Response.json({
      ok: true,
      spokenText,
      rating: verdict?.rating ?? "good",
      renderUrl,
      previewUrl: ref?.previewDataUrl ?? null,
      renderable: !!ref,
      garment: { name: parsed.name, colorHex: parsed.colorHex, category: parsed.category },
      renderNote,
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

function fallbackVerdict(name: string, rating: string | undefined, occasion: string): string {
  const lead = rating === "great" ? "Lovely choice." : rating === "poor" ? "Honestly, not your best." : "That works.";
  return `The ${name}? ${lead}${occasion ? ` Good for a ${occasion}.` : ""}`;
}
