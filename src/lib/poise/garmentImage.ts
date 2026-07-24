import sharp from "sharp";
import type { GarmentCategory as ParsedCategory } from "./garments";

/**
 * Turns a colour into a reference garment image for the cloth-v3 try-on.
 *
 * We do NOT trust catalog stock photos for colour (several are mislabelled — an
 * "olive shirt" URL that's actually white, a "black dress" that's actually red).
 * Instead we recolour ONE verified, clean base tee to the exact requested hue
 * using a multiply blend on its luminance, so the garment's real folds/shading
 * are kept while the colour is guaranteed correct — for every hue, black and
 * white included (a plain hue tint can't darken to black; multiply can).
 */

// A clean, plain, well-lit tee on a neutral model — verified to actually be this
// garment (unlike the mislabelled catalog stock). Used as the recolour base.
const BASE_TEE = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&fm=jpg";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

let baseCache: Buffer | null = null;
async function fetchBase(): Promise<Buffer> {
  if (baseCache) return baseCache;
  const res = await fetch(BASE_TEE, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`base garment fetch failed HTTP ${res.status}`);
  baseCache = Buffer.from(await res.arrayBuffer());
  return baseCache;
}

/** Recolour the base tee to `hex`, preserving its shading (multiply blend). */
export async function garmentRefBytes(hex: string): Promise<Buffer> {
  const { r, g, b } = hexToRgb(hex);
  const W = 768;
  const H = 768;
  // Crop to the torso so the GARMENT fills the frame (cloth-v3 segments the ref
  // garment; a person/background-heavy ref makes it keep the original outfit).
  // The base tee model is centred; this box isolates the shirt.
  const src = sharp(await fetchBase());
  const meta = await src.metadata();
  const iw = meta.width ?? 800;
  const ih = meta.height ?? 800;
  const cropW = Math.round(iw * 0.62);
  const cropH = Math.round(ih * 0.6);
  const left = Math.round((iw - cropW) / 2);
  const top = Math.round(ih * 0.1);
  // Desaturate to a luminance map (slightly lifted so mid-tones read the hue),
  // then multiply a solid target colour over it: white areas → the colour,
  // shadows → a darker shade of it, near-black target → black. Correct for all hues.
  const luma = await sharp(await fetchBase())
    .extract({ left, top, width: cropW, height: Math.min(cropH, ih - top) })
    .resize(W, H, { fit: "cover" })
    .removeAlpha()
    .modulate({ saturation: 0 })
    .linear(1.12, 8)
    .toBuffer();
  return sharp(luma)
    .composite([{ input: { create: { width: W, height: H, channels: 3, background: { r, g, b } } }, blend: "multiply" }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

export interface GarmentRef {
  clothCategory: "upper_body" | "lower_body" | "full_body";
  refBytes: Buffer; // recoloured garment — upload as ref_file_id
  previewDataUrl: string; // the garment on its own, to show when there's no body shot
}

// Which described categories we can render (our reliable base is a top).
const RENDERABLE: Partial<Record<ParsedCategory, GarmentRef["clothCategory"]>> = {
  top: "upper_body",
  full_body: "upper_body", // rendered as a coloured top (base is a tee) — colour is what matters
};

/**
 * Build a try-on reference for a described garment. Returns null for categories
 * we can't render (bottoms, hats, shoes, accessories) — the caller falls back to
 * a spoken verdict only.
 */
export async function buildGarmentRef(parsedCategory: ParsedCategory, colorHex: string): Promise<GarmentRef | null> {
  const clothCategory = RENDERABLE[parsedCategory];
  if (!clothCategory) return null;
  const bytes = await garmentRefBytes(colorHex);
  return { clothCategory, refBytes: bytes, previewDataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` };
}
