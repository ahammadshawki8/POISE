import type { SkinToneResult } from "@/lib/youcam/skinTone";

/**
 * Personal color analysis. Turns measured facial colors (from the Facial Color
 * Tones API) into an undertone, depth, contrast, a color "season", and a
 * flattering palette + best metals + colors to avoid. This is the bridge from
 * Skin AI to styling — the same signal that governs makeup AND clothing.
 */

export interface Swatch {
  name: string;
  hex: string;
}
export interface ColorProfile {
  season: string; // e.g. "Warm Autumn"
  parent: "Spring" | "Summer" | "Autumn" | "Winter";
  undertone: "warm" | "cool" | "neutral";
  depth: "light" | "medium" | "deep";
  contrast: "soft" | "medium" | "bright";
  metals: string; // "gold" | "silver" | "gold or silver"
  palette: Swatch[];
  avoid: string[];
  measured: {
    skin?: string;
    eye?: string;
    eyeName?: string;
    lip?: string;
    hair?: string;
    hairName?: string;
  };
}

function hexToRgb(hex?: string): [number, number, number] | null {
  if (!hex) return null;
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

const PALETTES: Record<ColorProfile["parent"], { metals: string; palette: Swatch[]; avoid: string[] }> = {
  Spring: {
    metals: "gold",
    palette: [
      { name: "coral", hex: "#FF7F5C" },
      { name: "peach", hex: "#FFB07C" },
      { name: "warm turquoise", hex: "#3EC6C0" },
      { name: "golden yellow", hex: "#F5C542" },
      { name: "ivory", hex: "#FBF3E0" },
      { name: "camel", hex: "#C9A063" },
      { name: "leaf green", hex: "#8DBF5A" },
    ],
    avoid: ["black", "cool dusty pastels", "muddy tones"],
  },
  Summer: {
    metals: "silver",
    palette: [
      { name: "soft rose", hex: "#E4A6B7" },
      { name: "powder blue", hex: "#A9C6E8" },
      { name: "lavender", hex: "#B7A9D9" },
      { name: "sage", hex: "#A9C1A1" },
      { name: "dove grey", hex: "#B9BCC2" },
      { name: "mauve", hex: "#9D7B93" },
      { name: "soft navy", hex: "#3E4E6B" },
    ],
    avoid: ["orange", "bright warm colors", "harsh black"],
  },
  Autumn: {
    metals: "gold or bronze",
    palette: [
      { name: "olive", hex: "#6B6B3A" },
      { name: "rust", hex: "#B7410E" },
      { name: "terracotta", hex: "#C97B5A" },
      { name: "mustard", hex: "#D6A419" },
      { name: "cream", hex: "#F3E9CE" },
      { name: "warm brown", hex: "#7A4B2B" },
      { name: "teal", hex: "#2C7A73" },
    ],
    avoid: ["icy pastels", "fuchsia", "pure bright white"],
  },
  Winter: {
    metals: "silver",
    palette: [
      { name: "true red", hex: "#D0021B" },
      { name: "emerald", hex: "#0B8457" },
      { name: "royal blue", hex: "#1E44B8" },
      { name: "magenta", hex: "#C2185B" },
      { name: "pure white", hex: "#FFFFFF" },
      { name: "black", hex: "#111111" },
      { name: "icy pink", hex: "#F3C6D6" },
    ],
    avoid: ["muted earthy tones", "orange", "beige"],
  },
};

export function analyzeColor(tone: SkinToneResult): ColorProfile {
  const skin = hexToRgb(tone.skin_color);
  const hair = hexToRgb(tone.hair_color);

  // Undertone: skin warmth via red-vs-blue lean (skin is always red-biased, so
  // calibrated thresholds), nudged by hair colour name.
  let undertone: ColorProfile["undertone"] = "neutral";
  if (skin) {
    const warmth = skin[0] - skin[2]; // R - B
    if (warmth >= 48) undertone = "warm";
    else if (warmth <= 26) undertone = "cool";
  }
  const hairName = (tone.hair_color_name ?? "").toLowerCase();
  if (undertone === "neutral") {
    if (/auburn|red|blonde|brown/.test(hairName)) undertone = "warm";
    else if (/black|grey|white/.test(hairName)) undertone = "cool";
  }

  // Depth from skin luminance.
  const L = skin ? lum(skin) : 150;
  const depth: ColorProfile["depth"] = L >= 185 ? "light" : L <= 120 ? "deep" : "medium";

  // Contrast from skin-vs-hair luminance gap.
  const gap = skin && hair ? Math.abs(lum(skin) - lum(hair)) : 60;
  const contrast: ColorProfile["contrast"] = gap >= 90 ? "bright" : gap <= 45 ? "soft" : "medium";

  // Season: undertone picks warm(Spring/Autumn) vs cool(Summer/Winter); depth
  // splits light(Spring/Summer) vs deep(Autumn/Winter).
  let parent: ColorProfile["parent"];
  const warm = undertone === "warm" || (undertone === "neutral" && /auburn|red|blonde|brown/.test(hairName));
  if (warm) parent = depth === "deep" ? "Autumn" : depth === "light" ? "Spring" : contrast === "bright" ? "Spring" : "Autumn";
  else parent = depth === "deep" ? "Winter" : depth === "light" ? "Summer" : contrast === "bright" ? "Winter" : "Summer";

  const modifier =
    contrast === "bright" ? "Bright" : contrast === "soft" ? "Soft" : undertone === "warm" ? "Warm" : undertone === "cool" ? "Cool" : "True";
  const season = `${modifier} ${parent}`;

  const base = PALETTES[parent];
  return {
    season,
    parent,
    undertone,
    depth,
    contrast,
    metals: base.metals,
    palette: base.palette,
    avoid: base.avoid,
    measured: {
      skin: tone.skin_color,
      eye: tone.eye_color,
      eyeName: tone.eye_color_name,
      lip: tone.lip_color,
      hair: tone.hair_color,
      hairName: tone.hair_color_name,
    },
  };
}

// Perceptual-ish RGB distance (redmean).
function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const rmean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

export interface GarmentVerdict {
  rating: "great" | "good" | "poor";
  nearest: string; // nearest palette colour name
  note: string; // one spoken clause
}

/** Judges how well a garment colour suits the user's palette + undertone. */
export function garmentVerdict(profile: ColorProfile, garmentHex: string): GarmentVerdict {
  const g = hexToRgb(garmentHex) ?? [128, 128, 128];
  let nearest = profile.palette[0]?.name ?? "your colours";
  let best = Infinity;
  for (const sw of profile.palette) {
    const rgb = hexToRgb(sw.hex);
    if (!rgb) continue;
    const d = colorDistance(g, rgb);
    if (d < best) {
      best = d;
      nearest = sw.name;
    }
  }
  // Undertone agreement (garment warm/cool vs user).
  const gWarm = g[0] - g[2];
  const undertoneMatch =
    profile.undertone === "neutral" ? true : profile.undertone === "warm" ? gWarm >= 30 : gWarm <= 55;

  let rating: GarmentVerdict["rating"];
  if (best <= 90 && undertoneMatch) rating = "great";
  else if (best <= 170 || undertoneMatch) rating = "good";
  else rating = "poor";

  const note =
    rating === "great"
      ? `it's right in your palette, close to ${nearest}`
      : rating === "good"
        ? `it works — near your ${nearest}`
        : `it fights your ${profile.undertone} undertone a little`;
  return { rating, nearest, note };
}

/** Rule-based spoken description (LLM-free fallback). */
export function describeColorProfile(p: ColorProfile): string {
  const colors = p.palette.slice(0, 4).map((s) => s.name);
  const colorList = `${colors.slice(0, -1).join(", ")}, and ${colors[colors.length - 1]}`;
  return `You have a ${p.undertone} undertone, which makes you a ${p.season}. Colours like ${colorList} light you up, and ${p.metals} jewellery suits you best. It's worth going easy on ${p.avoid[0]}.`;
}
