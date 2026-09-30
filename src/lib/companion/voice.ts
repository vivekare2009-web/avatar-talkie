import { synthesizeSpeech } from "./chat.functions";
import { speechLocale, type DetectedLanguage } from "./language";
import type { VoiceEngine } from "./settings";

export type SpeakOptions = {
  engine: VoiceEngine;
  language: DetectedLanguage;
  geminiVoice: string;
  sovitsUrl: string;
};

export type VoiceEvents = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Owns ALL spoken audio. Only one utterance can play at a time — starting a new
 * one always stops the previous one, so voices never overlap.
 */
export class VoiceController {
  private token = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private speaking = false;

  get isSpeaking() {
    return this.speaking;
  }

  async speak(text: string, options: SpeakOptions, events: VoiceEvents = {}) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    this.stop();
    const myToken = ++this.token;

    const finish = () => {
      if (myToken !== this.token) return;
      this.speaking = false;
      events.onEnd?.();
    };
    const fail = (message: string) => {
      if (myToken !== this.token) return;
      this.speaking = false;
      events.onError?.(message);
      events.onEnd?.();
    };

    if (options.engine === "sovits") {
      if (!options.sovitsUrl.trim()) {
        fail("GPT-SoVITS is not configured. Add its server URL in Settings, or pick another voice.");
        return;
      }
      try {
        const response = await fetch(options.sovitsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, text_language: options.language === "en" ? "en" : "hi" }),
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        const blob = await response.blob();
        if (myToken !== this.token) return;
        this.playBlob(blob, myToken, events, finish, fail);
      } catch {
        fail("Could not reach the GPT-SoVITS server. Check the URL in Settings.");
      }
      return;
    }

    if (options.engine === "gemini") {
      try {
        const result = await synthesizeSpeech({ data: { text: clean, voice: options.geminiVoice } });
        if (myToken !== this.token) return;
        if (!result.ok || !result.audioBase64) {
          fail(result.error ?? "The AI voice failed.");
          return;
        }
        const blob = base64ToBlob(result.audioBase64, result.mimeType ?? "audio/wav");
        this.playBlob(blob, myToken, events, finish, fail);
      } catch {
        fail("The AI voice failed. Switching to the device voice may help.");
      }
      return;
    }

    // Browser speech synthesis
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      fail("This browser has no built-in voice. Choose the AI voice in Settings.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(clean);
    const locale = speechLocale(options.language);
    utterance.lang = locale;
    const voices = window.speechSynthesis.getVoices();
    const match =
      voices.find((v) => v.lang.replace("_", "-") === locale) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(locale.slice(0, 2)));
    if (match) utterance.voice = match;
    utterance.rate = 1;
    utterance.onstart = () => {
      if (myToken !== this.token) return;
      this.speaking = true;
      events.onStart?.();
    };
    utterance.onend = finish;
    utterance.onerror = () => fail("The device voice stopped unexpectedly.");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  private playBlob(
    blob: Blob,
    myToken: number,
    events: VoiceEvents,
    finish: () => void,
    fail: (message: string) => void,
  ) {
    this.releaseUrl();
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    const audio = new Audio(url);
    this.audio = audio;
    audio.onended = finish;
    audio.onerror = () => fail("The voice clip could not be played.");
    audio.onplay = () => {
      if (myToken !== this.token) return;
      this.speaking = true;
      events.onStart?.();
    };
    void audio.play().catch(() => fail("Playback was blocked. Tap the screen once, then try again."));
  }

  stop() {
    this.token += 1;
    this.speaking = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    this.releaseUrl();
  }

  private releaseUrl() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  dispose() {
    this.stop();
  }
}
