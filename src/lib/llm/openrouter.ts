import type { OutfitResult } from "./groq";

/**
 * OpenRouter vision — free, OpenAI-compatible, with fallback across several
 * free vision models. This is Poise's only outfit-recognition provider.
 * Needs a free OpenRouter key in OPENROUTER_KEY (OPENROUTER_API_KEY also accepted).
 */

const URL = "https://openrouter.ai/api/v1/chat/completions";
// Free, image-capable models available on OpenRouter (verified 2026-07 against
// /api/v1/models). Slugs churn often — set OPENROUTER_VISION_MODEL to override.
const MODELS = [
  process.env.OPENROUTER_VISION_MODEL,
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
].filter(Boolean) as string[];

const PROMPT = `Look at this photo and describe ONLY the clothing/outfit the person is wearing — not their face, body, or identity.
Reply with ONLY JSON (no markdown):
{"description":"a warm one-sentence description of the outfit for a blind person","items":[{"name":"e.g. black shirt","color":"black","category":"top|bottom|full_body|hat|shoe|accessory"}]}
Include only clearly visible clothing. If none, use an empty items array.`;

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function describeOutfitOpenRouter(imageBase64: string, mime = "image/jpeg"): Promise<OutfitResult | null> {
  const apiKey = process.env.OPENROUTER_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const dataUrl = `data:${mime};base64,${imageBase64}`;
  for (const model of MODELS) {
    try {
      const res = await fetch(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://poise.local",
          "X-Title": "Poise",
        },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 400,
          messages: [{ role: "user", content: [{ type: "text", text: PROMPT }, { type: "image_url", image_url: { url: dataUrl } }] }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        console.error(`[openrouter] ${model} HTTP ${res.status}`, (await res.text()).slice(0, 200));
        continue;
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (!text) continue;
      const parsed = extractJson(text) as { description?: string; items?: unknown } | null;
      if (!parsed) continue;
      return { description: String(parsed.description ?? "").trim(), items: Array.isArray(parsed.items) ? (parsed.items as OutfitResult["items"]).slice(0, 6) : [] };
    } catch {
      /* try next model */
    }
  }
  return null;
}
