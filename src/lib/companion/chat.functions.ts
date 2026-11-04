import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { DetectedLanguage } from "./language";
import { buildSystemPrompt, parseTags, retryDelay } from "./conversation";

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
  notice?: string | undefined;
  model: string;
  status?: number;
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
  mode: z.enum(["reply", "checkin"]).default("reply"),
  freshRequest: z.boolean().default(true),
});

function gatewayNotice(status: number): string {
  if (status === 401) return "The AI service is not configured correctly (missing key).";
  if (status === 402) return "AI credits are exhausted. Add credits to keep C2 talking.";
  if (status === 429) return "Too many requests right now. Wait a few seconds and try again.";
  if (status === 403) return "This AI model is not available for this workspace.";
  return `The AI service returned an error (${status}).`;
}

async function safeGatewayError(response: Response) {
  try {
    const value = await response.json() as { message?: string; error?: { message?: string; type?: string }; type?: string };
    return { message: (value.message ?? value.error?.message ?? gatewayNotice(response.status)).slice(0, 600), type: value.type ?? value.error?.type ?? "" };
  } catch { return { message: gatewayNotice(response.status), type: "" }; }
}

async function paused(model: string, freshRequest: boolean) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("companion_ai_pause").select("status,reason").eq("model", model).maybeSingle();
  if (error) return { status: 503, reason: "AI access status could not be checked. Please retry manually." };
  // A fresh user request is allowed to test restoration; automation remains parked.
  if (data && !freshRequest) return data;
  return null;
}

async function recordPause(model: string, status: number, reason: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("companion_ai_pause").upsert({ model, status, reason, paused_at: new Date().toISOString() });
  if (error) throw new Error("AI pause could not be saved");
}

async function clearPause(model: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("companion_ai_pause").delete().eq("model", model);
}

/** One status-aware retry layer, never replay a denial or a partially read reply. */
async function gatewayFetch(url: string, init: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try { response = await fetch(url, init); }
    catch { throw new Error("Could not reach the AI service. Check your connection and retry manually."); }
    if (response.ok) return response;
    const delay = retryDelay(response.status, attempt, response.headers.get("Retry-After"));
    if (delay === null) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

export const sendChat = createServerFn({ method: "POST" })
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<ChatReply> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    const base: ChatReply = {
      ok: false,
      reply: "",
      language: data.language,
      fallback: true,
      mood: "neutral",
      saved: [],
      model: CHAT_MODEL,
    };

    if (!apiKey) {
      return { ...base, notice: "The AI service is not configured (missing key)." };
    }
    const pause = await paused(CHAT_MODEL, data.freshRequest);
    if (pause) return { ...base, notice: pause.reason, status: pause.status };

    let response: Response;
    try {
      response = await gatewayFetch(`${GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [
            { role: "system", content: buildSystemPrompt(data.language, data.displayName, data.memories, data.mode) },
            ...data.messages,
          ],
        }),
      });
    } catch {
      return { ...base, notice: "Could not reach the AI service. Check your connection." };
    }

    if (!response.ok) {
      const error = await safeGatewayError(response);
      if (response.status === 402 || response.status === 403) await recordPause(CHAT_MODEL, response.status, error.message);
      return { ...base, notice: error.message, status: response.status };
    }

    let text = "";
    try {
      const json = (await response.json()) as {
        choices?: { finish_reason?: string; message?: { content?: string; refusal?: string } }[];
      };
      if (json.choices?.[0]?.message?.refusal || json.choices?.[0]?.finish_reason === "content_filter") return { ...base, status: 422, notice: json.choices?.[0]?.message?.refusal || "The AI service declined this request." };
      text = json.choices?.[0]?.message?.content ?? "";
    } catch {
      return { ...base, notice: "The AI service sent an unreadable response." };
    }

    if (!text.trim()) return { ...base, notice: "The AI service returned an empty reply." };

    const parsed = parseTags(text);
    await clearPause(CHAT_MODEL);
    const savedOk: { key: string; value: string }[] = [];
    let notice: string | undefined;

    if (data.mode === "reply" && parsed.saved.length) {
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
      reply: parsed.text,
      language: data.language,
      fallback: false,
      mood: parsed.mood,
      saved: savedOk,
      notice,
      model: CHAT_MODEL,
    };
  });

export type SpeechResult = { ok: boolean; audioBase64?: string; mimeType?: string; error?: string; status?: number; fallbackAllowed?: boolean };

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((data) =>
    z
      .object({
        text: z.string().trim().min(1).max(800),
        voice: z.string().trim().min(1).max(40).default("Kore"),
        freshRequest: z.boolean().default(true),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<SpeechResult> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return { ok: false, error: "The AI voice is not configured." };
    const pause = await paused(TTS_MODEL, data.freshRequest);
    if (pause) return { ok: false, error: pause.reason, status: pause.status, fallbackAllowed: false };

    let response: Response;
    try {
      response = await gatewayFetch(`${GATEWAY}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: TTS_MODEL,
          contents: [{ role: "user", parts: [{ text: `Read the following text warmly and conversationally, with natural pauses. Speak only the text, preserving its language and wording:\n${data.text}` }] }],
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

    if (!response.ok) {
      const error = await safeGatewayError(response);
      if (response.status === 402 || response.status === 403) await recordPause(TTS_MODEL, response.status, error.message);
      return { ok: false, error: error.message, status: response.status, fallbackAllowed: response.status === 429 || response.status >= 500 };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) return { ok: false, error: "The voice service returned no audio." };
    await clearPause(TTS_MODEL);

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
