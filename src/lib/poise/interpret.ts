import type { SkinAnalysisResult, SkinConcernResult } from "@/lib/youcam/skin";

/**
 * Poise interpretation core (rule-based, zero-dependency, deterministic).
 *
 * Turns raw skin-analysis scores into a structured, honest "how do I look"
 * plan. An optional LLM polish layer (groq.ts) rephrases this for warmth, but
 * the `spokenDraft` here is always a complete, speakable fallback, so the
 * product never depends on a network call to say something useful.
 *
 * Reminder: every raw_score is 1–100 where HIGHER = healthier (LESS of the
 * concern). So a LOW redness score means MORE redness.
 */

export type Severity = "great" | "good" | "mild" | "moderate" | "significant";

export interface Finding {
  type: string; // raw concern token (e.g. "redness", "dark_circle_v2") — for mask lookup
  concern: string;
  score: number;
  severity: Severity;
  note: string; // spoken phrase, e.g. "a little redness across your cheeks"
  tip?: string; // gentle, optional actionable suggestion
  positive: boolean; // true = something to affirm
  weight: number; // daily relevance 0–3 (higher = more relevant to "how do I look now")
}

export interface FeedbackPlan {
  overallScore?: number;
  skinAge?: number;
  headline: string;
  positives: Finding[];
  concerns: Finding[];
  /** Every scored concern (for the LLM to generate from, and the UI). */
  allFindings: Finding[];
  /** Complete, ready-to-speak text assembled from the rules (LLM fallback). */
  spokenDraft: string;
}

/** Score → severity bucket (low score = more of the concern). */
function severityFor(score: number): Severity {
  if (score >= 85) return "great";
  if (score >= 75) return "good";
  if (score >= 65) return "mild";
  if (score >= 55) return "moderate";
  return "significant";
}

const INTENSITY: Record<Severity, string> = {
  great: "",
  good: "a hint of",
  mild: "a little",
  moderate: "some",
  significant: "noticeable",
};

/**
 * Per-concern language. `thing` describes the *negative* (low-score) reading;
 * `praise` affirms the positive (high-score) reading. `dailyWeight` ranks how
 * relevant a concern is to the everyday "am I presentable?" moment.
 */
interface ConcernMeta {
  label: string;
  thing: string; // negative reading
  praise: string; // positive reading
  tip?: string; // makeup-inclusive tip (used only when makeupTips is on)
  altTip?: string; // skincare/lifestyle tip (used when makeup is off)
  dailyWeight: number; // 0–3, higher = more relevant to "how do I look now"
}

const CATALOG: Record<string, ConcernMeta> = {
  redness: {
    label: "redness",
    thing: "redness on your skin",
    praise: "your skin looks calm and even",
    tip: "a green-tinted primer or a little moisturizer would calm it",
    altTip: "a gentle moisturizer can help calm it",
    dailyWeight: 3,
  },
  radiance: {
    label: "radiance",
    thing: "dullness that makes your skin look a bit tired",
    praise: "your skin looks bright and radiant",
    tip: "a splash of water and some moisturizer will freshen it up",
    altTip: "a splash of water and some moisturizer will freshen it up",
    dailyWeight: 3,
  },
  dark_circle_v2: {
    label: "dark circles",
    thing: "darkness under your eyes",
    praise: "your under-eyes look bright and rested",
    tip: "a dab of concealer under the eyes would even it out",
    altTip: "some rest and water tend to help them look brighter",
    dailyWeight: 3,
  },
  eye_bag: {
    label: "eye bags",
    thing: "puffiness under your eyes",
    praise: "your eyes look rested",
    tip: "a cool compress for a minute or two can help",
    altTip: "a cool compress for a minute or two can help",
    dailyWeight: 2,
  },
  oiliness: {
    label: "oiliness",
    thing: "shine on your skin",
    praise: "your skin looks balanced, not shiny",
    tip: "a quick blot or a little powder takes the shine down",
    altTip: "a quick blot with a tissue takes the shine down",
    dailyWeight: 2,
  },
  moisture: {
    label: "moisture",
    thing: "dryness",
    praise: "your skin looks well-hydrated",
    tip: "a bit of moisturizer would help it look supple",
    altTip: "a bit of moisturizer would help it look supple",
    dailyWeight: 2,
  },
  texture: {
    label: "texture",
    thing: "some unevenness in your skin's texture",
    praise: "your skin texture looks smooth",
    dailyWeight: 1,
  },
  acne: {
    label: "blemishes",
    thing: "a few blemishes",
    praise: "your skin looks clear",
    tip: "a touch of concealer on the spots, if you'd like",
    altTip: "keeping the area clean and not picking helps it settle",
    dailyWeight: 2,
  },
  age_spot: {
    label: "spots",
    thing: "some uneven pigmentation",
    praise: "your skin tone looks even",
    dailyWeight: 1,
  },
  firmness: {
    label: "firmness",
    thing: "a little less firmness",
    praise: "your skin looks firm",
    dailyWeight: 0,
  },
};

