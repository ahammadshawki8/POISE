/**
 * Voice-intent agent. Maps any spoken paraphrase to ONE Poise action + an
 * optional slot (garment for try-on, occasion for get-ready, page for navigate).
 * Fast Groq model with strict JSON; local regex fallback so voice works offline.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_INTENT_MODEL || "llama-3.1-8b-instant";

export const INTENTS = [
  "analyze",
  "demo",
  "color",
  "progress",
  "tryon",
  "garment_query",
  "add_garment",
  "changed_clothes",
  "recommend",
  "getready",
  "wardrobe",
  "delete_profile",
  "navigate",
  "repeat",
  "makeup_on",
  "makeup_off",
  "camera_on",
  "camera_off",
  "voice_male",
  "voice_female",
  "switch_profile",
  "mute",
  "unmute",
  "none",
] as const;
export type Intent = (typeof INTENTS)[number];

export interface IntentResult {
  intent: Intent;
  slot: string;
}

/**
 * Guard against the small model inventing an occasion the user never said (it
 * tends to copy an example). For occasion intents, only keep a slot whose words
 * actually appear in what was spoken; otherwise clear it so the app asks.
 */
function groundOccasion(transcript: string, intent: Intent, slot: string): string {
  if (intent !== "recommend" && intent !== "getready") return slot;
  if (!slot) return slot;
  const t = transcript.toLowerCase();
  const words = slot.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return "";
  return words.some((w) => t.includes(w)) ? slot : "";
}

const SYSTEM = `You map a short spoken phrase to ONE intent for "Poise", a voice app that looks at the user's face/body and helps them get ready — it analyses skin, tells them their colour season, tries clothes on, and coordinates a full look.

Intents:
- analyze: how do I look right now / check my skin or face / am I presentable.
- color: what are my colours / colour season / undertone / which colours suit me.
- tryon: try on one of the READY-MADE wardrobe items (navy blazer, olive shirt, red top, emerald blouse, rust sweater, camel coat, grey tee, black dress, lavender top, white shirt). slot = that garment.
- garment_query: the user asks how they'd look in a garment they DESCRIBE (any colour + type). slot = the garment (e.g. "black shirt", "white suit", "olive kurta"). Examples: "how would I look in a black shirt", "would a red dress suit me", "how about a green kurta".
- add_garment: the user says they OWN or bought a garment to remember. slot = the garment. Examples: "I have a black shirt", "add a navy blazer to my wardrobe", "I just bought white sneakers".
- changed_clothes: the user changed their outfit and wants it described / remembered. slot = the garment if they named it, otherwise empty. Examples: "I changed my clothes", "I'm wearing a black shirt now", "what am I wearing", "check my outfit".
- recommend: the user asks what to wear for an occasion, to be picked from THEIR wardrobe. slot = the occasion ONLY if they state one, otherwise EMPTY. Examples: "what should I wear" (slot ""), "what should I wear to the office" (slot "office"), "suggest an outfit for a date" (slot "date").
- getready: get me ready for an occasion / help me get dressed for something. slot = the occasion ONLY if they state one, otherwise EMPTY. Examples: "get me ready" (slot ""), "get me ready for a party" (slot "party").

CRITICAL for recommend + getready: if the user does NOT actually name an occasion, the slot MUST be an empty string. NEVER invent, guess, or copy an occasion from the examples above — only use words the user actually said.
- wardrobe: show my wardrobe / what can I wear / what clothes are there.
- progress: how has my skin been over time / am I improving.
- demo: the user wants a demo / walkthrough / guided tour / to learn how to use the app. Examples: "give me a demo", "how does this work", "show me around", "walk me through it".
- navigate: go to a page/section. slot = destination: "home", "skin", "colour", "style", "wardrobe", "profile", "get ready", "history", "next", or "back".
- repeat: say the last thing again.
- makeup_on / makeup_off: turn makeup tips on/off.
- camera_on / camera_off: turn the camera on/off.
- voice_male / voice_female: switch to a male / female voice.
- switch_profile: switch account / switch profile / sign out / log out / change user / it's a different person.
- delete_profile: delete a profile / account. slot = the name if given. Examples: "delete my profile", "delete this account", "remove my profile".
- mute / unmute: stop / resume speaking.
- none: anything unrelated or unclear.

Reply with ONLY JSON: {"intent":"<intent>","slot":"<detail or empty string>"}.`;

