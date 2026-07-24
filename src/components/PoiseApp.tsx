"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  speak,
  stopSpeaking,
  supportsSTT,
  createRecognizer,
  setVoiceGender,
  type Recognizer,
  type VoiceGender,
} from "@/lib/client/speech";
import { detectFace, warmUpFaceDetector } from "@/lib/client/faceDetect";
import { CATALOG, findGarment, type Garment } from "@/lib/poise/wardrobe";
import { parseGarment } from "@/lib/poise/garments";
import type { SkinConcern } from "@/lib/poise/skinStyle";
import {
  getProfiles,
  getActiveProfile,
  getActiveProfileId,
  setActiveProfile,
  createProfile,
  deleteProfile,
  pget,
  pset,
  type Profile,
} from "@/lib/client/profile";
import {
  MicIcon,
  MicOffIcon,
  VolumeIcon,
  VolumeOffIcon,
  CameraIcon,
  CameraOffIcon,
  LipstickIcon,
  SparkleIcon,
  HeartIcon,
  CheckIcon,
  TrendUpIcon,
  HomeIcon,
  ShirtIcon,
  GearIcon,
  UserIcon,
  PlayIcon,
} from "@/components/icons";

type Status = "idle" | "starting" | "ready" | "analyzing" | "result" | "error";
type Framing = "idle" | "searching" | "far" | "good";
type Screen = "home" | "camera" | "skin" | "style" | "profile";

const STEPS: Screen[] = ["home", "camera", "skin", "style", "profile"];
const NAV: { key: Screen; label: string; Icon: typeof HomeIcon }[] = [
  { key: "home", label: "Home", Icon: HomeIcon },
  { key: "camera", label: "Camera", Icon: CameraIcon },
  { key: "skin", label: "Skin", Icon: SparkleIcon },
  { key: "style", label: "Style", Icon: ShirtIcon },
  { key: "profile", label: "Profile", Icon: UserIcon },
];
const CAMERA_SCREENS: Screen[] = ["camera"];

interface Finding {
  type: string;
  concern: string;
  note: string;
  tip?: string;
  score: number;
  severity?: string;
}
interface FeedbackResult {
  ok: true;
  spokenText: string;
  phrasingSource: string;
  headline: string;
  overall?: number;
  skinAge?: number;
  positives: Finding[];
  concerns: Finding[];
  scores: { type: string; raw_score: number; ui_score: number }[];
}
interface ColorProfileLite {
  season: string;
  undertone: string;
  metals: string;
  palette: { name: string; hex: string }[];
  avoid: string[];
}
interface WardrobeItem {
  name: string;
  colorHex: string;
  category?: string;
  occasions?: string[];
  refImage?: string; // compressed data URL of the ACTUAL garment (captured while worn)
  description?: string; // vision description of the real garment, for later speech
}

