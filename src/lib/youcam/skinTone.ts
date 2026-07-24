import { authedFetch, parseJson, envelope, sleep } from "./client";

/**
 * AI Facial Color Tones Analyzer (skin-tone-analysis, v2.0). Returns the user's
 * measured skin/eye/lip/eyebrow/hair colors as hex — the raw material for a
 * personal-color-season diagnosis. Same upload→task→poll shape as skin-analysis
 * (flat body, `data` envelope, path-param poll). Face must be >60% of the frame
 * width (our tight face crop already satisfies this). See plan.md.
 */

const FEATURE = "skin-tone-analysis";
const PREFIX = "/s2s/v2.0";

export interface SkinToneResult {
  skin_color?: string; // hex
  eye_color?: string;
  eye_color_name?: string;
  lip_color?: string;
  eyebrow_color?: string;
  hair_color?: string;
  hair_color_name?: string;
  raw: unknown;
}

async function uploadImage(
  image: Buffer | Uint8Array,
  contentType = "image/jpeg",
  fileName = "selfie.jpg"
): Promise<string> {
  const json = await parseJson(
    await authedFetch(`${PREFIX}/file/${FEATURE}`, {
      method: "POST",
      body: JSON.stringify({
        files: [{ content_type: contentType, file_name: fileName, file_size: image.byteLength }],
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

async function startTask(fileId: string): Promise<string> {
  const json = await parseJson(
    await authedFetch(`${PREFIX}/task/${FEATURE}`, {
      method: "POST",
      body: JSON.stringify({ src_file_id: fileId }),
    })
  );
  const taskId = envelope<any>(json)?.task_id;
  if (!taskId) throw new Error(`No task_id: ${JSON.stringify(json)?.slice(0, 400)}`);
  return taskId as string;
}

async function pollTask(taskId: string, maxWaitMs = 120_000): Promise<SkinToneResult> {
  const start = Date.now();
  let interval = 1000;
  while (Date.now() - start < maxWaitMs) {
    const json = await parseJson(
      await authedFetch(`${PREFIX}/task/${FEATURE}/${encodeURIComponent(taskId)}`, { method: "GET" })
    );
    const env = envelope<any>(json);
    const status = env?.task_status ?? env?.status;
    if (status === "success") {
      const c = env?.results?.color ?? {};
      return {
        skin_color: c.skin_color,
        eye_color: c.eye_color,
        eye_color_name: c.eye_color_name,
        lip_color: c.lip_color,
        eyebrow_color: c.eyebrow_color,
        hair_color: c.hair_color,
        hair_color_name: c.hair_color_name,
        raw: env,
      };
    }
    if (status === "error") throw new Error(`Skin-tone failed: ${JSON.stringify(env)?.slice(0, 400)}`);
    interval = Math.min(env?.polling_interval ?? interval, 3000);
    await sleep(interval);
  }
  throw new Error(`Skin-tone task ${taskId} timed out`);
}

export async function analyzeSkinTone(
  image: Buffer | Uint8Array,
  opts: { contentType?: string; fileName?: string; maxWaitMs?: number } = {}
): Promise<SkinToneResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fileId = await uploadImage(image, opts.contentType, opts.fileName);
      const taskId = await startTask(fileId);
      return await pollTask(taskId, opts.maxWaitMs);
    } catch (e) {
      lastErr = e;
      if (attempt === 0 && /fetch failed|network|ECONN|ETIMEDOUT|timeout|socket/i.test(String((e as Error)?.message ?? ""))) {
        await sleep(800);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
