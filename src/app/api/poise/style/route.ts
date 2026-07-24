import { parseGarment } from "@/lib/poise/garments";
import { garmentVerdict, type ColorProfile } from "@/lib/poise/color";
import { deriveSkinDirective, skinFacePenalty, isFaceZone, type SkinConcern } from "@/lib/poise/skinStyle";
import { generateStyleAdvice } from "@/lib/llm/groq";

/**
 * Dynamic styling advice.
 *  mode "describe": "how would I look in a black shirt" → verdict vs palette +
 *    occasion + weather.
 *  mode "recommend": "what should I wear for a date" → pick from the user's
 *    remembered wardrobe, weighted by palette + occasion + weather.
 * POST { mode, garment?, occasion?, profile?, wardrobe?, weather? }
 */

interface WardrobeItem {
  name: string;
  colorHex: string;
  category?: string;
  occasions?: string[];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mode = body?.mode === "recommend" ? "recommend" : "describe";
    const occasion = String(body?.occasion ?? "").toLowerCase();
    const profile = (body?.profile ?? null) as ColorProfile | null;
    const weather = body?.weather ?? null;
    const wardrobe = (Array.isArray(body?.wardrobe) ? body.wardrobe : []) as WardrobeItem[];
    const dir = deriveSkinDirective(body?.skin as SkinConcern[] | undefined);

    if (mode === "describe") {
      const parsed = parseGarment(String(body?.garment ?? ""));
      if (!parsed) return Response.json({ ok: false, error: "no garment recognized" });
      const verdict = profile ? garmentVerdict(profile, parsed.colorHex) : null;
      // How today's skin argues about THIS colour (only near the face).
      const skinPenalty = dir && isFaceZone(parsed.category) ? skinFacePenalty(parsed.colorHex, dir) : 0;
      const summary = {
        mode: "describe",
        garment: parsed.name,
        garmentColour: parsed.colorName,
        verdict: verdict ? { rating: verdict.rating, note: verdict.note } : undefined,
        season: profile?.season,
        undertone: profile?.undertone,
        metals: profile?.metals,
        occasion: occasion || undefined,
        weather: weather || undefined,
        skinNote: dir?.note,
        skinSteer: dir && isFaceZone(parsed.category)
          ? skinPenalty >= 0.5
            ? `Today their skin is ${dir.reasons.join(", ")}; this colour is one to keep OFF the face today. Suggest wearing it lower down, or favour ${dir.favor} up top.`
            : `Their skin is ${dir.reasons.join(", ")} today, and this colour sits fine with that.`
          : undefined,
      };
      const spokenText = (await generateStyleAdvice(summary)) ?? describeFallback(parsed.name, verdict?.rating, occasion, weather);
      return Response.json({ ok: true, spokenText, garment: parsed });
    }

    // recommend — palette rating, penalised by today's skin for face-zone items.
    const rank = { great: 3, good: 2, poor: 1 } as const;
    let pool = wardrobe.filter((g) => !occasion || (g.occasions ?? []).some((o) => occasion.includes(o) || o.includes(occasion)));
    if (!pool.length) pool = wardrobe;
    let chosen: WardrobeItem | null = null;
    if (pool.length) {
      chosen = pool
        .map((g) => {
          const base = profile ? rank[garmentVerdict(profile, g.colorHex).rating] : 2;
          const penalty = dir && isFaceZone(g.category) ? skinFacePenalty(g.colorHex, dir) : 0;
          return { g, score: base - 2 * penalty };
        })
        .sort((a, b) => b.score - a.score)[0].g;
    }
    // Empty wardrobe → suggest a palette colour, steered by today's skin.
    let suggestedColour: string | undefined;
    if (!chosen && profile?.palette?.length) {
      suggestedColour = dir
        ? [...profile.palette].sort((a, b) => skinFacePenalty(a.hex, dir) - skinFacePenalty(b.hex, dir))[0].name
        : profile.palette[0].name;
    }
    const summary = {
      mode: "recommend",
      occasion: occasion || "today",
      chosen: chosen ? chosen.name : undefined,
      suggestedColour,
      wardrobe: wardrobe.map((g) => g.name),
      season: profile?.season,
      undertone: profile?.undertone,
      weather: weather || undefined,
      skinNote: dir?.note,
      skinSteer: dir ? `Today's skin (${dir.reasons.join(", ")}) → favour ${dir.favor} near the face; the pick reflects that.` : undefined,
    };
    const spokenText = (await generateStyleAdvice(summary)) ?? recommendFallback(occasion, chosen?.name ?? suggestedColour, profile, weather);
    return Response.json({ ok: true, spokenText, chosen });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

function weatherClause(w: any): string {
  if (!w?.tempC) return "";
  if (/rain|drizzle|shower|thunder/.test(w.condition)) return ` It's ${w.condition} out, so something water-friendly helps.`;
  if (w.tempC >= 28) return ` It's warm at ${w.tempC} degrees, so keep it light and breathable.`;
  if (w.tempC <= 12) return ` It's cool at ${w.tempC} degrees, so layer up.`;
  return "";
}

function describeFallback(name: string, rating: string | undefined, occasion: string, w: any): string {
  const lead = rating === "great" ? "Lovely choice." : rating === "poor" ? "Honestly, not your best." : "That works.";
  const occ = occasion ? ` It's fine for a ${occasion}.` : "";
  return `The ${name}? ${lead}${occ}${weatherClause(w)}`;
}
function recommendFallback(occasion: string, chosen: string | undefined, profile: ColorProfile | null, w: any): string {
  if (chosen) return `For your ${occasion || "day"}, I'd wear the ${chosen}.${weatherClause(w)}`;
  const c = profile?.palette?.[0]?.name;
  return `Your wardrobe's empty, but with your colouring, something in ${c ?? "a flattering shade"} would suit.${weatherClause(w)}`;
}