function noteFor(meta: ConcernMeta, severity: Severity): string {
  const intensity = INTENSITY[severity];
  return intensity ? `${intensity} ${meta.thing}` : meta.thing;
}

function buildHeadline(overall: number | undefined, concerns: Finding[]): string {
  const worst = concerns[0]?.severity;
  if (worst === "significant" || worst === "moderate") {
    return "You look good. There are a couple of things you might want to touch up.";
  }
  if (worst === "mild") {
    return "You look put-together. Just a couple of small things worth knowing.";
  }
  if (typeof overall === "number" && overall >= 80) {
    return "You look great and ready to go.";
  }
  return "You look put-together and ready to go.";
}

export function interpretSkin(
  result: SkinAnalysisResult,
  opts: { makeupTips?: boolean } = {}
): FeedbackPlan {
  // Default OFF: no one gets makeup suggestions unless they opt in.
  const makeupTips = opts.makeupTips ?? false;
  const findings: Finding[] = [];

  for (const c of result.concerns) {
    const meta = CATALOG[c.type];
    if (!meta || typeof c.raw_score !== "number") continue;
    const severity = severityFor(c.raw_score);
    const positive = severity === "great" || severity === "good";
    findings.push({
      type: c.type,
      concern: meta.label,
      score: Math.round(c.raw_score),
      severity,
      note: positive ? meta.praise : noteFor(meta, severity),
      tip: positive ? undefined : makeupTips ? meta.tip : meta.altTip,
      positive,
      weight: meta.dailyWeight,
    });
  }

  // Concerns worth flagging: not positive, ranked by severity then relevance.
  const sevRank: Record<Severity, number> = {
    significant: 4,
    moderate: 3,
    mild: 2,
    good: 1,
    great: 0,
  };
  const concerns = findings
    .filter((f) => !f.positive && f.weight >= 1)
    .sort((a, b) => sevRank[b.severity] - sevRank[a.severity] || b.weight - a.weight)
    .slice(0, 3);

  // Positives worth affirming: best scores among daily-relevant concerns.
  const positives = findings
    .filter((f) => f.positive && f.weight >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  const headline = buildHeadline(result.all, concerns);

  // Assemble the spoken fallback.
  const parts: string[] = [headline];
  if (positives.length) {
    parts.push(capitalize(joinNatural(positives.map((p) => p.note))) + ".");
  }
  if (concerns.length) {
    const noteText = joinNatural(concerns.map((c) => c.note));
    parts.push(`I can see ${noteText}.`);
    const tips = concerns.map((c) => c.tip).filter(Boolean) as string[];
    if (tips.length) parts.push(capitalize(tips[0]) + ".");
  } else {
    parts.push("Nothing stands out that you'd want to fix.");
  }

  return {
    overallScore: result.all,
    skinAge: result.skin_age,
    headline,
    positives,
    concerns,
    allFindings: findings,
    spokenDraft: parts.join(" "),
  };
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Re-export for convenience
export type { SkinConcernResult };
