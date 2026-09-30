import type { PreferredLanguage } from "./language";

export type TouchZone = {
  id: string;
  label: string;
  /** Percentages of the avatar frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  protected: boolean;
};

export type VoiceEngine = "browser" | "gemini" | "sovits";

export type CompanionSettings = {
  ownerKey: string;
  displayName: string;
  preferredLanguage: PreferredLanguage;
  voiceEngine: VoiceEngine;
  geminiVoice: string;
  sovitsUrl: string;
  autoSpeak: boolean;
  touchEnabled: boolean;
  protectedZonesEnabled: boolean;
  boundaryCooldownMs: number;
  zones: TouchZone[];
};

const KEY = "c2.settings.v2";

export const DEFAULT_ZONES: TouchZone[] = [
  { id: "head", label: "Head pat", x: 34, y: 4, w: 32, h: 14, protected: false },
  { id: "chest", label: "Chest", x: 32, y: 34, w: 36, h: 16, protected: true },
  { id: "waist", label: "Waist", x: 32, y: 56, w: 36, h: 14, protected: true },
];

export function createOwnerKey() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `user_${random}`;
}

export const DEFAULT_SETTINGS: CompanionSettings = {
  ownerKey: "",
  displayName: "",
  // Priority 2: Hinglish/Hindi is the default preference.
  preferredLanguage: "hinglish",
  voiceEngine: "browser",
  geminiVoice: "Kore",
  sovitsUrl: "",
  autoSpeak: true,
  touchEnabled: true,
  // Protected zones stay OFF until the user explicitly enables them.
  protectedZonesEnabled: false,
  boundaryCooldownMs: 8000,
  zones: DEFAULT_ZONES,
};

export function loadSettings(): CompanionSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  let parsed: Partial<CompanionSettings> = {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) parsed = JSON.parse(raw) as Partial<CompanionSettings>;
  } catch {
    parsed = {};
  }
  const merged: CompanionSettings = {
    ...DEFAULT_SETTINGS,
    ...parsed,
    zones: Array.isArray(parsed.zones) && parsed.zones.length ? parsed.zones : DEFAULT_ZONES,
  };
  if (!merged.ownerKey) merged.ownerKey = createOwnerKey();
  return merged;
}

export function saveSettings(settings: CompanionSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("[settings] could not save", error);
  }
}
