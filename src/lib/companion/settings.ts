import type { PreferredLanguage } from "./language";
import { clampZone } from "./behavior";

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
  proactiveConversation: boolean;
  deviceVoiceFallback: boolean;
  touchEnabled: boolean;
  protectedZonesEnabled: boolean;
  boundaryCooldownMs: number;
  zones: TouchZone[];
  monthlyBudget: number;
  inputTokenRate: number;
  outputTokenRate: number;
};

const KEY = "c2.settings.v2";

export const DEFAULT_ZONES: TouchZone[] = [
  { id: "chest", label: "Chest", x: 37, y: 28, w: 26, h: 10, protected: true },
  { id: "waist", label: "Hip / waist", x: 36, y: 43, w: 28, h: 9, protected: true },
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
  proactiveConversation: true,
  deviceVoiceFallback: true,
  touchEnabled: true,
  // Protected zones stay OFF until the user explicitly enables them.
  protectedZonesEnabled: false,
  boundaryCooldownMs: 8000,
  zones: DEFAULT_ZONES,
  monthlyBudget: 0,
  inputTokenRate: 0,
  outputTokenRate: 0,
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
    zones: (Array.isArray(parsed.zones) && parsed.zones.length ? parsed.zones.filter(zone => zone && zone.id !== "head") : DEFAULT_ZONES).map(clampZone),
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
