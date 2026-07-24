/**
 * Skin-state colour modulation — the core novelty: your palette isn't a fixed
 * season, it's a live function of today's skin. We read the live skin-analysis
 * concerns (redness, dullness, under-eye shadow) and derive a *directive* that
 * steers garment colours NEAR THE FACE (tops, dresses) — leaving lower-body
 * colours free (zone-aware). This turns the Skin AI signal into a real styling
 * decision, not just a spoken note.
 */

export interface SkinConcern {
  type: string; // e.g. "redness", "radiance", "dark_circle_v2"
  concern?: string;
  severity?: string; // great | good | mild | moderate | significant
  score?: number; // 0-100, higher = healthier
}

export interface SkinDirective {
  note: string; // one warm spoken sentence about today's skin
  reasons: string[]; // machine tags, e.g. ["redness","dullness"]
  favor: string; // what to favour, in words (for the LLM)
  avoidNearFace: string[]; // hue families to penalise for face-zone garments
  penalizeMuted: boolean; // dullness → avoid muddy/muted near the face
  penalizeSallow: boolean; // under-eye shadow → avoid yellow/olive near the face
}

const ELEVATED = new Set(["mild", "moderate", "significant"]);

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Build a styling directive from today's flagged skin concerns. Null if skin is clear. */
export function deriveSkinDirective(concerns: SkinConcern[] | null | undefined): SkinDirective | null {
  if (!Array.isArray(concerns) || !concerns.length) return null;
  const active = new Set(
    concerns.filter((c) => ELEVATED.has(String(c.severity ?? "").toLowerCase())).map((c) => c.type)
  );

  const reasons: string[] = [];
  const noteBits: string[] = [];
  const favorBits: string[] = [];
  const avoidNearFace = new Set<string>();
  let penalizeMuted = false;
  let penalizeSallow = false;

  if (active.has("redness")) {
    reasons.push("redness");
    noteBits.push("a little flushed");
    favorBits.push("cool, soft tones");
    ["red", "orange"].forEach((f) => avoidNearFace.add(f));
  }
  if (active.has("radiance")) {
    reasons.push("dullness");
    noteBits.push("a touch tired");
    favorBits.push("clearer, brighter shades");
    penalizeMuted = true;
  }
  if (active.has("dark_circle_v2") || active.has("eye_bag")) {
    reasons.push("under-eye shadow");
    noteBits.push("a bit shadowed under the eyes");
    favorBits.push("bright, cool colours near your face");
    penalizeSallow = true;
  }
  if (active.has("oiliness")) {
    // No hue steer for shine, but worth acknowledging.
    reasons.push("shine");
    noteBits.push("a little shiny");
  }

  if (!reasons.length) return null;

  return {
    note: `Your skin looks ${joinNatural(noteBits)} today.`,
    reasons,
    favor: joinNatural(Array.from(new Set(favorBits))) || "your best palette colours",
    avoidNearFace: Array.from(avoidNearFace),
    penalizeMuted,
    penalizeSallow,
  };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hueFamily(h: number, s: number): string {
  if (s < 0.16) return "neutral";
  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 68) return "yellow";
  if (h < 90) return "yellow-green";
  if (h < 160) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

/**
 * How much today's skin argues AGAINST this colour near the face, 0 (fine) → 1
 * (bad). Only apply to face-zone garments (tops / full-body); lower body is free.
 */
export function skinFacePenalty(garmentHex: string, dir: SkinDirective): number {
  const { h, s, l } = hexToHsl(garmentHex);
  const fam = hueFamily(h, s);
  let p = 0;
  if (dir.avoidNearFace.includes(fam)) p += 0.6;
  if (dir.penalizeSallow && (fam === "yellow" || fam === "yellow-green")) p += 0.5;
  if (dir.penalizeMuted && s < 0.35 && l > 0.22 && l < 0.62) p += 0.3;
  return Math.min(1, p);
}

/** Category → is this garment worn near the face (so the skin directive applies)? */
export function isFaceZone(category?: string): boolean {
  return category === "upper_body" || category === "full_body" || category === "top";
}
