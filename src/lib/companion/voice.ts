import { synthesizeSpeech } from "./chat.functions";
import { speechLocale, type DetectedLanguage } from "./language";
import { speechChunks } from "./conversation";
import type { VoiceEngine } from "./settings";

export type SpeakOptions = {
  engine: VoiceEngine; language: DetectedLanguage; geminiVoice: string; sovitsUrl: string;
  deviceFallback?: boolean; freshRequest?: boolean;
};
export type VoiceEvents = {
  onStart?: () => void; onEnd?: () => void; onError?: (message: string) => void;
  onPreparing?: () => void; onFallback?: (message: string) => void;
};
function base64ToBlob(base64: string, mimeType: string) {
  return new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mimeType });
}

/** One owner for all C2 speech. Token invalidation and finalizers prevent overlaps and stale callbacks. */
export class VoiceController {
  private token = 0;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private speaking = false;
  private active = false;
  private end: (() => void) | null = null;
  private cancelPlayback: (() => void) | null = null;
  private abort: AbortController | null = null;
  get isSpeaking() { return this.speaking; }
  get isBusy() { return this.active; }

  async speak(text: string, options: SpeakOptions, events: VoiceEvents = {}) {
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    this.stop();
    const token = ++this.token;
    this.active = true;
    this.end = () => events.onEnd?.();
    events.onPreparing?.();
    const started = () => {
      if (token !== this.token || this.speaking) return;
      this.speaking = true; events.onStart?.();
    };
    try {
      for (const chunk of chunks) {
        if (token !== this.token) return;
        if (options.engine === "browser") { await this.device(chunk, options.language, started); continue; }
        let blob: Blob;
        if (options.engine === "sovits") {
          if (!options.sovitsUrl.trim()) throw new Error("GPT-SoVITS is not configured. Add its server URL in Settings.");
          this.abort = new AbortController();
          const response = await fetch(options.sovitsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: this.abort.signal,
            body: JSON.stringify({ text: chunk, text_language: options.language === "en" ? "en" : "hi" }) });
          if (!response.ok) throw new Error("Could not reach GPT-SoVITS. Check its URL in Settings.");
          blob = await response.blob();
        } else {
          const result = await synthesizeSpeech({ data: { text: chunk, voice: options.geminiVoice, freshRequest: options.freshRequest ?? true } });
          if (token !== this.token) return;
          if (!result.ok || !result.audioBase64) {
            // Do not switch engines after permanent denial/refusal/configuration errors.
            if (options.deviceFallback && result.fallbackAllowed !== false && (!result.status || result.status === 429 || result.status >= 500)) {
              events.onFallback?.(`${result.error ?? "Gemini voice unavailable."} Using device voice for this reply.`);
              await this.device(chunk, options.language, started); continue;
            }
            throw new Error(result.error ?? "Gemini voice failed. Your chat reply is still available.");
          }
          blob = base64ToBlob(result.audioBase64, result.mimeType ?? "audio/wav");
        }
        if (token !== this.token) return;
        await this.playBlob(blob, started);
      }
    } catch (error) {
      if (token === this.token) events.onError?.(error instanceof Error ? error.message : "Voice failed; the chat reply is still available.");
    } finally {
      if (token === this.token) { this.active = false; this.speaking = false; this.releaseUrl(); const end = this.end; this.end = null; end?.(); }
    }
  }

  private device(text: string, language: DetectedLanguage, started: () => void): Promise<void> {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.reject(new Error("Device voice is not available in this browser."));
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const locale = speechLocale(language);
      utterance.lang = locale;
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(v => v.lang.replace("_", "-").toLowerCase() === locale.toLowerCase()) ?? voices.find(v => v.lang.toLowerCase().startsWith(locale.slice(0, 2)));
      if (match) utterance.voice = match;
      utterance.rate = 0.97; utterance.pitch = 1;
      const finish = () => { this.cancelPlayback = null; resolve(); };
      this.cancelPlayback = finish;
      utterance.onstart = started;
      utterance.onend = finish;
      utterance.onerror = () => { this.cancelPlayback = null; reject(new Error("Device voice stopped. Tap to retry; the reply remains in chat.")); };
      window.speechSynthesis.speak(utterance);
    });
  }

  private playBlob(blob: Blob, started: () => void): Promise<void> {
    this.releaseUrl();
    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl); this.audio = audio;
    return new Promise((resolve, reject) => {
      this.cancelPlayback = resolve;
      audio.onplay = started;
      audio.onended = () => { this.cancelPlayback = null; resolve(); };
      audio.onerror = () => { this.cancelPlayback = null; reject(new Error("Voice clip could not play. The text reply remains available.")); };
      void audio.play().catch(() => reject(new Error("Playback blocked. Tap the screen, then retry the voice.")));
    });
  }
  stop() {
    this.token++; this.speaking = false; this.active = false;
    this.abort?.abort(); this.abort = null;
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.onplay = null; this.audio.pause(); this.audio.src = ""; this.audio = null; }
    this.cancelPlayback?.(); this.cancelPlayback = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.releaseUrl(); const end = this.end; this.end = null; end?.();
  }
  private releaseUrl() { if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; } }
  dispose() { this.stop(); }
}