function localFallback(transcript: string): IntentResult {
  const s = transcript.toLowerCase();
  const R = (intent: Intent, slot = ""): IntentResult => ({ intent, slot });

  let mm: RegExpMatchArray | null;
  if ((mm = s.match(/how (?:would|do|will|might) i look in (?:a |an |the )?(.+)/))) return R("garment_query", mm[1].trim());
  if ((mm = s.match(/would (?:a |an |the )?(.+?) (?:suit|look good on) me/))) return R("garment_query", mm[1].trim());
  const garmentWord = /\b(shirt|dress|top|suit|kurta|kurti|jacket|blazer|coat|jeans|pant|pants|trouser|trousers|skirt|shorts|sweater|hoodie|tee|t-shirt|blouse|punjabi|sherwani|saree|sari|shoe|shoes|sneaker|boots?|hat|cap|scarf|socks?)\b/;
  if (/(?:i have|i own|i just bought|i bought|add)\b/.test(s) && garmentWord.test(s)) {
    mm = s.match(/(?:i have|i own|i just bought|i bought|add)\s+(?:a |an |the )?(.+?)(?:\s+to (?:my )?wardrobe)?$/);
    return R("add_garment", mm ? mm[1].trim() : "");
  }
  if (/changed (?:my )?(?:clothes|outfit)|what am i wearing|check my (?:outfit|clothes)/.test(s)) return R("changed_clothes", "");
  if ((mm = s.match(/i'?m (?:now )?wearing (?:a |an |the )?(.+)/))) return R("changed_clothes", mm[1].trim());
  if (/what (?:should|do) i wear|what to wear|suggest an outfit|help me (?:pick|choose)/.test(s)) {
    mm = s.match(/(?:to|for)\s+(?:a |an |my )?(.+)/);
    return R("recommend", mm ? mm[1].trim() : "");
  }
  if (/delete (?:my |this |the )?(?:profile|account)|remove (?:my )?profile/.test(s)) return R("delete_profile", "");

  const trym = s.match(/try(?:\s+on)?\s+(?:the\s+|a\s+|my\s+)?(.+)/);
  if (trym && /try/.test(s)) return R("tryon", trym[1].trim());
  const ready = s.match(/(?:get me ready|ready|dressed|get ready)\s+(?:for\s+)?(?:a\s+|an\s+|my\s+)?(.+)/);
  if (/get me ready|getting ready|help me (get )?dress|i have (a|an)/.test(s))
    return R("getready", ready ? ready[1].trim() : "");
  if (/wardrobe|what can i wear|what clothes|my clothes|outfits/.test(s)) return R("wardrobe");
  if (/\bcolou?r|undertone|what season|my season|what suits me/.test(s)) return R("color");
  if (/how am i doing|how has my skin|am i improving|my progress|over time/.test(s)) return R("progress");
  if (/\b(demo|walk ?through|show me around|how does (this|it) work|tour)\b/.test(s)) return R("demo");
  if (/(go|take me|open|show)\s+(to\s+)?(home|skin|colou?r|wardrobe|clothes|style|profile|get ready|history)/.test(s)) {
    const m = s.match(/(home|skin|colou?r|wardrobe|clothes|style|profile|get ready|history)/);
    return R("navigate", m ? m[1] : "");
  }
  if (/\bnext\b|continue/.test(s)) return R("navigate", "next");
  if (/\bback\b|previous|go back/.test(s)) return R("navigate", "back");
  if (/how (do|does) i look|do i look|am i (ready|presentable)|check me|scan|look ok/.test(s)) return R("analyze");
  if (/again|repeat|what did you say|one more time/.test(s)) return R("repeat");
  if (/makeup.*(on|yes)|turn on makeup|wear makeup/.test(s)) return R("makeup_on");
  if (/makeup.*(off|no)|don'?t wear makeup|no makeup/.test(s)) return R("makeup_off");
  if (/camera.*(on|start)|start (the )?camera/.test(s)) return R("camera_on");
  if (/camera.*(off|stop)|stop (the )?camera/.test(s)) return R("camera_off");
  if (/male voice|man'?s voice/.test(s)) return R("voice_male");
  if (/female voice|woman'?s voice/.test(s)) return R("voice_female");
  if (/switch (account|profile|user)|sign out|log out|change (profile|account|user)|different (person|user|profile)|not me/.test(s)) return R("switch_profile");
  if (/mute|be quiet|stop talking/.test(s)) return R("mute");
  if (/unmute|speak (again|up)|voice on/.test(s)) return R("unmute");
  return R("none");
}

export async function classifyIntent(transcript: string): Promise<IntentResult> {
  const text = transcript.trim();
  if (!text) return { intent: "none", slot: "" };
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return localFallback(text);

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 40,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return localFallback(text);
    const json = await res.json();
    const parsed = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}");
    if ((INTENTS as readonly string[]).includes(parsed?.intent)) {
      const intent = parsed.intent as Intent;
      return { intent, slot: groundOccasion(text, intent, String(parsed?.slot ?? "")) };
    }
    return localFallback(text);
  } catch {
    return localFallback(text);
  }
}
