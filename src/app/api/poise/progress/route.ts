import { generateProgress } from "@/lib/llm/groq";

/**
 * Longitudinal progress report. The client sends its stored history (per-concern
 * scores over time); we compute trends and generate a spoken summary.
 * POST { history: { t, overall, scores }[] } -> { ok, spokenText }
 */

const LABELS: Record<string, string> = {
  redness: "redness",
  radiance: "radiance",
  dark_circle_v2: "dark circles",
  eye_bag: "eye bags",
  oiliness: "oiliness",
  moisture: "hydration",
  texture: "texture",
  acne: "blemishes",
  age_spot: "even tone",
  firmness: "firmness",
};

interface Entry {
  t: number;
  overall?: number;
  scores?: Record<string, number>;
}

export async function POST(request: Request) {
  try {
    const { history } = await request.json();
    if (!Array.isArray(history) || history.length < 2) {
      return Response.json({ ok: false, error: "not enough history" });
    }

    const entries = history as Entry[];
    const first = entries[0];
    const last = entries[entries.length - 1];

    const keys = Object.keys(last.scores ?? {});
    const concernChanges = keys
      .map((k) => {
        const from = first.scores?.[k];
        const to = last.scores?.[k];
        if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
        return { concern: LABELS[k] ?? k, from: Math.round(from!), to: Math.round(to!), change: Math.round(to! - from!) };
      })
      .filter(Boolean);

    const summary = {
      sessions: entries.length,
      spanDays: Math.max(0, Math.round((last.t - first.t) / 86_400_000)),
      overallChange:
        Number.isFinite(last.overall) && Number.isFinite(first.overall)
          ? Math.round((last.overall as number) - (first.overall as number))
          : undefined,
      note: "change is positive when the concern improved (higher = healthier)",
      concernChanges,
    };

    const text = (await generateProgress(summary)) ?? buildFallback(summary);
    return Response.json({ ok: true, spokenText: text });
  } catch {
    return Response.json({ ok: false, error: "progress failed" }, { status: 200 });
  }
}

function buildFallback(s: {
  sessions: number;
  overallChange?: number;
  concernChanges: ({ concern: string; change: number } | null)[];
}): string {
  const dir =
    typeof s.overallChange === "number"
      ? s.overallChange >= 3
        ? "improving nicely"
        : s.overallChange <= -3
          ? "slipping a little"
          : "holding fairly steady"
      : "holding fairly steady";
  const changes = s.concernChanges.filter(Boolean) as { concern: string; change: number }[];
  const up = changes.filter((c) => c.change >= 3).sort((a, b) => b.change - a.change)[0];
  const down = changes.filter((c) => c.change <= -3).sort((a, b) => a.change - b.change)[0];
  const parts = [`Over your last ${s.sessions} check-ins, your skin is ${dir}.`];
  if (up) parts.push(`Your ${up.concern} has improved the most.`);
  if (down) parts.push(`Your ${down.concern} has slipped a little — worth keeping an eye on.`);
  if (!up && !down) parts.push("Nothing has changed much either way.");
  return parts.join(" ");
}
