"use client";

/**
 * Client-side speech (TTS + STT). Poise is voice-first, so we pick the most
 * natural available system voice and let the user choose male/female. Web Speech
 * neural/"Natural"/"Online" voices (Chrome/Edge) sound far better than defaults.
 */

export function supportsTTS(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function supportsSTT(): boolean {
  return (
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
  );
}

export type VoiceGender = "female" | "male";

let cachedVoices: SpeechSynthesisVoice[] = [];
let voiceGender: VoiceGender = "female";

function refreshVoices() {
  if (supportsTTS()) cachedVoices = window.speechSynthesis.getVoices();
}
if (supportsTTS()) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

export function setVoiceGender(g: VoiceGender) {
  voiceGender = g;
}
export function getVoiceGender(): VoiceGender {
  return voiceGender;
}

const FEMALE_HINTS = ["female", "aria", "jenny", "zira", "samantha", "libby", "sonia", "natasha", "clara", "michelle", "eva", "hazel"];
const MALE_HINTS = ["male", "guy", "david", "mark", "daniel", "ryan", "william", "liam", "george", "brian"];
// Higher-quality (neural) system voices usually carry these tokens.
const QUALITY_HINTS = ["natural", "neural", "online", "google"];

function scoreVoice(v: SpeechSynthesisVoice, gender: VoiceGender): number {
  const n = v.name.toLowerCase();
  const hints = gender === "female" ? FEMALE_HINTS : MALE_HINTS;
  const anti = gender === "female" ? MALE_HINTS : FEMALE_HINTS;
  let s = 0;
  if (QUALITY_HINTS.some((h) => n.includes(h))) s += 6;
  if (hints.some((h) => n.includes(h))) s += 10;
  if (anti.some((h) => n.includes(h))) s -= 8;
  if (/en[-_]us/i.test(v.lang)) s += 2;
  else if (/en[-_]gb/i.test(v.lang)) s += 1;
  return s;
}

function pickVoice(gender: VoiceGender): SpeechSynthesisVoice | null {
  if (!cachedVoices.length) refreshVoices();
  const en = cachedVoices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  const pool = en.length ? en : cachedVoices;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => scoreVoice(b, gender) - scoreVoice(a, gender))[0];
}

/** Speaks text aloud with the selected natural voice, cancelling current speech. */
export function speak(text: string, opts?: { rate?: number; onEnd?: () => void }): void {
  if (!supportsTTS()) {
    opts?.onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(voiceGender);
  if (v) u.voice = v;
  u.rate = opts?.rate ?? 1.0;
  u.pitch = voiceGender === "female" ? 1.05 : 0.98; // gentle warmth
  u.lang = v?.lang ?? "en-US";
  if (opts?.onEnd) u.onend = () => opts.onEnd?.();
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (supportsTTS()) window.speechSynthesis.cancel();
}

export interface Recognizer {
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface STTHandlers {
  onResult: (transcript: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export function createRecognizer(handlers: STTHandlers): Recognizer | null {
  if (!supportsSTT()) return null;
  const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const r = new SR();
  r.lang = "en-US";
  r.interimResults = true;
  r.continuous = true;
  r.maxAlternatives = 1;
  r.onresult = (e: any) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) handlers.onResult(String(res[0].transcript));
    }
  };
  r.onerror = (e: any) => handlers.onError?.(String(e.error ?? "unknown"));
  r.onend = () => handlers.onEnd?.();
  return r as Recognizer;
}
