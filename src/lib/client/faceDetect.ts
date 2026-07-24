"use client";

import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Client-side face detection (MediaPipe BlazeFace, short-range). Runs entirely
 * in the browser — the image never leaves the device for detection. Used to
 * crop tightly around the face (so the skin engine's size check passes) and to
 * measure/normalize lighting on the face region specifically.
 *
 * Assets are self-hosted under /public (no CDN dependency at runtime).
 */

let detectorPromise: Promise<FaceDetector> | null = null;

async function getDetector(): Promise<FaceDetector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "/models/blaze_face_short_range.tflite",
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.4,
      });
    })();
  }
  return detectorPromise;
}

/** Warm up the model early (e.g. when the camera starts) to cut first-shot latency. */
export function warmUpFaceDetector(): void {
  void getDetector().catch(() => {});
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Returns the largest detected face box (in source pixels), or null if none. */
export async function detectFace(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<FaceBox | null> {
  const detector = await getDetector();
  const result = detector.detect(source);
  const detections = result.detections ?? [];
  if (detections.length === 0) return null;

  // Pick the largest face (closest / most prominent).
  let best = detections[0].boundingBox;
  for (const d of detections) {
    const bb = d.boundingBox;
    if (bb && best && bb.width * bb.height > best.width * best.height) best = bb;
  }
  if (!best) return null;
  return { x: best.originX, y: best.originY, width: best.width, height: best.height };
}
