import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DetectedLanguage } from "./language";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const CHAT_MODEL = "google/gemini-3.8-flash";
const TTS_MODEL = "google/gemini-3.1-flash-tts-preview";

export type ChatReply = {
  ok: boolean;
  reply: string;
  language: DetectedLanguage;
  fallback: boolean;
  mood: "neutral" | "upset";
  saved: { key: string; value: string }[];
  notice?: string;
  model: string;
};

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

const inputSchema = z.object({
  ownerKey: z.string().min(6).max(80),
  displayName: z.string().max(60).default(""),
  language: z.enum(["hi", "hinglish", "en"]),
  messages: z.array(messageSchema).min(1).max(24),
  memories: z.array(z.object({ key: z.string(), value: z.string() })).max(60).default([]),
});

const LANGUAGE_RULES: Record<DetectedLanguage, string> = {
  hi: "Reply ONLY in natural Hindi written in Devanagari script. Do not use English sentences.",
  hinglish:
    "Reply in warm, natural Hinglish (Romanized Hindi mixed with a little English), exactly how young Indians text. Do NOT reply in pure English.",
  en: "Reply in natural, friendly English.",
};

const FALLBACKS: Record<DetectedLanguage, string> = {
  hi: "अभी मैं जवाब नहीं बना पा रही — कनेक्शन में दिक्कत है। थोड़ी देर में फिर कोशिश करो, मैं यहीं हूँ.",
  hinglish: "Abhi main reply nahi bana pa rahi, connection me dikkat hai. Thodi der baad try karo, main yahin hoon.",
  en: "I can't reach my brain right now — there's a connection problem. Try again in a moment, I'm still here.",
};

function buildSystemPrompt(
  language: DetectedLanguage,
  displayName: string,
  memories: { key: string; value: string }[],
) {
  const memoryBlock = memories.length
    ? memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")
    : "- (nothing remembered yet)";
  return [
    "You are C2, a caring, playful AI companion with a warm personality and clear personal boundaries.",
    displayName ? `The person you are talking to is called ${displayName}.` : "",
    LANGUAGE_RULES[language],
    "Keep replies short and spoken-friendly: 1-3 sentences, no markdown, no bullet lists, no emoji spam.",
    "You have long-term memory. Things you already know:",
    memoryBlock,
    "If the person shares a durable fact worth remembering (name, city, job, likes, dislikes, important dates, relationships),",
    'append on its own final line: <<REMEMBER key="short_key" value="the fact">> (max 2 per reply). Never mention this tag out loud.',
    'If the message is disrespectful, sexual, or crosses your boundaries, answer firmly but kindly and append on its own final line: <<MOOD upset>>.',
  ]
    .filter(Boolean)
    .join("\n");
}

function parseTags(raw: string) {
  const saved: { key: string; value: string }[] = [];
  let mood: "neutral" | "upset" = "neutral";
  let text = raw;

  text = text.replace(/<<REMEMBER\s+key="([^"]{1,80})"\s+value="([^"]{1,500})"\s*>>/gi, (_m, key, value) => {
    saved.push({ key: String(key).trim(), value: String(value).trim() });
    return "";
  });
  text = text.replace(/<<MOOD\s+upset\s*>>/gi, () => {
    mood = "upset";
    return "";
  });
  return { text: text.trim(), saved, mood };
}

function gatewayNotice(status: number): string {
  if (status === 401) return "The AI service is not configured correctly (missing key).";
  if (status === 402) return "AI credits are exhausted. Add credits to keep C2 talking.";
  if (status === 429) return "Too many requests right now. Wait a few seconds and try again.";
  if (status === 403) return "This AI model is not available for this workspace.";
  return `The AI service returned an error (${status}).`;
}

export const sendChat = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<ChatReply> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    const base: ChatReply = {
      ok: false,
      reply: FALLBACKS[data.language],
      language: data.language,
      fallback: true,
      mood: "neutral",
      saved: [],
      model: CHAT_MODEL,
    };

    if (!apiKey) {
      return { ...base, notice: "The AI service is not configured (missing key)." };
    }

    let response: Response;
    try {
      response = await fetch(`${GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: buildSystemPrompt(data.language, data.displayName, data.memories) },
            ...data.messages,
          ],
        }),
      });
    } catch {
      return { ...base, notice: "Could not reach the AI service. Check your connection." };
    }

    if (!response.ok) {
      return { ...base, notice: gatewayNotice(response.status) };
    }

    let text = "";
    try {
      const json = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      text = json.choices?.[0]?.message?.content ?? "";
    } catch {
      return { ...base, notice: "The AI service sent an unreadable response." };
    }

    if (!text.trim()) return { ...base, notice: "The AI service returned an empty reply." };

    const parsed = parseTags(text);
    const savedOk: { key: string; value: string }[] = [];
    let notice: string | undefined;

    if (parsed.saved.length) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        for (const item of parsed.saved) {
          const { error } = await supabaseAdmin.from("companion_memories").upsert(
            {
              owner_key: data.ownerKey,
              memory_key: item.key,
              memory_value: item.value,
              source: "auto",
              importance: 2,
            },
            { onConflict: "owner_key,memory_key" },
          );
          // Only report a memory as saved when the write actually succeeded.
          if (!error) savedOk.push(item);
          else notice = "C2 could not save a new memory just now.";
        }
      } catch {
        notice = "C2 could not save a new memory just now.";
      }
    }

    return {
      ok: true,
      reply: parsed.text || FALLBACKS[data.language],
      language: data.language,
      fallback: false,
      mood: parsed.mood,
      saved: savedOk,
      notice,
      model: CHAT_MODEL,
    };
  });

export type SpeechResult = { ok: boolean; audioBase64?: string; mimeType?: string; error?: string };

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        text: z.string().trim().min(1).max(800),
        voice: z.string().trim().min(1).max(40).default("Kore"),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<SpeechResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "The AI voice is not configured." };

    let response: Response;
    try {
      response = await fetch(`${GATEWAY}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: TTS_MODEL,
          contents: [{ role: "user", parts: [{ text: data.text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: data.voice } } },
          },
          stream_format: "audio",
        }),
      });
    } catch {
      return { ok: false, error: "Could not reach the voice service." };
    }

    if (!response.ok) return { ok: false, error: gatewayNotice(response.status) };

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return { ok: false, error: "The voice service returned no audio." };

    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {
      ok: true,
      audioBase64: btoa(binary),
      mimeType: response.headers.get("content-type") ?? "audio/wav",
    };
  });