/** Best wardrobe match for a spoken garment phrase ("that purple punjabi"). */
function matchWardrobe(query: string, items: WardrobeItem[]): WardrobeItem | null {
  const q = query.toLowerCase();
  let best: WardrobeItem | null = null;
  let bestScore = 0;
  for (const g of items) {
    const name = g.name.toLowerCase();
    let score = 0;
    if (q.includes(name)) score += 10;
    for (const w of name.split(/\s+/)) if (w.length >= 3 && q.includes(w)) score += 3;
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  return bestScore >= 3 ? best : null;
}
interface Weather {
  tempC: number;
  feelsC: number;
  condition: string;
  uv: number;
  humidity: number;
  isDay: boolean;
  aqi?: number;
  aqiLabel: string;
  city?: string;
}
function readWardrobe(): WardrobeItem[] {
  try {
    return JSON.parse(pget("wardrobe") || "[]");
  } catch {
    return [];
  }
}

const CONCERN_LABELS: Record<string, string> = {
  redness: "Calm skin",
  radiance: "Radiance",
  dark_circle_v2: "Bright under-eyes",
  eye_bag: "Rested eyes",
  oiliness: "Oil balance",
  moisture: "Hydration",
  texture: "Smooth texture",
  acne: "Clear skin",
  age_spot: "Even tone",
  firmness: "Firmness",
};

function scoreColor(score: number): string {
  if (score >= 80) return "bg-[#7fd6a8]";
  if (score >= 65) return "bg-[#ffcf7a]";
  return "bg-[#ff9ab5]";
}

const DEV = process.env.NODE_ENV !== "production";

interface HistEntry {
  t: number;
  overall: number;
  scores?: Record<string, number>;
}
function readHistory(): HistEntry[] {
  try {
    return JSON.parse(pget("history") || "[]");
  } catch {
    return [];
  }
}
function lastOverall(): number | undefined {
  const h = readHistory();
  return h.length ? h[h.length - 1].overall : undefined;
}
function pushHistory(overall: number, scores?: Record<string, number>) {
  const h = readHistory();
  h.push({ t: Date.now(), overall, scores });
  pset("history", JSON.stringify(h.slice(-30)));
}

// Spoken-letter resolver for spelling out a name (handles single letters,
// letter-names like "bee"→b, and NATO like "sierra"→s). Unknown words are
// ignored, so ambient speech doesn't pollute the name.
const LETTER_WORDS: Record<string, string> = {
  alpha: "a", bravo: "b", charlie: "c", delta: "d", echo: "e", foxtrot: "f", golf: "g", hotel: "h", india: "i",
  juliet: "j", juliett: "j", kilo: "k", lima: "l", mike: "m", november: "n", oscar: "o", papa: "p", quebec: "q",
  romeo: "r", sierra: "s", tango: "t", uniform: "u", victor: "v", whiskey: "w", whisky: "w", xray: "x", yankee: "y", zulu: "z",
  ay: "a", bee: "b", cee: "c", see: "c", dee: "d", ee: "e", ef: "f", eff: "f", gee: "g", aitch: "h", haitch: "h",
  eye: "i", jay: "j", kay: "k", kaye: "k", el: "l", ell: "l", em: "m", en: "n", oh: "o", pee: "p", cue: "q",
  queue: "q", ar: "r", are: "r", es: "s", ess: "s", tee: "t", tea: "t", you: "u", yu: "u", vee: "v", ex: "x",
  why: "y", zee: "z", zed: "z",
};
function resolveLetter(token: string): string {
  const w = token.replace(/[^a-z]/gi, "").toLowerCase();
  if (!w) return "";
  if (w.length === 1) return w;
  return LETTER_WORDS[w] ?? "";
}

function Card({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="rounded-[1.6rem] bg-white/85 p-5 shadow-[0_10px_28px_-16px_rgba(236,92,146,0.55)] ring-1 ring-white">
      {children}
    </section>
  );
}

export default function PoiseApp() {
  const [status, setStatus] = useState<Status>("idle");
  const [caption, setCaption] = useState("Hi, I'm Poise — just ask me anything.");
  const [result, setResult] = useState<FeedbackResult | null>(null);
  const [trend, setTrend] = useState<number | null>(null);
  const [framing, setFraming] = useState<Framing>("idle");
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [makeupTips, setMakeupTips] = useState(false);
  const [sttAvailable, setSttAvailable] = useState(false);
  const [debugInfo, setDebugInfo] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceGender>("female");
  const [colorProfile, setColorProfile] = useState<ColorProfileLite | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [getReadyGarment, setGetReadyGarment] = useState<{ id: string; name: string; colorHex: string } | null>(null);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [awaitingOccasion, setAwaitingOccasion] = useState(false);
  const [gated, setGated] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeName, setActiveName] = useState("");
  const [activeHue, setActiveHue] = useState(330);
  const [newName, setNewName] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const voiceOnRef = useRef(false);
  const mutedRef = useRef(false);
  const makeupTipsRef = useRef(false);
  const speakingRef = useRef(false);
  const demoRunningRef = useRef(false);
  const autoStartedRef = useRef(false);
  const firstRunRef = useRef(false);
  const welcomedRef = useRef(false);
  const gatedRef = useRef(true);
  const gateHandlerRef = useRef<(t: string) => void>(() => {});
  const switchProfileRef = useRef<() => void>(() => {});
  const newNameRef = useRef("");
  const wardrobeRef = useRef<WardrobeItem[]>([]);
  const weatherRef = useRef<Weather | null>(null);
  const pendingDeleteRef = useRef<string | null>(null);
  const awaitingOccasionRef = useRef(false);
  const pendingStyleActionRef = useRef<"recommend" | "getready">("recommend");
  const statusRef = useRef<Status>("idle");
  const screenRef = useRef<Screen>("home");
  const colorProfileRef = useRef<ColorProfileLite | null>(null);
  const skinStateRef = useRef<SkinConcern[]>([]); // today's flagged skin concerns, for colour steering
  const resultRef = useRef<FeedbackResult | null>(null);
  const handleRef = useRef<(t: string) => void>(() => {});
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => void (voiceOnRef.current = voiceOn), [voiceOn]);
  useEffect(() => void (mutedRef.current = muted), [muted]);
  useEffect(() => void (statusRef.current = status), [status]);
  useEffect(() => void (screenRef.current = screen), [screen]);
  useEffect(() => void (colorProfileRef.current = colorProfile), [colorProfile]);
  useEffect(() => void (resultRef.current = result), [result]);
  useEffect(() => void (gatedRef.current = gated), [gated]);
  useEffect(() => void (newNameRef.current = newName), [newName]);
  useEffect(() => void (wardrobeRef.current = wardrobe), [wardrobe]);
  useEffect(() => void (weatherRef.current = weather), [weather]);
  useEffect(() => void (pendingDeleteRef.current = pendingDeleteId), [pendingDeleteId]);
  useEffect(() => void (awaitingOccasionRef.current = awaitingOccasion), [awaitingOccasion]);

  const loadProfileData = useCallback(() => {
    const mk = pget("makeup");
    const b = mk === "1";
    setMakeupTips(b);
    makeupTipsRef.current = b;
    const v = pget("voice");
    if (v === "male" || v === "female") {
      setVoice(v);
      setVoiceGender(v);
    }
    const c = pget("color");
    setColorProfile(c ? JSON.parse(c) : null);
    const sk = pget("skin");
    skinStateRef.current = sk ? JSON.parse(sk) : [];
    setHistory(readHistory());
    const w = readWardrobe();
    setWardrobe(w);
    wardrobeRef.current = w;
    firstRunRef.current = !pget("onboarded");
  }, []);

  useEffect(() => {
    setSttAvailable(supportsSTT());
    setProfiles(getProfiles());
    const active = getActiveProfile();
    if (active) {
      setActiveName(active.name);
      setActiveHue(active.hue);
      loadProfileData();
      setGated(false);
    } else {
      setGated(true);
    }
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      const s = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
      if (/XNNPACK|Feedback manager|OpenGL error checking|GL version:|Graph successfully|inference_feedback|gl_context\.cc/.test(s)) return;
      origError(...(args as []));
    };
    return () => {
      console.error = origError;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognizerRef.current?.abort();
      stopSpeaking();
    };
  }, [loadProfileData]);

  useEffect(() => {
    if (status === "result") resultHeadingRef.current?.focus();
  }, [status]);

  // --- Voice listening control -------------------------------------------

  const resumeListening = useCallback(() => {
    if (voiceOnRef.current && !speakingRef.current && recognizerRef.current) {
      try {
        recognizerRef.current.start();
        setListening(true);
      } catch {
        /* already started */
      }
    }
  }, []);
  const pauseListening = useCallback(() => {
    recognizerRef.current?.abort();
    setListening(false);
  }, []);
  const say = useCallback(
    (text: string) => {
      if (mutedRef.current) return;
      speakingRef.current = true;
      pauseListening();
      speak(text, {
        onEnd: () => {
          speakingRef.current = false;
          resumeListening();
        },
      });
    },
    [pauseListening, resumeListening]
  );
  const announce = useCallback(
    (text: string) => {
      setCaption(text);
      say(text);
    },
    [say]
  );

  const setMakeupPref = useCallback((v: boolean) => {
    setMakeupTips(v);
    makeupTipsRef.current = v;
    pset("makeup", v ? "1" : "0");
  }, []);
  const setMutedPref = useCallback((v: boolean) => {
    setMuted(v);
    mutedRef.current = v;
    if (v) stopSpeaking();
  }, []);
  const setVoicePref = useCallback((g: VoiceGender) => {
    setVoice(g);
    setVoiceGender(g);
    pset("voice", g);
  }, []);

  // --- Camera + capture --------------------------------------------------

  const startCamera = useCallback(async () => {
    setStatus("starting");
    setCaption("Starting the camera…");
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setStatus("error");
      announce("The camera needs a secure connection. Please open the app at localhost, not a network address.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      announce("This browser doesn't support camera access. Try Chrome or Edge.");
      return;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      warmUpFaceDetector();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus("ready");
      announce("Ready when you are. Just ask.");
    } catch (err) {
      setStatus("error");
      const e = err as DOMException;
      if (DEV) setDebugInfo(`camera ${e.name}: ${e.message}`);
      let msg = "I couldn't reach the camera.";
      if (e.name === "NotAllowedError") msg = "Camera access is blocked. Allow it in your browser, then try again.";
      else if (e.name === "NotFoundError" || e.name === "OverconstrainedError") msg = "I couldn't find a usable camera on this device.";
      else if (e.name === "NotReadableError") msg = "Your camera is in use by another app or tab. Close it and try again.";
      announce(msg);
    }
  }, [announce]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
    setFraming("idle");
    setCaption("Camera is off. Turn it back on in Settings, or say “camera on”.");
  }, []);

  const captureFrame = useCallback(
    async (video: HTMLVideoElement): Promise<{ blob: Blob | null; noFace?: boolean; tooFar?: boolean }> => {
      const t0 = Date.now();
      while ((video.readyState < 2 || !video.videoWidth) && Date.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 100));
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return { blob: null };
      let box = null;
      let detectorRan = false;
      try {
        box = await detectFace(video);
        detectorRan = true;
      } catch {
        /* center-crop fallback */
      }
      if (detectorRan && !box) return { blob: null, noFace: true };
      let side: number;
      let sx: number;
      let sy: number;
      if (box) {
        if (box.width < vw * 0.15) return { blob: null, tooFar: true };
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2 - box.height * 0.12;
        side = Math.min(Math.round(box.width * 1.6), vw, vh);
        sx = Math.max(0, Math.min(Math.round(cx - side / 2), vw - side));
        sy = Math.max(0, Math.min(Math.round(cy - side / 2), vh - side));
      } else {
        side = Math.round(Math.min(vw, vh) * 0.7);
        sx = Math.max(0, Math.min(Math.round(vw / 2 - side / 2), vw - side));
        sy = Math.max(0, Math.min(Math.round(vh * 0.48 - side / 2), vh - side));
      }
      const out = 720;
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = out;
      canvas.height = out;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return { blob: null };
      ctx.filter = "none";
      ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
      let avg = 128;
      try {
        const data = ctx.getImageData(0, 0, out, out).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4 * 40) {
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          n++;
        }
        avg = sum / Math.max(n, 1);
      } catch {
        /* skip */
      }
      if (avg < 125) {
        const factor = Math.min(2.4, Math.max(1, 130 / Math.max(avg, 1)));
        ctx.filter = `brightness(${factor.toFixed(2)}) contrast(1.06)`;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);
        ctx.filter = "none";
      }
      if (DEV) setDebugInfo(`${box ? "face" : "center"} crop ${side}px · brightness ${Math.round(avg)}`);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92));
      return { blob };
    },
    []
  );

  const captureBody = useCallback(async (video: HTMLVideoElement): Promise<Blob | null> => {
    const t0 = Date.now();
    while ((video.readyState < 2 || !video.videoWidth) && Date.now() - t0 < 2500) await new Promise((r) => setTimeout(r, 100));
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.filter = "none";
    ctx.drawImage(video, 0, 0, vw, vh);
    let avg = 128;
    try {
      const d = ctx.getImageData(0, 0, vw, vh).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4 * 200) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++;
      }
      avg = sum / Math.max(n, 1);
    } catch {
      /* skip */
    }
    if (avg < 120) {
      ctx.filter = `brightness(${Math.min(2.2, Math.max(1, 125 / Math.max(avg, 1))).toFixed(2)})`;
      ctx.drawImage(video, 0, 0, vw, vh);
      ctx.filter = "none";
    }
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.9));
  }, []);

  // --- Feature actions ---------------------------------------------------

  const analyze = useCallback(async () => {
    if (statusRef.current === "analyzing" || statusRef.current === "starting") return;
    setScreen("camera");
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      await startCamera();
      return;
    }
    setStatus("analyzing");
    announce("Give me a moment, I'm looking.");
    try {
      const cap = await captureFrame(video);
      if (cap.noFace) {
        setStatus("ready");
        announce("I can't see your face yet. Make sure you're in front of the camera, then ask again.");
        return;
      }
      if (cap.tooFar) {
        setStatus("ready");
        announce("You're a little far away. Come closer so your face fills the view, then ask again.");
        return;
      }
      if (!cap.blob) {
        setStatus("ready");
        announce("The camera isn't ready yet. Give it a second, then try again.");
        return;
      }
      const prevOverall = lastOverall();
      const fd = new FormData();
      fd.append("image", cap.blob, "selfie.jpg");
      fd.append("makeupTips", makeupTipsRef.current ? "true" : "false");
      if (typeof prevOverall === "number") fd.append("previousOverall", String(prevOverall));
      const res = await fetch("/api/poise/feedback", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) {
        const err = String(data.error ?? "");
        if (DEV) setDebugInfo(err);
        setStatus("ready");
        if (/lighting_dark|dark/i.test(err)) announce("It's a little too dark. Try facing a window or turning on a light, then ask again.");
        else if (/too_small/i.test(err)) announce("Move a little closer so your face fills more of the view, then try again.");
        else if (/no_face|face/i.test(err)) announce("I couldn't find your face. Center it in the frame and try again.");
        else announce("Something went wrong analyzing that. Let's try again.");
        return;
      }
      const fb = data as FeedbackResult;
      if (typeof fb.overall === "number") {
        setTrend(typeof prevOverall === "number" ? Math.round(fb.overall - prevOverall) : null);
        const scoreMap: Record<string, number> = {};
        for (const s of fb.scores) scoreMap[s.type] = s.raw_score;
        pushHistory(fb.overall, scoreMap);
        setHistory(readHistory());
      } else setTrend(null);
      // Refresh today's skin state so styling ("what should I wear") steers colours
      // by the same fresh read.
      if (Array.isArray(fb.concerns)) {
        skinStateRef.current = fb.concerns;
        pset("skin", JSON.stringify(fb.concerns));
      }
      setResult(fb);
      setStatus("result");
      setScreen("skin");
      announce(fb.spokenText);
    } catch {
      setStatus("ready");
      announce("Something went wrong. Let's try again.");
    }
  }, [announce, captureFrame, startCamera]);

  const runColorAnalysis = useCallback(async () => {
    if (statusRef.current === "analyzing" || statusRef.current === "starting") return;
    setScreen("camera");
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      await startCamera();
      return;
    }
    setStatus("analyzing");
    announce("Let me look at your colouring.");
    try {
      const cap = await captureFrame(video);
      if (cap.noFace || cap.tooFar) {
        setStatus("ready");
        announce("I need a clear, close look at your face for colours. Come a bit closer and ask again.");
        return;
      }
      if (!cap.blob) {
        setStatus("ready");
        announce("The camera isn't ready yet. Try again in a second.");
        return;
      }
      const fd = new FormData();
      fd.append("image", cap.blob, "selfie.jpg");
      const res = await fetch("/api/poise/color", { method: "POST", body: fd });
      const data = await res.json();
      if (!data.ok) {
        setStatus("ready");
        announce("I couldn't read your colours just now. Come a bit closer, in good light, and try again.");
        return;
      }
      setColorProfile(data.profile as ColorProfileLite);
      pset("color", JSON.stringify(data.profile));
      setStatus("result");
      setScreen("style");
      announce(data.spokenText);
    } catch {
      setStatus("ready");
      announce("Something went wrong. Let's try again.");
    }
  }, [announce, captureFrame, startCamera]);

  /**
   * Ensure we're ready to style: the user's colour read AND today's skin state.
   * If either is missing, route to the camera, capture ONE frame, and fetch
   * whichever we lack (colour + live skin concerns, in parallel) — auto-continuing
   * so an agentic flow like "what should I wear?" can look, then style. Colour is
   * required; skin steering is best-effort. Announces its own failures.
   */
  const ensureStyleReadiness = useCallback(async (): Promise<boolean> => {
    const needColor = !colorProfileRef.current;
    const needSkin = !skinStateRef.current.length;
    if (!needColor && !needSkin) return true;

    setScreen("camera");
    if (!videoRef.current || !streamRef.current) {
      await startCamera();
      if (!streamRef.current) return false; // camera unavailable — startCamera announced why
    }
    const video = videoRef.current;
    if (!video) return false;
    setStatus("analyzing");
    const cap = await captureFrame(video);
    if (cap.noFace || cap.tooFar) {
      announce("I need a clear, close look at your face. Come a bit closer, then ask again.");
      return false;
    }
    if (!cap.blob) {
      announce("The camera isn't ready yet. Give it a second, then ask again.");
      return false;
    }
    const blob = cap.blob;

    // Colour read (required) + today's skin concerns (best-effort), one capture.
    const colorTask = needColor
      ? (async () => {
          const fd = new FormData();
          fd.append("image", blob, "selfie.jpg");
          const res = await fetch("/api/poise/color", { method: "POST", body: fd });
          return res.json();
        })()
      : Promise.resolve({ ok: true, profile: colorProfileRef.current });
    const skinTask = needSkin
      ? (async () => {
          const fd = new FormData();
          fd.append("image", blob, "selfie.jpg");
          fd.append("makeupTips", makeupTipsRef.current ? "true" : "false");
          const res = await fetch("/api/poise/feedback", { method: "POST", body: fd });
          return res.json();
        })().catch(() => ({ ok: false }))
      : Promise.resolve({ ok: false });

    let colorData: { ok?: boolean; profile?: unknown };
    let skinData: { ok?: boolean; concerns?: SkinConcern[] };
    try {
      [colorData, skinData] = await Promise.all([colorTask, skinTask]);
    } catch {
      announce("Something went wrong reading your skin. Let's try again.");
      return false;
    }

    if (!colorData?.ok) {
      announce("I couldn't read your colours just now. Come a bit closer, in good light, then ask again.");
      return false;
    }
    setColorProfile(colorData.profile as ColorProfileLite);
    colorProfileRef.current = colorData.profile as ColorProfileLite;
    pset("color", JSON.stringify(colorData.profile));

    if (skinData?.ok && Array.isArray(skinData.concerns)) {
      skinStateRef.current = skinData.concerns;
      pset("skin", JSON.stringify(skinData.concerns));
    }
    return true;
  }, [announce, captureFrame, startCamera]);

  const runProgress = useCallback(async () => {
    setScreen("profile");
    const h = readHistory();
    if (h.length < 2) {
      announce("I need a couple of check-ins first. Ask me how you look a few times over the coming days, and I'll track your progress.");
      return;
    }
    announce("Let me look back over your check-ins.");
    try {
      const res = await fetch("/api/poise/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history: h }) });
      const data = await res.json();
      if (data.ok) {
        setProgressText(data.spokenText);
        announce(data.spokenText);
      } else announce("I don't have enough check-ins yet to see a trend.");
    } catch {
      announce("I couldn't put together your progress just now.");
    }
  }, [announce]);

  const runTryOn = useCallback(
    async (garment: Garment) => {
      setScreen("style");
      setRenderUrl(null);
      announce(`Trying on the ${garment.name}. Give me a moment.`);
      setBusyLabel("Trying it on…");
      try {
        const fd = new FormData();
        fd.append("garmentId", garment.id);
        if (colorProfileRef.current) fd.append("profile", JSON.stringify(colorProfileRef.current));
        const video = videoRef.current;
        if (video && streamRef.current) {
          const blob = await captureBody(video);
          if (blob) fd.append("image", blob, "body.jpg");
        }
        const res = await fetch("/api/poise/tryon", { method: "POST", body: fd });
        const data = await res.json();
        setBusyLabel(null);
        if (!data.ok) {
          announce("I couldn't try that on just now.");
          return;
        }
        if (data.renderUrl) setRenderUrl(data.renderUrl);
        announce(data.spokenText);
      } catch {
        setBusyLabel(null);
        announce("Something went wrong trying that on.");
      }
    },
    [announce, captureBody]
  );

  const runGetReady = useCallback(
    async (occasion: string) => {
      const occ = (occasion || "").trim();
      // Need a real occasion — don't guess. Ask, then resume.
      if (!occ) {
        setScreen("style");
        setGetReadyGarment(null);
        setAwaitingOccasion(true);
        awaitingOccasionRef.current = true;
        pendingStyleActionRef.current = "getready";
        announce("Happy to. What are you getting ready for? For example, work, a date, a party, or something casual.");
        return;
      }
      setAwaitingOccasion(false);
      awaitingOccasionRef.current = false;
      setGetReadyGarment(null);

      // Agentic: look at their colouring + today's skin first if we haven't, so
      // the look is built on their real skin state (+ weather + occasion).
      if (!colorProfileRef.current || !skinStateRef.current.length) {
        setScreen("style");
        announce(`Let's get you ready for your ${occ}. First, a quick look at your skin so I can match the colours to how you look today.`);
        const ok = await ensureStyleReadiness();
        if (!ok) {
          setStatus("ready");
          return;
        }
        setStatus("result");
      }

      setScreen("style");
      setBusyLabel("Putting your look together…");
      try {
        const res = await fetch("/api/poise/getready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ occasion: occ, profile: colorProfileRef.current, makeupTips: makeupTipsRef.current, skin: skinStateRef.current }),
        });
        const data = await res.json();
        setBusyLabel(null);
        if (!data.ok) {
          announce("I couldn't put your look together just now.");
          return;
        }
        if (data.chosen) setGetReadyGarment(data.chosen);
        announce(data.spokenText);
      } catch {
        setBusyLabel(null);
        announce("Something went wrong. Let's try again.");
      }
    },
    [announce, ensureStyleReadiness]
  );

  // --- Wardrobe memory + dynamic styling --------------------------------

  // Downscale a captured frame to a small JPEG data URL for wardrobe storage.
  const blobToThumb = useCallback(async (blob: Blob, maxDim = 512, quality = 0.6): Promise<string | null> => {
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      return c.toDataURL("image/jpeg", quality);
    } catch {
      return null;
    }
  }, []);

  const addGarment = useCallback((item: WardrobeItem): boolean => {
    const cur = wardrobeRef.current;
    const dup = cur.findIndex((g) => g.name.toLowerCase() === item.name.toLowerCase());
    // If it exists but now has a real photo, upgrade it in place; else it's a dup.
    let list = cur;
    if (dup >= 0) {
      if (!item.refImage) return false;
      list = cur.map((g, i) => (i === dup ? { ...g, ...item } : g));
    } else {
      list = [...cur, item];
    }
    // Keep only the newest ~15 garment photos to stay well inside localStorage.
    let next = list.slice(-40);
    const withImg = next.filter((g) => g.refImage);
    if (withImg.length > 15) {
      const keep = new Set(withImg.slice(-15));
      next = next.map((g) => (g.refImage && !keep.has(g) ? { ...g, refImage: undefined } : g));
    }
    wardrobeRef.current = next;
    setWardrobe(next);
    pset("wardrobe", JSON.stringify(next));
    return true;
  }, []);
  const removeGarment = useCallback((name: string) => {
    const next = wardrobeRef.current.filter((g) => g.name.toLowerCase() !== name.toLowerCase());
    wardrobeRef.current = next;
    setWardrobe(next);
    pset("wardrobe", JSON.stringify(next));
  }, []);

  const runAddGarment = useCallback(
    async (desc: string) => {
      const p = parseGarment(desc);
      if (!p) {
        announce("I didn't catch which garment. Try, I have a black shirt.");
        return;
      }
      const base = { name: p.name, colorHex: p.colorHex, category: p.category, occasions: p.occasions };

      // Capture the ACTUAL garment they're wearing so we can try it back on later.
      const video = videoRef.current;
      if (video && streamRef.current) {
        setScreen("camera");
        announce(`Let me look at the ${p.name} you're wearing, so I can remember exactly how it looks.`);
        setBusyLabel("Looking at what you're wearing…");
        const blob = await captureBody(video);
        if (blob) {
          const thumb = await blobToThumb(blob);
          let description: string | undefined;
          try {
            const fd = new FormData();
            fd.append("image", blob, "outfit.jpg");
            const r = await fetch("/api/poise/outfit", { method: "POST", body: fd });
            const d = await r.json();
            if (d.ok && d.description) description = String(d.description);
          } catch {
            /* vision best-effort */
          }
          setBusyLabel(null);
          setScreen("style");
          const added = addGarment({ ...base, refImage: thumb ?? undefined, description });
          announce(
            added
              ? `Saved the ${p.name} you're wearing, exactly as it looks. Ask me later, how would I look in the ${p.name}, and I'll put it right back on you.`
              : `You already have a ${p.name}.`
          );
          return;
        }
        setBusyLabel(null);
      }

      // No camera — remember it by description (turn the camera on to capture the real one).
      setScreen("style");
      const added = addGarment(base);
      announce(
        added
          ? `Added the ${p.name} to your wardrobe. Turn on the camera and say it again if you want me to capture the exact one you're wearing.`
          : `You already have a ${p.name}.`
      );
    },
    [addGarment, announce, blobToThumb, captureBody]
  );

  const runGarmentQuery = useCallback(
    async (desc: string) => {
      setScreen("style");
      setRenderUrl(null);
      // Prefer a REAL garment saved in the wardrobe ("that purple punjabi") over
      // a generated stand-in, so we render the exact one they own.
      const saved = matchWardrobe(desc, wardrobeRef.current);
      const useSaved = saved?.refImage;
      announce(useSaved ? `Let me put your ${saved!.name} on you. Give me a moment.` : `Let me picture you in the ${desc}. Give me a moment.`);
      setBusyLabel("Generating the look…");
      try {
        const fd = new FormData();
        if (useSaved) {
          fd.append("garment", saved!.name);
          fd.append("refImage", saved!.refImage!);
          if (saved!.category) fd.append("refCategory", saved!.category);
          if (saved!.description) fd.append("garmentDescription", saved!.description);
        } else {
          fd.append("garment", desc);
        }
        if (colorProfileRef.current) fd.append("profile", JSON.stringify(colorProfileRef.current));
        if (weatherRef.current) fd.append("weather", JSON.stringify(weatherRef.current));
        if (skinStateRef.current.length) fd.append("skin", JSON.stringify(skinStateRef.current));
        const video = videoRef.current;
        const hadCamera = !!(video && streamRef.current);
        if (hadCamera && video) {
          const blob = await captureBody(video);
          if (blob) fd.append("image", blob, "body.jpg");
        }
        const res = await fetch("/api/poise/tryon", { method: "POST", body: fd });
        const data = await res.json();
        setBusyLabel(null);
        if (!data.ok) {
          announce("I couldn't picture that one. Try, how would I look in a black shirt.");
          return;
        }
        // Show the image FIRST: the on-body render if we have it, else the garment itself.
        if (data.renderUrl) setRenderUrl(data.renderUrl);
        else if (data.previewUrl) setRenderUrl(data.previewUrl);
        // Then speak the verdict; if we could only show a flat garment, nudge to the camera.
        const needCamera = !data.renderUrl && data.renderable && !hadCamera;
        announce(needCamera ? `${data.spokenText} Turn on the camera and ask again to see it on you.` : data.spokenText);
      } catch {
        setBusyLabel(null);
        announce("Something went wrong. Let's try again.");
      }
    },
    [announce, captureBody]
  );

  const runRecommend = useCallback(
    async (occasion: string) => {
      const occ = (occasion || "").trim();
      // Recommendations must be grounded in an occasion (and today's weather).
      // If the occasion is missing, ask for it and wait for the answer.
      if (!occ) {
        setScreen("style");
        setAwaitingOccasion(true);
        awaitingOccasionRef.current = true;
        pendingStyleActionRef.current = "recommend";
        announce("What's the occasion? For example, work, a date, a party, or something casual.");
        return;
      }
      setAwaitingOccasion(false);
      awaitingOccasionRef.current = false;

      // Agentic: if we've never read their colouring, look first — route to the
      // camera, capture + analyse — then come back to Style and style them. This
      // is what lets the suggestion combine skin tone + weather + occasion,
      // rather than guessing blind.
      if (!colorProfileRef.current || !skinStateRef.current.length) {
        setScreen("style");
        announce(`Let me take a quick look at your skin first, so I can match your ${occ} to how you look today and the weather.`);
        const ok = await ensureStyleReadiness();
        if (!ok) {
          setStatus("ready");
          return; // ensureStyleReadiness already said why
        }
        setStatus("result");
      }

      setScreen("style");
      setBusyLabel("Putting your look together…");
      try {
        const res = await fetch("/api/poise/style", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "recommend", occasion: occ, profile: colorProfileRef.current, weather: weatherRef.current, wardrobe: wardrobeRef.current, skin: skinStateRef.current }),
        });
        const data = await res.json();
        setBusyLabel(null);
        if (data.ok) announce(data.spokenText);
        else announce("I couldn't put a suggestion together just now.");
      } catch {
        setBusyLabel(null);
        announce("Something went wrong. Let's try again.");
      }
    },
    [announce, ensureStyleReadiness]
  );

  // Resume the style action that was waiting on an occasion (voice reply or a chip tap).
  // (kept below runRecommend/runGetReady so both are in scope)
  const answerOccasion = useCallback(
    (occ: string) => {
      setAwaitingOccasion(false);
      awaitingOccasionRef.current = false;
      if (pendingStyleActionRef.current === "getready") runGetReady(occ);
      else runRecommend(occ);
    },
    [runGetReady, runRecommend]
  );

  const runChangedClothes = useCallback(
    async (garmentSlot: string) => {
      // If they named the garment, just remember it — no vision needed.
      const named = garmentSlot ? parseGarment(garmentSlot) : null;
      if (named) {
        setScreen("style");
        const added = addGarment({ name: named.name, colorHex: named.colorHex, category: named.category, occasions: named.occasions });
        announce(`Noted — you're wearing the ${named.name}.${added ? " I've added it to your wardrobe." : ""}`);
        return;
      }
      // Otherwise, look at the outfit with the camera (OpenRouter vision, best-effort).
      const video = videoRef.current;
      if (!video || !streamRef.current) {
        await startCamera();
        return;
      }
      setScreen("camera");
      announce("Let me see what you're wearing. Give me a moment.");
      setBusyLabel("Looking at your outfit…");
      try {
        const blob = await captureBody(video);
        if (!blob) {
          setBusyLabel(null);
          announce("The camera isn't ready. Try again in a second.");
          return;
        }
        const fd = new FormData();
        fd.append("image", blob, "outfit.jpg");
        const res = await fetch("/api/poise/outfit", { method: "POST", body: fd });
        const data = await res.json();
        setBusyLabel(null);
        if (data.ok && data.description) {
          let added = 0;
          for (const it of data.items ?? []) {
            const p = parseGarment(`${it.color ?? ""} ${it.name ?? ""}`);
            if (p && addGarment({ name: p.name, colorHex: p.colorHex, category: p.category, occasions: p.occasions })) added++;
          }
          setScreen("style");
          announce(`${data.description}${added ? " I've added it to your wardrobe." : ""}`);
        } else {
          setScreen("style");
          announce("I couldn't see your outfit clearly. Tell me what you're wearing, like, I'm wearing a black shirt.");
        }
      } catch {
        setBusyLabel(null);
        announce("Something went wrong. Tell me what you're wearing instead.");
      }
    },
    [addGarment, announce, captureBody, startCamera]
  );

  const requestDeleteProfile = useCallback((slot: string) => {
    // Match a named profile if given; otherwise default to the active one
    // ("delete my profile" / "delete this account").
    const target = (slot ? getProfiles().find((p) => p.name.toLowerCase() === slot.toLowerCase()) : null) ?? getActiveProfile();
    if (!target) {
      announce("I couldn't find that profile. Say, delete, and the name.");
      return;
    }
    setPendingDeleteId(target.id);
    pendingDeleteRef.current = target.id;
    announce(`Delete the profile ${target.name}? Say yes to confirm, or no to keep it.`);
  }, [announce]);

  // Confirm a pending deletion from a tap. Mirrors the spoken "yes" path: if the
  // deleted profile was the active one, drop back to the auth page.
  const confirmDeleteActive = useCallback(() => {
    const id = pendingDeleteRef.current ?? getActiveProfileId();
    if (!id) return;
    const nm = getProfiles().find((p) => p.id === id)?.name;
    deleteProfile(id);
    setPendingDeleteId(null);
    pendingDeleteRef.current = null;
    setProfiles(getProfiles());
    if (!getActiveProfileId()) {
      announce(`Deleted ${nm}. Who's getting ready?`);
      switchProfileRef.current();
    } else announce(`Deleted ${nm}.`);
  }, [announce]);

  const goTo = useCallback((target: string) => {
    const t = (target || "").toLowerCase();
    let s: Screen | null = null;
    if (/home/.test(t)) s = "home";
    else if (/camera|capture|mirror|photo|selfie/.test(t)) s = "camera";
    else if (/skin|result|metric/.test(t)) s = "skin";
    else if (/wardrobe|clothes|outfit|try|style|colou?r|season|undertone|get ?ready|ready|dress|look/.test(t)) s = "style";
    else if (/profile|history|progress|check|account/.test(t)) s = "profile";
    else if (t === "next") s = STEPS[Math.min(STEPS.indexOf(screenRef.current) + 1, STEPS.length - 1)];
    else if (t === "back" || t === "previous") s = STEPS[Math.max(STEPS.indexOf(screenRef.current) - 1, 0)];
    if (s) {
      setScreen(s);
      setCaption(`${NAV.find((n) => n.key === s)?.label ?? ""}.`);
    }
  }, []);

  const runDemo = useCallback(() => {
    if (mutedRef.current) {
      setMutedPref(false);
    }
    demoRunningRef.current = true;
    const steps: { text: string; screen: Screen }[] = [
      { text: "Welcome to Poise, your voice-first skincare and fashion assistant. Let me show you around — you can tap, or just speak. Everything works by voice.", screen: "home" },
      { text: "This is the Camera page. When you're framed, say, how do I look, and I'll analyse your skin, or say, what colours suit me, to find your colours.", screen: "camera" },
      { text: "Your skin results land here, on the Skin page — your scores, and where any redness or dryness is. There's no camera here, just your results.", screen: "skin" },
      { text: "On the Style page you'll find your colour palette and your wardrobe. Say, try the olive shirt, or, get me ready for a date, and I'll put a whole look together.", screen: "style" },
      { text: "On your Profile, I keep your check-ins over time, so you can ask, how am I doing, for a progress report.", screen: "profile" },
      { text: "To move around, just say, go to the camera, or, next, or, back. That's it — what would you like to do first?", screen: "home" },
    ];
    let i = 0;
    const next = () => {
      if (!demoRunningRef.current || i >= steps.length) {
        demoRunningRef.current = false;
        resumeListening();
        return;
      }
      const step = steps[i++];
      setScreen(step.screen);
      setCaption(step.text);
      speakingRef.current = true;
      pauseListening();
      speak(step.text, {
        onEnd: () => {
          speakingRef.current = false;
          if (demoRunningRef.current && i < steps.length) setTimeout(next, 350);
          else {
            demoRunningRef.current = false;
            resumeListening();
          }
        },
      });
    };
    next();
  }, [pauseListening, resumeListening, setMutedPref]);

  // --- Framing guidance (camera screens) ---------------------------------

  useEffect(() => {
    if (status !== "ready" || !CAMERA_SCREENS.includes(screen)) {
      setFraming("idle");
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let lastState: Framing | "" = "";
    let lastCue = 0;
    const tick = async () => {
      if (!active) return;
      const video = videoRef.current;
      if (video && video.videoWidth) {
        let box = null;
        try {
          box = await detectFace(video);
        } catch {
          /* ignore */
        }
        let s: Framing;
        if (!box) s = "searching";
        else if (box.width < video.videoWidth * 0.18) s = "far";
        else s = "good";
        setFraming(s);
        const now = Date.now();
        if (!demoRunningRef.current && s !== lastState && !mutedRef.current && !speakingRef.current && statusRef.current === "ready" && now - lastCue > 2600) {
          if (s === "far") {
            say("Come a little closer.");
            lastCue = now;
          } else if (s === "good" && (lastState === "far" || lastState === "searching")) {
            say("You're all set.");
            lastCue = now;
          }
        }
        lastState = s;
      }
      if (active) timer = setTimeout(tick, 650);
    };
    timer = setTimeout(tick, 800);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status, screen, say]);

  // --- Voice intent agent ------------------------------------------------

  const handleTranscript = useCallback(
    async (transcript: string) => {
      const t = transcript.trim();
      if (t.length < 2) return;
      if (DEV) setDebugInfo(`heard: "${t}"`);

      // Pending profile-deletion confirmation intercepts other intents.
      if (pendingDeleteRef.current) {
        if (/\b(yes|confirm|delete it|go ahead|do it|sure|yeah)\b/i.test(t)) {
          const id = pendingDeleteRef.current;
          const nm = getProfiles().find((p) => p.id === id)?.name;
          deleteProfile(id);
          setPendingDeleteId(null);
          pendingDeleteRef.current = null;
          setProfiles(getProfiles());
          if (!getActiveProfileId()) {
            announce(`Deleted ${nm}. Who's getting ready?`);
            switchProfileRef.current();
          } else announce(`Deleted ${nm}.`);
          return;
        }
        if (/\b(no|cancel|stop|keep|don'?t|nope)\b/i.test(t)) {
          setPendingDeleteId(null);
          pendingDeleteRef.current = null;
          announce("Okay, keeping it.");
          return;
        }
      }

      // Waiting for the occasion after "what should I wear?" / "get me ready" —
      // take this reply as the occasion and resume that action.
      if (awaitingOccasionRef.current) {
        if (/\b(cancel|stop|never ?mind|forget it)\b/i.test(t)) {
          setAwaitingOccasion(false);
          awaitingOccasionRef.current = false;
          announce("No problem.");
          return;
        }
        answerOccasion(t);
        return;
      }

      let intent = "none";
      let slot = "";
      try {
        const res = await fetch("/api/poise/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: t }) });
        const data = await res.json();
        intent = data?.intent ?? "none";
        slot = data?.slot ?? "";
      } catch {
        intent = "none";
      }
      if (DEV) setDebugInfo(`heard: "${t}" → ${intent}${slot ? ` (${slot})` : ""}`);
      switch (intent) {
        case "analyze":
          analyze();
          break;
        case "demo":
          runDemo();
          break;
        case "color":
          runColorAnalysis();
          break;
        case "tryon": {
          const g = findGarment(slot || t);
          if (g) runTryOn(g);
          else {
            setScreen("style");
            announce("I couldn't find that one. Try, for example, the navy blazer or the olive shirt.");
          }
          break;
        }
        case "garment_query":
          runGarmentQuery(slot || t);
          break;
        case "add_garment":
          runAddGarment(slot || t);
          break;
        case "changed_clothes":
          runChangedClothes(slot);
          break;
        case "recommend":
          runRecommend(slot);
          break;
        case "delete_profile":
          requestDeleteProfile(slot);
          break;
        case "getready":
          runGetReady(slot);
          break;
        case "wardrobe":
          setScreen("style");
          announce("Here's your style. Say, get me ready for a date, or, try the olive shirt.");
          break;
        case "progress":
          runProgress();
          break;
        case "navigate":
          goTo(slot);
          break;
        case "repeat":
          if (resultRef.current) say(resultRef.current.spokenText);
          else announce("I haven't looked yet. Just ask, how do I look.");
          break;
        case "makeup_on":
          setMakeupPref(true);
          announce("Makeup tips are on.");
          break;
        case "makeup_off":
          setMakeupPref(false);
          announce("Makeup tips are off.");
          break;
        case "camera_on":
          startCamera();
          break;
        case "camera_off":
          say("Okay, camera off.");
          stopCamera();
          break;
        case "voice_male":
          setVoicePref("male");
          announce("Okay, I'll speak in a male voice now.");
          break;
        case "voice_female":
          setVoicePref("female");
          announce("Okay, I'll speak in a female voice now.");
          break;
        case "switch_profile":
          say("Okay, switching profiles.");
          switchProfileRef.current();
          break;
        case "mute":
          setCaption("Voice muted.");
          setMutedPref(true);
          break;
        case "unmute":
          setMutedPref(false);
          announce("Okay, I'll speak again.");
          break;
        default:
          break;
      }
    },
    [analyze, announce, say, setMakeupPref, setMutedPref, setVoicePref, startCamera, stopCamera, runProgress, runColorAnalysis, runTryOn, runGetReady, goTo, runDemo, runGarmentQuery, runAddGarment, runChangedClothes, runRecommend, answerOccasion, requestDeleteProfile]
  );
  useEffect(() => void (handleRef.current = handleTranscript), [handleTranscript]);

  // --- Voice trigger -----------------------------------------------------

  const stopVoice = useCallback(() => {
    setVoiceOn(false);
    voiceOnRef.current = false;
    recognizerRef.current?.abort();
    recognizerRef.current = null;
    setListening(false);
  }, []);
  const startVoice = useCallback(() => {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      announce("Voice control needs a secure connection. Please open the app at localhost, not a network address.");
      return;
    }
    if (!supportsSTT()) {
      announce("Voice control isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    const rec = createRecognizer({
      onResult: (transcript) => {
        if (statusRef.current === "analyzing" || demoRunningRef.current) return;
        handleRef.current(transcript);
      },
      onEnd: () => {
        if (voiceOnRef.current && !speakingRef.current) {
          setTimeout(() => {
            try {
              recognizerRef.current?.start();
              setListening(true);
            } catch {
              /* already started */
            }
          }, 300);
        } else setListening(false);
      },
      onError: (e) => {
        if (DEV) setDebugInfo(`voice error: ${e}`);
        if (e === "not-allowed" || e === "service-not-allowed") {
          voiceOnRef.current = false;
          setVoiceOn(false);
          setListening(false);
          announce("I need microphone permission for voice control. Please allow the mic and turn voice on again.");
        }
      },
    });
    if (!rec) return;
    recognizerRef.current = rec;
    setVoiceOn(true);
    voiceOnRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      /* noop */
    }
  }, [announce]);

  const welcome = useCallback(() => {
    if (welcomedRef.current) return;
    welcomedRef.current = true;
    setScreen("home");
    announce(
      "Welcome to Poise, your skincare and fashion assistant. How can I help you today? You can ask me for a demo, or jump straight into the actions."
    );
  }, [announce]);

  const beginFromOnboarding = useCallback(
    async (usesMakeup: boolean) => {
      setMakeupPref(usesMakeup);
      firstRunRef.current = false;
      pset("onboarded", "1");
      setShowOnboarding(false);
      await startCamera();
      if (supportsSTT()) startVoice();
      welcome();
    },
    [setMakeupPref, startCamera, startVoice, welcome]
  );

  // Auto-start once a profile is active (not gated).
  useEffect(() => {
    if (gated || autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (firstRunRef.current) setShowOnboarding(true);
    else
      void (async () => {
        await startCamera();
        if (supportsSTT()) startVoice();
        welcome();
      })();
  }, [gated, startCamera, startVoice, welcome]);

  // Live weather + air quality (for context-aware styling).
  useEffect(() => {
    if (gated || weatherRef.current || typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`/api/poise/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
          const data = await res.json();
          if (data.ok) setWeather(data);
        } catch {
          /* ignore */
        }
      },
      () => {
        /* permission denied — styling still works without weather */
      },
      { timeout: 8000, maximumAge: 600000 }
    );
  }, [gated]);

  // --- Profile gate actions ----------------------------------------------

  const chooseProfile = useCallback(
    (id: string) => {
      setActiveProfile(id);
      const p = getActiveProfile();
      setActiveName(p?.name ?? "");
      setActiveHue(p?.hue ?? 330);
      setNewName("");
      newNameRef.current = "";
      loadProfileData();
      setGated(false);
    },
    [loadProfileData]
  );
  const createAndChoose = useCallback(() => {
    const p = createProfile(newName);
    setProfiles(getProfiles());
    setNewName("");
    setActiveName(p.name);
    setActiveHue(p.hue);
    loadProfileData();
    setGated(false);
  }, [newName, loadProfileData]);
  const switchProfile = useCallback(() => {
    stopVoice();
    autoStartedRef.current = false;
    welcomedRef.current = false;
    setNewName("");
    newNameRef.current = "";
    setProfiles(getProfiles());
    setGated(true);
  }, [stopVoice]);
  useEffect(() => void (switchProfileRef.current = switchProfile), [switchProfile]);

  // Voice-accessible auth: interpret a spoken name into sign-in / create.
  // Spelling-based sign-in: the user spells their name letter by letter, then
  // says "done". Far more reliable than recognising a whole name.
  const finalizeSpelledName = useCallback(() => {
    const name = newNameRef.current.trim();
    if (!name) {
      if (!mutedRef.current) speak("I don't have a name yet. Spell it out, one letter at a time.");
      return;
    }
    const existing = getProfiles().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      chooseProfile(existing.id);
      return;
    }
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    const p = createProfile(cap);
    setProfiles(getProfiles());
    setActiveName(p.name);
    setActiveHue(p.hue);
    loadProfileData();
    setGated(false);
  }, [chooseProfile, loadProfileData]);

  const handleGateVoice = useCallback(
    (transcript: string) => {
      const s = transcript.trim().toLowerCase();
      if (!s) return;
      if (/\b(done|finished|finish|that'?s it|complete|submit|confirm|enter|go ahead)\b/.test(s)) {
        finalizeSpelledName();
        return;
      }
      if (/\b(clear|reset|start over|erase)\b/.test(s)) {
        setNewName("");
        newNameRef.current = "";
        if (!mutedRef.current) speak("Cleared. Spell your name again.");
        return;
      }
      if (/\b(delete|backspace|remove|undo)\b/.test(s)) {
        setNewName((prev) => {
          const n = prev.slice(0, -1);
          newNameRef.current = n;
          return n;
        });
        return;
      }
      let add = "";
      for (const tok of s.split(/[\s,.\-_]+/).filter(Boolean)) add += resolveLetter(tok);
      if (add) {
        setNewName((prev) => {
          const n = (prev + add).slice(0, 24);
          newNameRef.current = n;
          return n;
        });
      }
    },
    [finalizeSpelledName]
  );
  useEffect(() => void (gateHandlerRef.current = handleGateVoice), [handleGateVoice]);

  useEffect(() => {
    if (!gated || !supportsSTT()) return;
    let gateRec: Recognizer | null = null;
    gateRec = createRecognizer({
      onResult: (t) => gateHandlerRef.current(t),
      onEnd: () => {
        if (gatedRef.current && gateRec)
          setTimeout(() => {
            try {
              gateRec?.start();
            } catch {
              /* already started */
            }
          }, 300);
      },
      onError: () => {},
    });
    if (!gateRec) return;
    try {
      gateRec.start();
    } catch {
      /* noop */
    }
    const timer = setTimeout(() => {
      if (gatedRef.current && !mutedRef.current)
        speak(
          getProfiles().length
            ? "Who's getting ready? Spell your name letter by letter, then say done. Or tap your profile."
            : "Welcome to Poise. Spell your name letter by letter, then say done."
        );
    }, 500);
    return () => {
      clearTimeout(timer);
      gateRec?.abort();
    };
  }, [gated]);

  // --- UI ----------------------------------------------------------------

  const cameraShown = CAMERA_SCREENS.includes(screen);
  const pill = (active: boolean) =>
    `inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold transition-colors ${
      active ? "bg-pinkdeep text-white shadow-[0_3px_0_0_#c9457c]" : "bg-white text-plum ring-1 ring-blush2 hover:ring-pink"
    }`;
  const bigButton =
    "w-full cursor-pointer rounded-full bg-gradient-to-b from-pink to-pinkdeep px-6 py-4 text-xl font-extrabold text-white shadow-[0_5px_0_0_#c9457c] transition-all hover:brightness-105 active:translate-y-1 active:shadow-[0_2px_0_0_#c9457c] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none";
  const busy = status === "analyzing" || status === "starting";
  const avatar = (name: string, hue: number, size = 40) => (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white"
      style={{ width: size, height: size, background: `hsl(${hue} 70% 62%)`, fontSize: size * 0.42 }}
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
  const weatherChip = weather ? (
    <div className="inline-flex flex-wrap items-center justify-center gap-1.5 self-center rounded-full bg-white/85 px-3 py-1.5 text-xs font-semibold text-plum ring-1 ring-white">
      <span>
        {weather.tempC}°C · {weather.condition}
      </span>
      {weather.city && <span className="text-plumsoft">· {weather.city}</span>}
      {weather.aqi != null && <span className="text-plumsoft">· air {weather.aqiLabel}</span>}
      {weather.uv >= 6 && <span className="text-pinkdeep">· high UV</span>}
    </div>
  ) : null;

  // --- Profile gate (auth) ---
  if (gated) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-md cursor-default select-none flex-col items-center justify-center px-6">
        <div style={{ animation: "poise-fade-up .5s ease both" }} className="w-full text-center">
          <h1 className="inline-flex items-center gap-2 text-5xl font-extrabold tracking-[0.14em] text-plum">
            POISE <HeartIcon size={24} className="text-pinkdeep" />
          </h1>
          <p className="mt-2 text-plumsoft">Who&apos;s getting ready?</p>
        </div>
        <div style={{ animation: "poise-fade-up .5s ease both", animationDelay: ".1s" }} className="mt-8 flex w-full flex-col gap-3">
          {profiles.map((p) => (
            <button key={p.id} onClick={() => chooseProfile(p.id)} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/85 p-3 text-left font-bold text-plum shadow-[0_10px_28px_-18px_rgba(236,92,146,0.5)] ring-1 ring-white hover:ring-pink">
              {avatar(p.name, p.hue)}
              {p.name}
            </button>
          ))}
          <div className="mt-2 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createAndChoose();
              }}
              placeholder="Type, or spell aloud"
              aria-label="Your name"
              className="flex-1 rounded-full bg-white px-4 py-3 font-semibold capitalize text-plum outline-none ring-1 ring-blush2 focus:ring-pink"
            />
            <button onClick={createAndChoose} className="cursor-pointer rounded-full bg-gradient-to-b from-pink to-pinkdeep px-5 py-3 font-extrabold text-white shadow-[0_4px_0_0_#c9457c]">
              {profiles.length ? "Add" : "Start"}
            </button>
          </div>
          <p className="mt-1 inline-flex items-center justify-center gap-1.5 self-center text-sm font-semibold text-pinkdeep">
            <MicIcon size={15} /> …or spell your name aloud, then say &quot;done&quot;
          </p>
        </div>
        <p className="mt-6 text-center text-xs text-plumsoft/70">Your skin, colours, wardrobe and history stay with your profile on this device.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md cursor-default select-none flex-col">
      {/* Onboarding */}
      {showOnboarding && (
        <div role="dialog" aria-modal="true" aria-label="Welcome" className="fixed inset-0 z-50 flex items-center justify-center bg-plum/40 p-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[1.8rem] bg-white p-6 text-center shadow-2xl">
            <h2 className="inline-flex items-center gap-2 text-2xl font-extrabold tracking-[0.12em] text-plum">
              Hi {activeName} <HeartIcon size={18} className="text-pinkdeep" />
            </h2>
            <p className="mt-3 text-plumsoft">I&apos;m your honest mirror and stylist. Ask me by voice — like &quot;how do I look&quot; or &quot;get me ready for a date&quot;.</p>
            <p className="mt-5 text-lg font-bold text-plum">Do you use makeup?</p>
            <p className="mt-1 text-sm text-plumsoft">So I only suggest tips that fit you.</p>
            <div className="mt-4 flex gap-3">
              <button onClick={() => beginFromOnboarding(false)} className="flex-1 cursor-pointer rounded-full bg-white px-4 py-3 font-bold text-plum ring-2 ring-blush2 hover:ring-pink">
                No
              </button>
              <button onClick={() => beginFromOnboarding(true)} className="flex-1 cursor-pointer rounded-full bg-gradient-to-b from-pink to-pinkdeep px-4 py-3 font-bold text-white">
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings sheet */}
      {showSettings && (
        <div role="dialog" aria-modal="true" aria-label="Settings" className="fixed inset-0 z-50 flex items-end justify-center bg-plum/40 backdrop-blur-sm sm:items-center" onClick={() => setShowSettings(false)}>
          <div className="w-full max-w-md rounded-t-[1.8rem] bg-white p-6 shadow-2xl sm:rounded-[1.8rem]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-plum">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="cursor-pointer rounded-full px-3 py-1 text-sm font-bold text-plumsoft ring-1 ring-blush2 hover:ring-pink">
                Done
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              {sttAvailable && (
                <button onClick={() => (voiceOn ? stopVoice() : startVoice())} aria-pressed={voiceOn} className={`${pill(voiceOn)} justify-between`}>
                  <span className="inline-flex items-center gap-1.5">{voiceOn ? <MicIcon size={16} /> : <MicOffIcon size={16} />} Voice control</span>
                  <span>{voiceOn ? "On" : "Off"}</span>
                </button>
              )}
              <button onClick={() => setMutedPref(!muted)} aria-pressed={muted} className={`${pill(muted)} justify-between`}>
                <span className="inline-flex items-center gap-1.5">{muted ? <VolumeOffIcon size={16} /> : <VolumeIcon size={16} />} Poise&apos;s voice</span>
                <span>{muted ? "Muted" : "On"}</span>
              </button>
              <button onClick={() => setVoicePref(voice === "female" ? "male" : "female")} className={`${pill(false)} justify-between`}>
                <span className="inline-flex items-center gap-1.5"><VolumeIcon size={16} /> Voice</span>
                <span className="capitalize">{voice}</span>
              </button>
              <button onClick={() => setMakeupPref(!makeupTips)} aria-pressed={makeupTips} className={`${pill(makeupTips)} justify-between`}>
                <span className="inline-flex items-center gap-1.5"><LipstickIcon size={16} /> Makeup tips</span>
                <span>{makeupTips ? "On" : "Off"}</span>
              </button>
              <button onClick={() => (streamRef.current ? stopCamera() : startCamera())} className={`${pill(false)} justify-between`}>
                <span className="inline-flex items-center gap-1.5">{streamRef.current ? <CameraIcon size={16} /> : <CameraOffIcon size={16} />} Camera</span>
                <span>{streamRef.current ? "On" : "Off"}</span>
              </button>
              <button onClick={() => { setShowSettings(false); switchProfile(); }} className={`${pill(false)} justify-between`}>
                <span className="inline-flex items-center gap-1.5"><UserIcon size={16} /> Switch profile</span>
                <span>{activeName}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/60 bg-blush/80 px-5 py-3 backdrop-blur">
        <span className="inline-flex items-center gap-1.5 text-xl font-extrabold tracking-[0.12em] text-plum">
          POISE <HeartIcon size={16} className="text-pinkdeep" />
        </span>
        <div className="flex items-center gap-2">
          {listening && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-pinkdeep ring-1 ring-blush2">
              <span className="h-2 w-2 rounded-full bg-pinkdeep" style={{ animation: "poise-pop 1s infinite" }} /> Listening
            </span>
          )}
          <button onClick={() => setShowSettings(true)} aria-label="Settings" className="cursor-pointer rounded-full bg-white p-2 text-plum ring-1 ring-blush2 hover:ring-pink">
            <GearIcon size={18} />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-4">
        {/* Persistent camera (hidden off camera screens) */}
        <div className={cameraShown ? "mb-4" : "hidden"}>
          <div className="relative aspect-square w-full overflow-hidden rounded-[2rem] border-4 border-white bg-cream shadow-[0_16px_40px_-18px_rgba(236,92,146,0.5)]">
            <video ref={videoRef} playsInline muted aria-hidden="true" className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
            {status === "ready" && cameraShown && (
              <>
                <div className={`pointer-events-none absolute inset-3 rounded-[1.5rem] border-[3px] transition-colors duration-300 ${framing === "good" ? "border-[#7fd6a8]" : framing === "far" ? "border-pinkdeep" : "border-white/45"}`} />
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
                  {framing === "far" && <Chip tone="warn">Come a little closer</Chip>}
                  {framing === "good" && (
                    <Chip tone="good">
                      <CheckIcon size={13} /> You&apos;re all set
                    </Chip>
                  )}
                  {framing === "searching" && <Chip>Looking for your face…</Chip>}
                </div>
              </>
            )}
            {busy && cameraShown && (
              <div className="absolute inset-0 flex items-center justify-center bg-plum/45 backdrop-blur-[2px]">
                <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-5 py-2 text-lg font-bold text-pinkdeep" style={{ animation: "poise-pop 1.1s ease-in-out infinite" }}>
                  <SparkleIcon size={18} /> {status === "starting" ? "Waking up…" : "Looking…"}
                </span>
              </div>
            )}
          </div>
        </div>
        <canvas ref={canvasRef} className="hidden" />

        {/* Caption (persistent). On home the hero leads, so the caption stays an
            sr-only live region; elsewhere it's the visible assistant status box. */}
        <div role="status" aria-live="assertive" aria-atomic="true" className={screen === "home" ? "sr-only" : "rounded-[1.4rem] bg-white/85 p-4 text-center text-base font-medium leading-relaxed text-plum shadow-[0_8px_22px_-16px_rgba(236,92,146,0.55)] ring-1 ring-white"}>
          {status === "result" ? (
            <h2 ref={resultHeadingRef} tabIndex={-1} className="outline-none">
              {caption}
            </h2>
          ) : (
            caption
          )}
        </div>
        {DEV && debugInfo && <p className="mt-2 text-center text-xs text-plumsoft/70">debug: {debugInfo}</p>}

        {/* ---- HOME (hero + quick actions + spoken welcome) ---- */}
        {screen === "home" && (
          <div className="mt-4 flex flex-col gap-5">
            {/* Hero */}
            <div
              style={{ animation: "poise-bounce-in .55s ease both" }}
              className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-pink to-pinkdeep px-6 py-8 text-center text-white shadow-[0_24px_50px_-20px_rgba(236,92,146,0.85)]"
            >
              <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
              <span aria-hidden className="pointer-events-none absolute -bottom-14 -left-10 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
              <span aria-hidden className="pointer-events-none absolute right-6 top-6 text-white/80" style={{ animation: "poise-twinkle 2.4s ease-in-out .3s infinite" }}>
                <SparkleIcon size={16} />
              </span>
              <span aria-hidden className="pointer-events-none absolute left-6 top-10 text-white/70" style={{ animation: "poise-twinkle 2.1s ease-in-out .6s infinite" }}>
                <SparkleIcon size={12} />
              </span>

              <span
                className="relative mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full bg-white text-pinkdeep shadow-[0_14px_30px_-8px_rgba(0,0,0,0.35)]"
                style={{ animation: "poise-float 4s ease-in-out infinite" }}
              >
                <span style={{ animation: "poise-heartbeat 1.8s ease-in-out infinite", display: "inline-flex" }}>
                  <HeartIcon size={34} />
                </span>
              </span>
              <h2 className="relative mt-4 text-[1.7rem] font-extrabold leading-tight">Hi {activeName || "there"}!</h2>
              <p className="relative mx-auto mt-1.5 max-w-xs text-white/90">Your honest mirror &amp; stylist. What would you like to do?</p>
              <span className="relative mt-4 inline-flex items-center gap-2 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/40">
                <MicIcon size={15} /> Just say it, or tap a card below
              </span>
            </div>

            {weatherChip}

            {/* Quick actions */}
            <div style={{ animation: "poise-bounce-in .55s ease both", animationDelay: ".1s" }} className="grid grid-cols-2 gap-3">
              {[
                { label: "How do I look?", sub: "skin check", Icon: CameraIcon, onClick: () => setScreen("camera") },
                { label: "My colours", sub: "what suits me", Icon: SparkleIcon, onClick: () => setScreen(colorProfile ? "style" : "camera") },
                { label: "What to wear", sub: "for any occasion", Icon: ShirtIcon, onClick: () => runRecommend("") },
                { label: "My wardrobe", sub: "saved looks", Icon: HeartIcon, onClick: () => setScreen("style") },
              ].map(({ label, sub, Icon, onClick }) => (
                <button
                  key={label}
                  onClick={onClick}
                  className="group flex flex-col items-start gap-3 rounded-[1.5rem] bg-white p-4 text-left shadow-[0_12px_28px_-20px_rgba(236,92,146,0.7)] ring-1 ring-blush2 transition-all hover:-translate-y-0.5 hover:ring-pink"
                >
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blush2 to-blush text-pinkdeep ring-1 ring-white">
                    <Icon size={20} />
                  </span>
                  <span>
                    <span className="block text-[0.95rem] font-extrabold leading-tight text-plum">{label}</span>
                    <span className="block text-xs text-plumsoft">{sub}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* Demo + voice hint */}
            <button
              onClick={runDemo}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-base font-extrabold text-plum shadow-[0_5px_0_0_#f0c8d8] ring-1 ring-blush2 hover:ring-pink"
            >
              <span style={{ animation: "poise-wiggle 1.2s ease-in-out infinite", display: "inline-flex" }}>
                <PlayIcon size={17} className="text-pinkdeep" />
              </span>
              Give me a quick demo
            </button>
            <p className="text-center text-sm text-plumsoft">…or just say it: &quot;how do I look?&quot; · &quot;get me ready for a party&quot;</p>
          </div>
        )}

        {/* ---- CAMERA (the only capture surface) ---- */}
        {screen === "camera" && (
          <div className="mt-4 flex flex-col gap-3">
            <button onClick={analyze} disabled={busy} className={bigButton}>
              How do I look?
            </button>
            <button
              onClick={runColorAnalysis}
              disabled={busy}
              className="w-full cursor-pointer rounded-full bg-white px-6 py-4 text-xl font-extrabold text-plum shadow-[0_5px_0_0_#f0c8d8] ring-1 ring-blush2 hover:ring-pink disabled:opacity-60"
            >
              What colours suit me?
            </button>
            <p className="text-center text-sm text-plumsoft">Frame your face and outfit in the circle, then tap — or just say it.</p>
          </div>
        )}

        {/* ---- SKIN (results only, no camera) ---- */}
        {screen === "skin" && (
          <div className="mt-4 flex flex-col gap-4">
            <button onClick={() => setScreen("camera")} className={bigButton}>
              {result ? "Scan again" : "Open the camera"}
            </button>
            {result ? (
              <Card label="What Poise measured">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-bold text-plum">What Poise measured</h3>
                  <div className="flex items-center gap-2">
                    {trend !== null && Math.abs(trend) >= 1 && (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${trend > 0 ? "bg-[#e7f9f0] text-[#1f8a5b]" : "bg-blush2 text-pinkdeep"}`}>
                        <TrendUpIcon size={12} className={trend > 0 ? "" : "rotate-180"} />
                        {trend > 0 ? `+${trend}` : trend}
                      </span>
                    )}
                    {typeof result.overall === "number" && (
                      <span className="text-xs font-semibold text-plumsoft">Overall {Math.round(result.overall)}/100{typeof result.skinAge === "number" ? ` · age ${result.skinAge}` : ""}</span>
                    )}
                  </div>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {result.scores.map((s) => {
                    const score = Math.round(s.raw_score);
                    return (
                      <li key={s.type} className="flex items-center gap-3">
                        <span className="w-32 shrink-0 text-sm font-medium text-plum">{CONCERN_LABELS[s.type] ?? s.type}</span>
                        <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-blush2">
                          <span className={`absolute inset-y-0 left-0 rounded-full ${scoreColor(score)}`} style={{ width: `${score}%` }} />
                        </span>
                        <span className="w-7 shrink-0 text-right text-sm font-bold tabular-nums text-plumsoft">{score}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-[11px] text-plumsoft/70">Higher is healthier. Say &quot;suggest me clothes&quot; to style a look next.</p>
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-plumsoft">No skin results yet. Open the camera and say &quot;how do I look?&quot;.</p>
              </Card>
            )}
          </div>
        )}

        {/* ---- STYLE (colours + get-ready + wardrobe, no camera) ---- */}
        {screen === "style" && (
          <div className="mt-4 flex flex-col gap-4">
            {weatherChip}
            {awaitingOccasion && (
              <Card label="What's the occasion?">
                <h3 className="mb-1 text-base font-bold text-plum">What&apos;s the occasion?</h3>
                <p className="mb-3 text-sm text-plumsoft">Tell me and I&apos;ll factor in your colours and today&apos;s weather. Say it, or tap one.</p>
                <div className="flex flex-wrap gap-2">
                  {["work", "a date", "a party", "an interview", "something casual"].map((o) => (
                    <button key={o} onClick={() => answerOccasion(o)} className={pill(false)}>
                      {o}
                    </button>
                  ))}
                </div>
              </Card>
            )}
            <button onClick={() => setScreen("camera")} className={bigButton}>
              {colorProfile ? "Rescan my colours" : "Find my colours"}
            </button>
            {!awaitingOccasion && (
              <button
                onClick={() => runRecommend("")}
                className="w-full cursor-pointer rounded-full bg-white px-6 py-4 text-lg font-extrabold text-plum shadow-[0_5px_0_0_#f0c8d8] ring-1 ring-blush2 hover:ring-pink"
              >
                What should I wear?
              </button>
            )}
            {colorProfile && (
              <Card label="Your colours">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-plum">
                    Your colours: <span className="text-pinkdeep">{colorProfile.season}</span>
                  </h3>
                  <span className="text-xs font-semibold capitalize text-plumsoft">{colorProfile.undertone} · {colorProfile.metals}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {colorProfile.palette.map((s) => (
                    <span key={s.name} className="inline-flex items-center gap-1.5 rounded-full bg-blush/60 py-1 pl-1 pr-3 text-xs font-semibold text-plum">
                      <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: s.hex }} />
                      {s.name}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-plumsoft/70">Go easy on {colorProfile.avoid.join(", ")}.</p>
              </Card>
            )}

            {wardrobe.length > 0 && (
              <Card label="Your wardrobe">
                <h3 className="mb-2 text-base font-bold text-plum">
                  Your wardrobe <span className="font-medium text-plumsoft">({wardrobe.length})</span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {wardrobe.map((g) => (
                    <span key={g.name} className="inline-flex items-center gap-1.5 rounded-full bg-blush/60 py-1 pl-1 pr-1 text-xs font-semibold text-plum">
                      {g.refImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.refImage} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-black/10" />
                      ) : (
                        <span className="h-5 w-5 rounded-full ring-1 ring-black/10" style={{ background: g.colorHex }} />
                      )}
                      <button onClick={() => runGarmentQuery(g.name)} className="cursor-pointer hover:text-pinkdeep" aria-label={`See how I'd look in ${g.name}`}>
                        {g.name}
                      </button>
                      <button onClick={() => removeGarment(g.name)} aria-label={`Remove ${g.name}`} className="cursor-pointer rounded-full px-1.5 text-plumsoft hover:text-pinkdeep">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-plumsoft/70">Say &quot;I&apos;m wearing a white shirt, add it&quot; and I&apos;ll capture the real one. Tap a saved item to try it back on.</p>
              </Card>
            )}

            <Card label="Get me ready">
              <h3 className="mb-1 text-base font-bold text-plum">Get me ready</h3>
              <p className="mb-3 text-sm text-plumsoft">Pick an occasion (or say &quot;get me ready for a date&quot;) and I&apos;ll style a full look.</p>
              <div className="flex flex-wrap gap-2">
                {["a date", "work", "a party", "an interview"].map((o) => (
                  <button key={o} onClick={() => runGetReady(o)} className={pill(false)}>
                    {o}
                  </button>
                ))}
              </div>
              {getReadyGarment && (
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-blush/50 p-3">
                  <span className="h-9 w-9 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: getReadyGarment.colorHex }} />
                  <span className="text-sm font-bold text-plum">Pick: {getReadyGarment.name}</span>
                  <button
                    onClick={() => {
                      const g = CATALOG.find((x) => x.id === getReadyGarment.id);
                      if (g) runTryOn(g);
                    }}
                    className={`ml-auto ${pill(false)}`}
                  >
                    Try it on
                  </button>
                </div>
              )}
            </Card>

            <Card label="Try these on">
              <h3 className="mb-1 text-base font-bold text-plum">Try these on</h3>
              <p className="mb-3 text-xs text-plumsoft">Tap to try on — or say &quot;how would I look in a black shirt&quot; for anything.</p>
              <div className="grid grid-cols-2 gap-2.5">
                {CATALOG.map((g) => (
                  <button key={g.id} onClick={() => runTryOn(g)} className="flex cursor-pointer items-center gap-2 rounded-2xl bg-blush/50 p-2 text-left hover:bg-blush">
                    <span className="h-8 w-8 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: g.colorHex }} />
                    <span className="text-sm font-semibold text-plum">{g.name}</span>
                  </button>
                ))}
              </div>
              {busyLabel && <p className="mt-3 text-center text-sm font-semibold text-pinkdeep">{busyLabel}</p>}
              {renderUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={renderUrl} alt="Virtual try-on result" className="mt-4 w-full rounded-2xl" />
              )}
            </Card>
          </div>
        )}

        {/* ---- PROFILE (account + history) ---- */}
        {screen === "profile" && (
          <div className="mt-4 flex flex-col gap-4">
            <Card label="Profile">
              <div className="flex items-center gap-3">
                {avatar(activeName, activeHue, 48)}
                <div className="flex-1">
                  <p className="text-lg font-extrabold text-plum">{activeName}</p>
                  <p className="text-xs text-plumsoft">{colorProfile ? `${colorProfile.season} · ${colorProfile.undertone} undertone` : "Colours not set yet"}</p>
                </div>
                <button onClick={switchProfile} className={pill(false)}>
                  <UserIcon size={15} /> Switch
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-blush2 pt-3">
                {pendingDeleteId === getActiveProfileId() ? (
                  <>
                    <span className="mr-auto text-xs font-semibold text-plumsoft">Delete this profile and all its data?</span>
                    <button onClick={confirmDeleteActive} className="cursor-pointer rounded-full bg-pinkdeep px-3 py-2 text-xs font-bold text-white">
                      Delete
                    </button>
                    <button onClick={() => { setPendingDeleteId(null); pendingDeleteRef.current = null; }} className="cursor-pointer rounded-full px-3 py-2 text-xs font-bold text-plumsoft ring-1 ring-blush2">
                      Keep
                    </button>
                  </>
                ) : (
                  <button onClick={() => requestDeleteProfile("")} aria-label={`Delete ${activeName}`} className="mr-auto cursor-pointer rounded-full bg-white px-3 py-2 text-xs font-bold text-plumsoft ring-1 ring-blush2 hover:text-pinkdeep hover:ring-pink">
                    Delete profile
                  </button>
                )}
              </div>
            </Card>
            <button onClick={runProgress} className={bigButton}>
              See my progress
            </button>
            {history.length > 0 ? (
              <Card label="Your check-ins over time">
                <h3 className="mb-3 text-base font-bold text-plum">Your check-ins <span className="font-medium text-plumsoft">({history.length})</span></h3>
                <div className="flex h-16 items-end gap-1.5" aria-hidden="true">
                  {history.slice(-12).map((h, i) => (
                    <div key={i} className="flex-1 rounded-t bg-pink/70" style={{ height: `${Math.max(8, Math.min(100, ((h.overall - 40) / 60) * 100))}%` }} title={`${Math.round(h.overall)}/100`} />
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-plumsoft">
                  <span>{new Date(history[0].t).toLocaleDateString()}</span>
                  <span>latest {Math.round(history[history.length - 1].overall)}/100</span>
                </div>
                {progressText && <p className="mt-3 rounded-2xl bg-blush/70 p-3 text-sm leading-relaxed text-plum">{progressText}</p>}
              </Card>
            ) : (
              <Card>
                <p className="text-sm text-plumsoft">No check-ins yet. Ask &quot;how do I look?&quot; a few times and I&apos;ll track how your skin changes over time.</p>
              </Card>
            )}
          </div>
        )}
      </main>

      {/* Bottom nav */}
      <nav aria-label="Sections" className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-white/60 bg-blush/90 px-2 py-1.5 backdrop-blur">
        <div className="flex items-stretch justify-around">
          {NAV.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setScreen(key)}
              aria-current={screen === key}
              className={`flex flex-1 cursor-pointer flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold transition-colors ${screen === key ? "text-pinkdeep" : "text-plumsoft hover:text-plum"}`}
            >
              <Icon size={20} className={screen === key ? "text-pinkdeep" : "text-plumsoft"} />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const cls = tone === "good" ? "bg-[#e7f9f0] text-[#1f8a5b]" : tone === "warn" ? "bg-white text-pinkdeep" : "bg-white/90 text-plumsoft";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold shadow ${cls}`}>{children}</span>;
}
