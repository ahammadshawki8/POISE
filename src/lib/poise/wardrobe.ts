/**
 * Curated garment catalog (the demo "wardrobe"). Each item has a dominant colour
 * (for the deterministic palette match), category + occasion tags (for the agent),
 * and a reference image URL passed straight to the cloth-v3 VTO as ref_file_url.
 */

export type GarmentCategory = "upper_body" | "lower_body" | "full_body";

export interface Garment {
  id: string;
  name: string;
  colorHex: string;
  category: GarmentCategory;
  occasions: string[]; // e.g. "casual", "office", "date", "party", "formal"
  imageUrl: string; // ref garment image for VTO
}

export const CATALOG: Garment[] = [
  {
    id: "white-shirt",
    name: "white shirt",
    colorHex: "#f3f3f0",
    category: "upper_body",
    occasions: ["office", "formal", "casual"],
    imageUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=800&q=80&fm=jpg",
  },
  {
    id: "navy-blazer",
    name: "navy blazer",
    colorHex: "#2e3a59",
    category: "upper_body",
    occasions: ["office", "formal", "interview"],
    imageUrl: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&q=80&fm=jpg",
  },
  {
    id: "olive-shirt",
    name: "olive shirt",
    colorHex: "#6b6b3a",
    category: "upper_body",
    occasions: ["casual", "date"],
    imageUrl: "https://images.unsplash.com/photo-1603252109303-2751441dd157?w=800&q=80&fm=jpg",
  },
  {
    id: "rust-sweater",
    name: "rust sweater",
    colorHex: "#b7410e",
    category: "upper_body",
    occasions: ["casual", "date"],
    imageUrl: "https://images.unsplash.com/photo-1608744882201-52a7f7f3dd60?w=800&q=80&fm=jpg",
  },
  {
    id: "emerald-blouse",
    name: "emerald blouse",
    colorHex: "#0b8457",
    category: "upper_body",
    occasions: ["party", "date", "office"],
    imageUrl: "https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=800&q=80&fm=jpg",
  },
  {
    id: "red-top",
    name: "red top",
    colorHex: "#c0392b",
    category: "upper_body",
    occasions: ["date", "party"],
    imageUrl: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=800&q=80&fm=jpg",
  },
  {
    id: "camel-coat",
    name: "camel coat",
    colorHex: "#c9a063",
    category: "full_body",
    occasions: ["office", "formal"],
    imageUrl: "https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=800&q=80&fm=jpg",
  },
  {
    id: "grey-tee",
    name: "grey tee",
    colorHex: "#9aa0a6",
    category: "upper_body",
    occasions: ["casual"],
    imageUrl: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80&fm=jpg",
  },
  {
    id: "black-dress",
    name: "black dress",
    colorHex: "#141414",
    category: "full_body",
    occasions: ["party", "date", "formal"],
    imageUrl: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=800&q=80&fm=jpg",
  },
  {
    id: "lavender-top",
    name: "lavender top",
    colorHex: "#b7a9d9",
    category: "upper_body",
    occasions: ["casual", "date", "office"],
    imageUrl: "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=800&q=80&fm=jpg",
  },
];

export function findGarment(query: string): Garment | null {
  const q = query.toLowerCase();
  // exact-ish name match first, then any word overlap on colour/name.
  let best: Garment | null = null;
  let bestScore = 0;
  for (const g of CATALOG) {
    const words = g.name.split(" ");
    let score = 0;
    if (q.includes(g.name)) score += 10;
    for (const w of words) if (q.includes(w)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return bestScore >= 3 ? best : null;
}

export function garmentsForOccasion(occasion: string): Garment[] {
  const o = occasion.toLowerCase();
  const matched = CATALOG.filter((g) => g.occasions.some((oc) => o.includes(oc) || oc.includes(o)));
  return matched.length ? matched : CATALOG;
}
