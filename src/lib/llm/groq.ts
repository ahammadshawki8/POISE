import type { FeedbackPlan } from "@/lib/poise/interpret";

/**
 * Feedback generation via Groq. The model receives the ACTUAL skin metrics
 * (per-concern 0–100 scores, direction, and relevance) and composes the spoken
 * message from them — it is a generator, not a paraphraser. The rule-based
 * layer supplies guardrails (severity, safe optional tips) and, if Groq is
 * unavailable, the `spokenDraft` fallback. Only numbers are sent — never the photo.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are Poise, a warm, honest getting-ready companion. You speak ALOUD to a person who is blind or has low vision, telling them how they look right now, just before they head out.

You are given OBJECTIVE skin metrics from a real facial analysis. Each concern is scored 0–100 where HIGHER = HEALTHIER — i.e. LESS of that concern. A high "redness" score means calm, clear skin; a LOW score means MORE redness. "relevance" (0–3) is how much a concern affects everyday appearance.

Generate the spoken message FROM these numbers:
- 2–3 short spoken sentences. No lists, no markdown, no headings.
- Lead with one or two of the strongest, most relevant areas (highest scores) as genuine positives.
- Then gently mention the one or two weakest, most relevant areas (lowest scores). Small dips are small — never alarm.
- You may combine related low scores into a natural observation (e.g. dark circles + dullness → "you look a little tired").
- If a concern you mention includes a "location" (where on the face it is), weave it in naturally — this is especially valuable for a user who cannot see (e.g. "a little redness on your right cheek and around your nose").
- Optionally end with ONE gentle, general tip. You may use a provided optional tip. NEVER give medical advice.
- Only talk about concerns present in the data. Do NOT invent anything. Respect the "higher = healthier" direction exactly.
- If a previousOverallScore is given and today's overall is clearly higher or lower (by 3+), you may warmly mention the change in one short clause (e.g. "and your skin's looking brighter than last time"). Otherwise ignore it. Never fabricate a trend.
- Warm and natural, like a trusted friend who is honest. Never clinical, never pitying.
- Output ONLY the words to be spoken.`;

export interface PolishResult {
  text: string;
  source: "groq" | "fallback";
}

const PROGRESS_SYSTEM = `You are Poise, a warm skin companion, speaking ALOUD to a blind or low-vision user about how their skin has changed across their check-ins over time.

You are given trend data. Scores are 0-100 where HIGHER = HEALTHIER. Positive "change" = improvement.

- 2-4 short spoken sentences. No lists or markdown.
- Lead with the overall direction (improving / holding steady / slipping a little).
- Call out the 1-2 concerns that improved most, and gently note anything that slipped.
- Warm, encouraging, honest. If it's improving, celebrate it. Output ONLY the words to be spoken.`;

const COLOR_SYSTEM = `You are Poise, a warm styling companion, speaking ALOUD to a blind or low-vision user about their personal colour analysis.

You are given their measured colouring and computed colour "season" + flattering palette.
- 2-3 short spoken sentences. No lists or markdown.
- Tell them their season and undertone, name 3-4 flattering colours from the palette, say which metal jewellery suits them, and one thing to go easy on.
- Warm, encouraging, natural — this is a delightful reveal. Output ONLY the words to be spoken.`;

/** Generates a spoken personal-colour-analysis description. */
export async function generateColorText(profile: unknown): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          { role: "system", content: COLOR_SYSTEM },
          { role: "user", content: `Here is the colour analysis. Speak Poise's reveal:\n\n${JSON.stringify(profile, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// Shared shape for outfit-vision results (produced by the OpenRouter vision layer).
export interface OutfitResult {
  description: string;
  items: { name: string; color?: string; category?: string }[];
}

const STYLE_SYSTEM = `You are Poise, a warm fashion companion speaking ALOUD to a blind or low-vision user.

You are given their colour season/undertone, the live weather + air quality where they are, TODAY'S skin state, and EITHER a specific garment they asked about, OR their remembered wardrobe for an occasion.

- 2-4 short spoken sentences. No lists or markdown.
- If a specific garment is given: say honestly how it suits their colouring (use the provided verdict rating), whether it fits the occasion, and whether it's practical for today's weather.
- If fromWardrobe is true and a garmentDescription is given, this is a REAL garment they already own and are now seeing on themselves — describe THAT exact garment using its description (its actual look/details), warmly, as "your <garment>", then give the verdict. Don't talk about it as hypothetical.
- If recommending for an occasion: name the best item (or the suggested colour if the wardrobe is empty) + their colours + the weather, and say why.
- SKIN STATE (the special sauce): if a skinNote / skinSteer is given, briefly mention how their skin looks TODAY and let it shape the colour advice near the face — e.g. when skin looks flushed, keep warm reds and oranges off the face and lean cool; when dull, favour clearer brighter shades; when shadowed under the eyes, keep sallow yellows/olives away from the face. Make this feel like genuine, caring insight, not a disclaimer. Lower-body colours are not constrained by skin.
- Weave in the weather sensibly: warm → light and breathable; cold → layers; rain/drizzle → water-friendly; high UV → sun protection; poor air quality → maybe a light scarf.
- Warm, natural, encouraging. Output ONLY the words to be spoken.`;

export async function generateStyleAdvice(summary: unknown): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 240,
        messages: [
          { role: "system", content: STYLE_SYSTEM },
          { role: "user", content: `Here's the context. Speak Poise's styling advice:\n\n${JSON.stringify(summary, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

const GETREADY_SYSTEM = `You are Poise, a warm, agentic get-ready companion, speaking ALOUD to a blind or low-vision user who is getting ready for an occasion.

You are given the occasion, their colour profile, a chosen outfit (already picked to suit them AND their skin today), whether they use makeup, and today's skin note + skin steer. Compose ONE warm spoken "get ready" plan:
- 3-4 short spoken sentences. No lists or markdown.
- Briefly acknowledge the occasion. If a skinNote/skinSteer is given, mention how their skin looks today and connect it to the outfit's colour — e.g. "your skin's a little flushed today, so I've kept the warm reds off your face and picked the cool emerald, which will actually calm the redness." This skin-aware reasoning is the highlight — make it feel insightful and caring.
- Recommend the chosen outfit and why it suits their colouring; add a makeup touch ONLY if makeup is on; end with a confident, encouraging sign-off.
- Warm, natural, like a friend helping you out the door. Output ONLY the words to be spoken.`;

/** Generates the spoken "get me ready" orchestration plan. */
export async function generateGetReady(summary: unknown): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 260,
        messages: [
          { role: "system", content: GETREADY_SYSTEM },
          { role: "user", content: `Get me ready. Here's the context:\n\n${JSON.stringify(summary, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Generates a spoken longitudinal progress report from computed trend data. */
export async function generateProgress(summary: unknown): Promise<string | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 240,
        messages: [
          { role: "system", content: PROGRESS_SYSTEM },
          { role: "user", content: `Here is the skin trend data. Speak Poise's progress report:\n\n${JSON.stringify(summary, null, 2)}` },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function generateFeedback(
  plan: FeedbackPlan,
  opts: {
    makeupTips?: boolean;
    previousOverall?: number;
    /** concern label -> where on the face it is (e.g. "your right cheek") */
    locations?: Record<string, string>;
  } = {}
): Promise<PolishResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { text: plan.spokenDraft, source: "fallback" };

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;

  const makeupRule =
    opts.makeupTips === true
      ? "Makeup suggestions are acceptable if genuinely helpful."
      : "This person does NOT use makeup. Never suggest makeup (concealer, primer, powder, foundation). Offer only skincare or lifestyle tips, or no tip.";

  const locations = opts.locations ?? {};
  const metrics = plan.allFindings
    .map((f) => ({
      concern: f.concern,
      score: f.score, // 0-100, higher = healthier
      reading: f.severity,
      relevance: f.weight,
      location: locations[f.concern], // where on the face, if known
    }))
    .sort((a, b) => b.relevance - a.relevance);

  const userContent = JSON.stringify(
    {
      overallScore: plan.overallScore,
      previousOverallScore: opts.previousOverall,
      skinAge: plan.skinAge,
      scoreDirection: "0-100, HIGHER means healthier / less of the concern",
      metrics,
      optionalTips: plan.concerns.map((c) => c.tip).filter(Boolean),
    },
    null,
    2
  );

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: 220,
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${makeupRule}` },
          {
            role: "user",
            content: `Here are the skin metrics from the analysis. Speak Poise's message, generated from these numbers:\n\n${userContent}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) return { text: plan.spokenDraft, source: "fallback" };
    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) return { text: plan.spokenDraft, source: "fallback" };
    return { text, source: "groq" };
  } catch {
    return { text: plan.spokenDraft, source: "fallback" };
  }
}
