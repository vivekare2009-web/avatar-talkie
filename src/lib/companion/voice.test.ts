import { expect, test } from "bun:test";
import { VoiceController } from "./voice";

test("stop completes active speech once and blocks stale overlap", async () => {
  const oldWindow = globalThis.window;
  const oldUtterance = globalThis.SpeechSynthesisUtterance;
  const utterances: { onstart?: (() => void) | null; onend?: (() => void) | null }[] = [];
  let cancellations = 0;
  Object.assign(globalThis, {
    window: { speechSynthesis: { getVoices: () => [], speak: (utterance: { onstart?: (() => void) | null; onend?: (() => void) | null }) => { utterances.push(utterance); utterance.onstart?.(); }, cancel: () => { cancellations++; } } },
    SpeechSynthesisUtterance: class { constructor(public text: string) {} },
  });
  try {
    const voice = new VoiceController(); let ends = 0;
    const options = { engine: "browser" as const, language: "hinglish" as const, geminiVoice: "Kore", sovitsUrl: "" };
    const first = voice.speak("Hi.", options, { onEnd: () => { ends++; } });
    const staleEnd = utterances[0]?.onend;
    expect(voice.isSpeaking).toBe(true);
    const second = voice.speak("Hello.", options, { onEnd: () => { ends++; } });
    expect(ends).toBe(1);
    staleEnd?.();
    expect(voice.isSpeaking).toBe(true);
    voice.stop(); await Promise.all([first, second]);
    expect(voice.isBusy).toBe(false); expect(voice.isSpeaking).toBe(false); expect(ends).toBe(2);
    expect(cancellations).toBeGreaterThanOrEqual(2);
    voice.dispose(); expect(ends).toBe(2);
  } finally { Object.assign(globalThis, { window: oldWindow, SpeechSynthesisUtterance: oldUtterance }); }
});