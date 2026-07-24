import { interpretSkin } from "@/lib/poise/interpret";
import type { SkinAnalysisResult } from "@/lib/youcam/skin";

/**
 * Offline diagnostic (NO API units): runs the rule-based interpreter on a mock
 * analysis so we can inspect the fallback spokenDraft and tune thresholds.
 * GET /api/poise/interpret-test?scenario=tired
 */
export async function GET(request: Request) {
  const scenario = new URL(request.url).searchParams.get("scenario") ?? "mixed";

  const scenarios: Record<string, Record<string, number>> = {
    great: { redness: 95, radiance: 90, dark_circle_v2: 92, eye_bag: 90, oiliness: 95, moisture: 88, texture: 90, acne: 92, age_spot: 94, firmness: 90 },
    tired: { redness: 88, radiance: 60, dark_circle_v2: 52, eye_bag: 58, oiliness: 90, moisture: 70, texture: 80, acne: 88, age_spot: 90, firmness: 85 },
    irritated: { redness: 48, radiance: 72, dark_circle_v2: 80, eye_bag: 82, oiliness: 62, moisture: 55, texture: 65, acne: 70, age_spot: 88, firmness: 84 },
    mixed: { redness: 95, radiance: 74, dark_circle_v2: 88, eye_bag: 85, oiliness: 97, moisture: 62, texture: 77, acne: 87, age_spot: 94, firmness: 92 },
  };

  const scores = scenarios[scenario] ?? scenarios.mixed;
  const mock: SkinAnalysisResult = {
    concerns: Object.entries(scores).map(([type, raw_score]) => ({ type, raw_score, ui_score: Math.round(raw_score) })),
    all: 80,
    skin_age: 25,
    raw: null,
  };

  const plan = interpretSkin(mock);
  return Response.json({ scenario, spokenDraft: plan.spokenDraft, headline: plan.headline, plan });
}
