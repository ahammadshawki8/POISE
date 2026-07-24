import { authedFetch, parseJson, envelope, sleep } from "./client";

/**
 * AI Clothes Try-On (cloth-v3, v2.0 path). Generative — renders the user's
 * full-body photo wearing a reference garment. See plan.md §6d.
 * Best-effort: needs a full-body src with a detectable pose.
 */

const FEATURE = "cloth-v3";
const PREFIX = "/s2s/v2.0";

async function uploadFile(image: Buffer | Uint8Array, fileName = "body.jpg", contentType = "image/jpeg"): Promise<string> {
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
    throw new Error(`Unexpected cloth file response: ${JSON.stringify(json)?.slice(0, 300)}`);
  }
  const put = await fetch(req.url, {
    method: req.method ?? "PUT",
    headers: req.headers ?? { "Content-Type": contentType },
    body: Buffer.from(image),
  });
  if (!put.ok) throw new Error(`Cloth upload failed HTTP ${put.status}`);
  return file.file_id as string;
}

/** ref may be a catalog URL (ref_file_url) or an uploaded file (ref_file_id). */
async function startTask(srcFileId: string, ref: { url?: string; fileId?: string }, category: string): Promise<string> {
  const json = await parseJson(
    await authedFetch(`${PREFIX}/task/${FEATURE}`, {
      method: "POST",
      body: JSON.stringify({
        src_file_id: srcFileId,
        ...(ref.fileId ? { ref_file_id: ref.fileId } : { ref_file_url: ref.url }),
        garment_category: category,
      }),
    })
  );
  const taskId = envelope<any>(json)?.task_id;
  if (!taskId) throw new Error(`No cloth task_id: ${JSON.stringify(json)?.slice(0, 300)}`);
  return taskId as string;
}

async function pollTask(taskId: string, maxWaitMs = 150_000): Promise<string> {
  const start = Date.now();
  let interval = 1500;
  while (Date.now() - start < maxWaitMs) {
    const json = await parseJson(
      await authedFetch(`${PREFIX}/task/${FEATURE}/${encodeURIComponent(taskId)}`, { method: "GET" })
    );
    const env = envelope<any>(json);
    const status = env?.task_status ?? env?.status;
    if (status === "success") {
      const url = env?.results?.url;
      if (!url) throw new Error("cloth success but no result url");
      return url as string;
    }
    if (status === "error") throw new Error(`cloth failed: ${JSON.stringify(env)?.slice(0, 300)}`);
    interval = Math.min(env?.polling_interval ?? interval, 3000);
    await sleep(interval);
  }
  throw new Error(`cloth task ${taskId} timed out`);
}

/** Renders the garment (ref image URL) onto the user body photo. Returns image URL. */
export async function tryOnGarment(
  bodyImage: Buffer | Uint8Array,
  refImageUrl: string,
  category: string,
  opts: { contentType?: string; maxWaitMs?: number } = {}
): Promise<string> {
  const srcId = await uploadFile(bodyImage, "body.jpg", opts.contentType);
  const taskId = await startTask(srcId, { url: refImageUrl }, category);
  return pollTask(taskId, opts.maxWaitMs);
}

/** Renders a generated/recoloured garment (raw image bytes) onto the user body photo. */
export async function tryOnGarmentBytes(
  bodyImage: Buffer | Uint8Array,
  refImage: Buffer | Uint8Array,
  category: string,
  opts: { contentType?: string; maxWaitMs?: number } = {}
): Promise<string> {
  const srcId = await uploadFile(bodyImage, "body.jpg", opts.contentType);
  const refId = await uploadFile(refImage, "garment.jpg", "image/jpeg");
  const taskId = await startTask(srcId, { fileId: refId }, category);
  return pollTask(taskId, opts.maxWaitMs);
}
