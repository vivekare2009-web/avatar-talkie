import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { parseCommandLocally, sanitizeActions, validateUrl, type BrowserAction } from "./browser";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";
const MODEL = "google/gemini-3.8-flash";

const SYSTEM = `You convert a user's command for an in-app browser into JSON actions. The user may write Romanized Hindi, Hinglish, Devanagari Hindi or English, and may start with "C2".
Allowed actions (max 4, in order):
{"type":"open_site","site":"youtube|google|x|wikipedia|instagram|facebook"}
{"type":"open_url","url":"https://..."}  (only a URL the user actually wrote)
{"type":"search","engine":"google|youtube","query":"..."}
{"type":"play_youtube","query":"song or video name"}
{"type":"back"} {"type":"forward"} {"type":"refresh"} {"type":"home"}
Examples: "C2 YouTube kholo aur Kaho Na Kaho laga do" -> [open_site youtube, play_youtube "Kaho Na Kaho"]. "Google pe weather search karo" -> [search google "weather"]. "Twitter kholo" -> [open_site x].
If it is not a browser command, return an empty actions array. Never invent URLs or video IDs.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["actions"],
  properties: {
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "site", "url", "engine", "query"],
        properties: {
          type: { type: "string", enum: ["open_site", "open_url", "search", "play_youtube", "back", "forward", "refresh", "home"] },
          site: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
          engine: { type: ["string", "null"] },
          query: { type: ["string", "null"] },
        },
      },
    },
  },
};

export type ClassifyResult = { actions: BrowserAction[]; source: "ai" | "local"; notice?: string | undefined };

export const classifyCommand = createServerFn({ method: "POST" })
  .inputValidator((text: string) => z.string().trim().min(1).max(500).parse(text))
  .handler(async ({ data }): Promise<ClassifyResult> => {
    const local = (notice: string): ClassifyResult => ({ actions: parseCommandLocally(data), source: "local", notice });
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) return local("AI command understanding is not configured; used the built-in parser.");
    try {
      const res = await fetch(`${GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: data }],
          response_format: { type: "json_schema", json_schema: { name: "browser_actions", strict: true, schema } },
        }),
      });
      if (!res.ok) return local(`AI command service returned ${res.status}; used the built-in parser.`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(content.replace(/^```(json)?|```$/g, "").trim()) as { actions?: unknown };
      const actions = sanitizeActions(
        (Array.isArray(parsed.actions) ? parsed.actions : []).map((a) =>
          Object.fromEntries(Object.entries(a as object).filter(([, v]) => v !== null)),
        ),
      );
      // Reject URLs the user never typed (classifier must not invent links).
      const safe = actions.filter((a) => a.type !== "open_url" || data.toLowerCase().includes(new URL(a.url).hostname.replace(/^www\./, "")));
      if (!safe.length) return local("AI found no browser action; tried the built-in parser.");
      return { actions: safe, source: "ai" };
    } catch {
      return local("AI command service unavailable; used the built-in parser.");
    }
  });

/** Real YouTube results only: IDs scraped from search and confirmed via oEmbed. */
export const searchYouTube = createServerFn({ method: "GET" })
  .inputValidator((query: string) => z.string().trim().min(2).max(120).parse(query))
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(data)}`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en-IN,hi;q=0.8" },
      });
      if (!response.ok) return { videos: [], error: "YouTube search is unavailable right now." };
      const html = await response.text();
      const ids = [...new Set([...html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"/g)].map((m) => m[1]).filter((id): id is string => Boolean(id)))].slice(0, 8);
      const videos = (await Promise.all(ids.map(async (id) => {
        try {
          const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`);
          if (!r.ok) return null; // oEmbed fails for non-embeddable/removed videos
          const meta = (await r.json()) as { title?: string; author_name?: string };
          return meta.title ? { id, title: meta.title, channel: meta.author_name ?? "YouTube" } : null;
        } catch { return null; }
      }))).filter((v): v is NonNullable<typeof v> => v !== null).slice(0, 6);
      return { videos, error: videos.length ? null : "No embeddable YouTube results found." };
    } catch {
      return { videos: [], error: "YouTube search is unavailable right now." };
    }
  });

/** Check whether a site permits iframe embedding (X-Frame-Options / CSP frame-ancestors). */
export const checkEmbeddable = createServerFn({ method: "POST" })
  .inputValidator((url: string) => z.string().max(2000).parse(url))
  .handler(async ({ data }) => {
    const v = validateUrl(data);
    if (!v.ok) return { embeddable: false, reason: v.reason };
    try {
      const res = await fetch(v.url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
      const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
      const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
      const fa = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim() ?? "";
      if (xfo.includes("deny") || xfo.includes("sameorigin")) return { embeddable: false, reason: "This site blocks being shown inside other apps." };
      if (fa && !fa.split(/\s+/).includes("*")) return { embeddable: false, reason: "This site's security policy blocks in-app display." };
      return { embeddable: true, reason: res.ok ? "" : `Site responded with ${res.status}.` };
    } catch {
      return { embeddable: false, reason: "Could not reach this site." };
    }
  });
