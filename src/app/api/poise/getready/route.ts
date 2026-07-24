import { garmentsForOccasion } from "@/lib/poise/wardrobe";
import { garmentVerdict, type ColorProfile } from "@/lib/poise/color";
import { deriveSkinDirective, skinFacePenalty, isFaceZone, type SkinConcern } from "@/lib/poise/skinStyle";
import { generateGetReady } from "@/lib/llm/groq";

/**
 * Agentic orchestration: "get me ready for <occasion>". Picks the best outfit
 * from the wardrobe for the occasion + the user's palette, MODULATED by today's
 * live skin state (steers face-zone colours away from what a flushed/dull/
 * shadowed complexion fights), then composes a warm spoken get-ready plan.
 * POST { occasion, profile, makeupTips, skin? (concern list) }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const occasion = String(body?.occasion ?? "today").toLowerCase();
    const makeupTips = body?.makeupTips === true || body?.makeupTips === "true";
    const profile = (body?.profile ?? null) as ColorProfile | null;
    const dir = deriveSkinDirective(body?.skin as SkinConcern[] | undefined);

    // Pick the best-suited garment: palette rating, then penalised by today's
    // skin state for anything worn near the face (zone-aware).
    const candidates = garmentsForOccasion(occasion);
    const rank = { great: 3, good: 2, poor: 1 } as const;
    let chosen = candidates[0];
    if (candidates.length) {
      chosen = candidates
        .map((g) => {
          const base = profile ? rank[garmentVerdict(profile, g.colorHex).rating] : 2;
          const penalty = dir && isFaceZone(g.category) ? skinFacePenalty(g.colorHex, dir) : 0;
          return { g, score: base - 2 * penalty };
        })
        .sort((a, b) => b.score - a.score)[0].g;
    }

    const summary = {
      occasion,
      season: profile?.season,
      undertone: profile?.undertone,
      metals: profile?.metals,
      chosenOutfit: chosen ? { name: chosen.name, color: chosen.colorHex } : undefined,
      makeupOn: makeupTips,
      skinNote: dir?.note,
      skinSteer: dir ? `Today's skin (${dir.reasons.join(", ")}) → favour ${dir.favor} near the face; the outfit was chosen with that in mind.` : undefined,
    };

    const spokenText = (await generateGetReady(summary)) ?? buildFallback(occasion, chosen?.name, profile, makeupTips, dir?.note);

    return Response.json({
      ok: true,
      spokenText,
      chosen: chosen ? { id: chosen.id, name: chosen.name, colorHex: chosen.colorHex } : null,
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

function buildFallback(
  occasion: string,
  outfit: string | undefined,
  profile: ColorProfile | null,
  makeupOn: boolean,
  skinNote?: string
): string {
  const parts = [`Let's get you ready for your ${occasion}.`];
  if (skinNote) parts.push(skinNote);
  if (outfit) {
    parts.push(
      profile
        ? `I'd go with the ${outfit} — it suits your ${profile.season} colouring, and ${profile.metals} jewellery finishes it.`
        : `I'd go with the ${outfit}.`
    );
  }
  if (makeupOn) parts.push("A little tinted lip balm would pull it together.");
  parts.push("You've got this — go and enjoy it.");
  return parts.join(" ");
}
