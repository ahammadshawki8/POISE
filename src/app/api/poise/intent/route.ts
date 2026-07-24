import { classifyIntent } from "@/lib/llm/intent";

/**
 * Classifies a spoken transcript into a Poise action. Cheap + fast (small model).
 * POST { transcript } -> { intent }
 */
export async function POST(request: Request) {
  try {
    const { transcript } = await request.json();
    if (typeof transcript !== "string") return Response.json({ intent: "none", slot: "" });
    const result = await classifyIntent(transcript);
    return Response.json(result);
  } catch {
    return Response.json({ intent: "none", slot: "" }, { status: 200 });
  }
}
