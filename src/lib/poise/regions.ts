import sharp from "sharp";

/**
 * Spatial skin mapping. Each skin-analysis concern comes with a detection MASK
 * (an RGBA PNG aligned to the analyzed image, whose alpha channel marks where
 * the concern is). We downsample the mask and measure intensity per facial
 * region to tell a blind user WHERE a concern is — e.g. "on your right cheek".
 *
 * Orientation note: the capture is NOT mirrored, so image-left is the person's
 * RIGHT side. Region phrases already account for this (person's perspective).
 */

interface Region {
  key: string;
  box: [number, number, number, number]; // x0,y0,x1,y1 normalized on the tight face crop
}

// Boxes tuned for our ~1.6× face crop (face centered, slightly high).
const REGIONS: Region[] = [
  { key: "forehead", box: [0.30, 0.10, 0.70, 0.30] },
  { key: "nose", box: [0.42, 0.36, 0.58, 0.62] },
  { key: "right_cheek", box: [0.20, 0.46, 0.44, 0.70] }, // person's right (image left)
  { key: "left_cheek", box: [0.56, 0.46, 0.80, 0.70] }, // person's left (image right)
  { key: "right_under_eye", box: [0.30, 0.40, 0.47, 0.50] },
  { key: "left_under_eye", box: [0.53, 0.40, 0.70, 0.50] },
  { key: "chin", box: [0.36, 0.68, 0.64, 0.88] },
];

const PHRASE: Record<string, string> = {
  forehead: "your forehead",
  nose: "around your nose",
  right_cheek: "your right cheek",
  left_cheek: "your left cheek",
  right_under_eye: "under your right eye",
  left_under_eye: "under your left eye",
  chin: "around your chin",
};

/** Returns a spoken location phrase for a concern's mask, or null if diffuse/none. */
export async function locateConcern(maskUrl: string): Promise<string | null> {
  try {
    const res = await fetch(maskUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const size = 64;
    const { data } = await sharp(buf)
      .ensureAlpha()
      .resize(size, size, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const alphaAt = (x: number, y: number) => data[(y * size + x) * 4 + 3];

    const scores: { key: string; val: number }[] = [];
    let total = 0;
    for (const r of REGIONS) {
      const [x0, y0, x1, y1] = r.box;
      let sum = 0;
      let cnt = 0;
      for (let y = Math.floor(y0 * size); y < Math.ceil(y1 * size); y++) {
        for (let x = Math.floor(x0 * size); x < Math.ceil(x1 * size); x++) {
          sum += alphaAt(x, y);
          cnt++;
        }
      }
      const val = cnt ? sum / cnt : 0;
      scores.push({ key: r.key, val });
      total += val;
    }

    if (total < 6) return null; // essentially nothing marked
    scores.sort((a, b) => b.val - a.val);
    const max = scores[0].val;
    if (max < 14) return null; // too faint / evenly diffuse to localize

    const top = scores.filter((s) => s.val >= max * 0.6).map((s) => s.key);
    if (top.includes("left_cheek") && top.includes("right_cheek")) return "on both cheeks";
    if (top.includes("left_under_eye") && top.includes("right_under_eye")) return "under both eyes";

    const phrases = top.slice(0, 2).map((k) => PHRASE[k]).filter(Boolean);
    if (phrases.length === 0) return null;
    if (phrases.length === 1) return phrases[0];
    return `${phrases[0]} and ${phrases[1]}`;
  } catch {
    return null;
  }
}
