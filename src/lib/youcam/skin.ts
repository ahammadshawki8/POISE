import { authedFetch, parseJson, envelope, sleep } from "./client";

/**
 * AI Skin Analysis (v2.1). Contract confirmed from Perfect Corp docs — see
 * plan.md §6b. Note this differs from the generic v1.0 flow: flat task body,
 * `data` envelope, path-param polling.
 *
 * Scores: raw_score/ui_score are 1–100 where HIGHER = healthier (less of the
 * concern). So a LOW `redness` score means MORE redness. This is the opposite
 * of intuition and matters for how we phrase feedback later.
 */

const FEATURE = "skin-analysis";
const PREFIX = "/s2s/v2.1";

/**
 * SD skin concerns relevant to Poise's "how do I look" feedback.
 * (SD, not HD — we need scores for speech, not zoomed detection masks.)
 * Full SD set also includes: droopy_lower_eyelid, droopy_upper_eyelid, wrinkle,
 * pore, tear_trough, skin_type — added later if useful.
 */
export const POISE_SD_CONCERNS = [
  "redness",
  "radiance",
  "dark_circle_v2", // SD dark-circle token (per enum); HD uses "hd_dark_circle"
  "eye_bag",
  "oiliness",
  "moisture",
  "texture",
  "acne",
  "age_spot",
  "firmness",
] as const;

export interface SkinConcernResult {
  type: string;
  ui_score?: number; // 1-100 int (psychological modifier)
  raw_score?: number; // 1-100 float (higher = healthier / less of the concern)
  mask_urls?: string[];
}

export interface SkinAnalysisResult {
  concerns: SkinConcernResult[]; // per-concern scores (exclude meta items)
  all?: number; // overall skin condition 1-100 (higher = better), from `score`
  skin_age?: number; // AI-derived skin age, from `score`
  resizedImageUrl?: string; // normalized input image the engine actually scored
  raw: unknown; // full payload, kept for debugging / future fields
}

interface UploadOpts {
  contentType?: string;
  fileName?: string;
}

/** Step 1: presigned upload → returns file_id. */
async function uploadImage(
  image: Buffer | Uint8Array,
  { contentType = "image/jpeg", fileName = "selfie.jpg" }: UploadOpts = {}
): Promise<string> {
  const fileSize = image.byteLength;
  const json = await parseJson(
    await authedFetch(`${PREFIX}/file/${FEATURE}`, {
      method: "POST",
      body: JSON.stringify({
        files: [{ content_type: contentType, file_name: fileName, file_size: fileSize }],
      }),
    })
  );
  const env = envelope<any>(json);
  const file = env?.files?.[0];
  const req = file?.requests?.[0];
  if (!file?.file_id || !req?.url) {
    throw new Error(`Unexpected file API response: ${JSON.stringify(json)?.slice(0, 400)}`);
  }

  const put = await fetch(req.url, {
    method: req.method ?? "PUT",
    headers: req.headers ?? { "Content-Type": contentType },
    body: Buffer.from(image),
  });
  if (!put.ok) throw new Error(`Presigned upload failed HTTP ${put.status}`);

  return file.file_id as string;
}

/** Step 2: start the analysis task → returns task_id. */
async function startTask(fileId: string, concerns: readonly string[]): Promise<string> {
  const json = await parseJson(
    await authedFetch(`${PREFIX}/task/${FEATURE}`, {
      method: "POST",
      body: JSON.stringify({
        src_file_id: fileId,
        dst_actions: concerns,
        format: "json",
      }),
    })
  );
  const taskId = envelope<any>(json)?.task_id;
  if (!taskId) throw new Error(`No task_id in response: ${JSON.stringify(json)?.slice(0, 400)}`);
  return taskId as string;
}

/** Step 3: poll (path param) until success → normalized result. */
async function pollTask(
  taskId: string,
  { maxWaitMs = 120_000 }: { maxWaitMs?: number } = {}
): Promise<SkinAnalysisResult> {
  const start = Date.now();
  let interval = 1000;

  while (Date.now() - start < maxWaitMs) {
    const json = await parseJson(
      await authedFetch(`${PREFIX}/task/${FEATURE}/${encodeURIComponent(taskId)}`, {
        method: "GET",
      })
    );
    const env = envelope<any>(json);
    const status = env?.task_status ?? env?.status;

    if (status === "success") {
      const output = (env?.results?.output ?? []) as any[];
      const meta = (t: string) => output.find((o) => o.type === t);
      return {
        // Real concerns carry raw_score; meta items (all/skin_age/resize_image) don't.
        concerns: output.filter((o) => typeof o.raw_score === "number") as SkinConcernResult[],
        all: meta("all")?.score,
        skin_age: meta("skin_age")?.score,
        resizedImageUrl: meta("resize_image")?.mask_urls?.[0],
        raw: env,
      };
    }
    if (status === "error") {
      throw new Error(`Skin analysis failed: ${JSON.stringify(env)?.slice(0, 400)}`);
    }

    interval = Math.min(env?.polling_interval ?? interval, 3000);
    await sleep(interval);
  }
  throw new Error(`Skin analysis task ${taskId} timed out after ${maxWaitMs}ms`);
}

/** Full pipeline: upload → analyze → poll. */
export async function analyzeSkin(
  image: Buffer | Uint8Array,
  opts: {
    concerns?: readonly string[];
    contentType?: string;
    fileName?: string;
    maxWaitMs?: number;
  } = {}
): Promise<SkinAnalysisResult> {
  const concerns = opts.concerns ?? POISE_SD_CONCERNS;

  // Retry once on transient network failures (fetch/DNS blips), not on real
  // task errors like error_src_face_too_small.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fileId = await uploadImage(image, {
        contentType: opts.contentType,
        fileName: opts.fileName,
      });
      const taskId = await startTask(fileId, concerns);
      return await pollTask(taskId, { maxWaitMs: opts.maxWaitMs });
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message ?? "");
      if (attempt === 0 && /fetch failed|network|ECONN|ETIMEDOUT|timeout|socket/i.test(msg)) {
        await sleep(800);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
