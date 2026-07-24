/**
 * Parse a free-text garment ("black shirt", "white suit", "olive kurta") into a
 * structured item with a colour hex + category, so the dynamic wardrobe can
 * judge it against the user's palette and remember it.
 */

export type GarmentCategory = "top" | "bottom" | "full_body" | "hat" | "shoe" | "socks" | "accessory";

export interface ParsedGarment {
  name: string;
  colorName?: string;
  colorHex: string;
  category: GarmentCategory;
  occasions: string[];
}

const COLORS: Record<string, string> = {
  black: "#141414", white: "#f3f3f0", grey: "#9aa0a6", gray: "#9aa0a6", silver: "#c7c9cc",
  navy: "#2e3a59", blue: "#2f6fb0", "sky blue": "#7fb2e5", teal: "#2c7a73", cyan: "#2bb3c0",
  red: "#c0392b", maroon: "#6e1f2a", crimson: "#b21807", pink: "#e58fb0", rose: "#d46a8a",
  green: "#2f7a3f", olive: "#6b6b3a", emerald: "#0b8457", mint: "#7fd6a8", lime: "#8dbf5a",
  yellow: "#e8c33a", gold: "#d4af37", mustard: "#d6a419", orange: "#d98032", peach: "#ffb07c",
  coral: "#ff7f5c", rust: "#b7410e", brown: "#7a4b2b", tan: "#c9a063", camel: "#c9a063",
  beige: "#e8dcc0", cream: "#f3e9ce", ivory: "#fbf3e0", purple: "#7a4fb0", violet: "#8a5cc4",
  lavender: "#b7a9d9", mauve: "#9d7b93", burgundy: "#5a1a2b", "off white": "#efe9e0",
};

const TYPES: { words: string[]; category: GarmentCategory }[] = [
  { words: ["hat", "cap", "beanie", "fedora"], category: "hat" },
  { words: ["shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "heel", "heels", "loafer", "loafers", "sandal", "sandals"], category: "shoe" },
  { words: ["sock", "socks"], category: "socks" },
  { words: ["scarf", "tie", "belt", "bag", "watch", "necklace", "earring", "earrings", "bracelet", "ring", "glasses", "sunglasses", "gloves"], category: "accessory" },
  { words: ["dress", "gown", "frock", "suit", "jumpsuit", "saree", "sari", "abaya", "punjabi", "sherwani", "lehenga"], category: "full_body" },
  { words: ["pant", "pants", "trouser", "trousers", "jeans", "skirt", "shorts", "chinos", "leggings", "pajama", "pajamas"], category: "bottom" },
  { words: ["shirt", "tshirt", "t-shirt", "tee", "top", "blouse", "kurta", "kurti", "sweater", "jumper", "hoodie", "blazer", "jacket", "coat", "cardigan", "polo", "vest", "waistcoat", "tank"], category: "top" },
];

const OCCASION_HINTS: Record<string, string[]> = {
  blazer: ["office", "formal", "interview"], suit: ["office", "formal", "interview", "wedding"], coat: ["office", "formal"],
  shirt: ["office", "casual"], dress: ["party", "date", "formal"], gown: ["party", "formal", "wedding"],
  tee: ["casual"], tshirt: ["casual"], jeans: ["casual"], hoodie: ["casual"], kurta: ["casual", "festive"],
  punjabi: ["festive", "casual"], sherwani: ["wedding", "festive"], saree: ["festive", "party", "wedding"],
};

/** Parses "black shirt" → { name, colorHex, category, occasions }. Null if no garment type found. */
export function parseGarment(text: string): ParsedGarment | null {
  const s = text.toLowerCase().trim();
  if (!s) return null;

  let category: GarmentCategory | null = null;
  let typeWord = "";
  for (const t of TYPES) {
    const hit = t.words.find((w) => new RegExp(`\\b${w}\\b`).test(s));
    if (hit) {
      category = t.category;
      typeWord = hit;
      break;
    }
  }
  if (!category) return null;

  let colorName: string | undefined;
  let colorHex = "#8a8a8a";
  const colorKeys = Object.keys(COLORS).sort((a, b) => b.length - a.length);
  for (const c of colorKeys) {
    if (new RegExp(`\\b${c}\\b`).test(s)) {
      colorName = c;
      colorHex = COLORS[c];
      break;
    }
  }

  const occasions = OCCASION_HINTS[typeWord] ?? (category === "top" ? ["casual", "office"] : ["casual"]);
  const name = [colorName, typeWord].filter(Boolean).join(" ") || typeWord;
  return { name, colorName, colorHex, category, occasions };
}
