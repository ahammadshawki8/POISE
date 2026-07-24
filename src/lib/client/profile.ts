"use client";

/**
 * Lightweight local profile/account system. Everything a user owns — wardrobe,
 * history, colour profile, preferences — is stored under keys namespaced by the
 * active profile id, so switching profiles keeps each person's data linked and
 * separate. (Device-local for now; a cloud backend can slot in behind the same
 * pget/pset API later for cross-device sync.)
 */

export interface Profile {
  id: string;
  name: string;
  hue: number; // avatar colour
}

const PROFILES_KEY = "poise_profiles";
const ACTIVE_KEY = "poise_active_profile";

export function getProfiles(): Profile[] {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveProfiles(p: Profile[]) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function getActiveProfileId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId();
  return getProfiles().find((p) => p.id === id) ?? null;
}
export function setActiveProfile(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
export function createProfile(name: string): Profile {
  const p: Profile = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: (name || "").trim() || "Me",
    hue: Math.floor(Math.random() * 360),
  };
  const all = getProfiles();
  all.push(p);
  saveProfiles(all);
  setActiveProfile(p.id);
  return p;
}
export function deleteProfile(id: string) {
  saveProfiles(getProfiles().filter((p) => p.id !== id));
  if (getActiveProfileId() === id) setActiveProfile(null);
}

// --- namespaced per-profile storage ------------------------------------
function ns(key: string): string {
  const id = getActiveProfileId() ?? "guest";
  return `poise:${id}:${key}`;
}
export function pget(key: string): string | null {
  try {
    return localStorage.getItem(ns(key));
  } catch {
    return null;
  }
}
export function pset(key: string, val: string) {
  try {
    localStorage.setItem(ns(key), val);
  } catch {
    /* ignore */
  }
}
