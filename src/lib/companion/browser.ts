/** Browser-safe helpers for the in-app browser and command router (pure, tested). */

export type BrowserAction =
  | { type: "open_site"; site: SiteKey }
  | { type: "open_url"; url: string }
  | { type: "search"; engine: "google" | "youtube"; query: string }
  | { type: "play_youtube"; query: string }
  | { type: "back" } | { type: "forward" } | { type: "refresh" } | { type: "home" };

export type SiteKey = "youtube" | "google" | "x" | "wikipedia" | "instagram" | "facebook";

export const SITES: Record<SiteKey, { label: string; url: string; embeddable: boolean }> = {
  // Google allows embedding only with igu=1; others send X-Frame-Options/CSP.
  google: { label: "Google", url: "https://www.google.com/webhp?igu=1", embeddable: true },
  youtube: { label: "YouTube", url: "https://www.youtube.com/", embeddable: false },
  x: { label: "X (Twitter)", url: "https://x.com/", embeddable: false },
  wikipedia: { label: "Wikipedia", url: "https://www.wikipedia.org/", embeddable: true },
  instagram: { label: "Instagram", url: "https://www.instagram.com/", embeddable: false },
  facebook: { label: "Facebook", url: "https://www.facebook.com/", embeddable: false },
};

const SITE_ALIASES: [RegExp, SiteKey][] = [
  [/\b(youtube|you tube|yt)\b|यूट्यूब/i, "youtube"],
  [/\b(google)\b|गूगल/i, "google"],
  [/\b(twitter|x\.com|ट्विटर)\b|(^|\s)x(\s|$)/i, "x"],
  [/\b(wikipedia|wiki)\b/i, "wikipedia"],
  [/\b(instagram|insta)\b/i, "instagram"],
  [/\b(facebook|fb)\b/i, "facebook"],
];

/** Accept only http(s) URLs with a real host. Everything else is blocked. */
export function validateUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "Empty address." };
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") {
    // "example.com:8080" looks like a scheme; allow host:port only.
    if (!/^[a-z0-9.-]+\.[a-z]{2,}:\d+/i.test(text)) return { ok: false, reason: `Blocked unsafe link type "${scheme}:".` };
  }
  const candidate = scheme === "http" || scheme === "https" ? text : `https://${text}`;
  let url: URL;
  try { url = new URL(candidate); } catch { return { ok: false, reason: "That is not a valid web address." }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http and https links are allowed." };
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) && url.hostname !== "localhost") return { ok: false, reason: "That address has no valid website name." };
  if (url.username || url.password) return { ok: false, reason: "Links with embedded logins are blocked." };
  return { ok: true, url: url.toString() };
}

/** Address-bar input: a URL when it looks like one, otherwise a Google search. */
export function addressToAction(raw: string): BrowserAction | { error: string } {
  const text = raw.trim();
  if (!text) return { error: "Type an address or search." };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || /^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) {
    const v = validateUrl(text);
    return v.ok ? { type: "open_url", url: v.url } : { error: v.reason };
  }
  return { type: "search", engine: "google", query: text };
}

export function googleSearchUrl(query: string) {
  return `https://www.google.com/search?igu=1&q=${encodeURIComponent(query)}`;
}

export function isEmbeddableKnown(url: string): boolean | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "google.com") return new URL(url).searchParams.get("igu") === "1";
    for (const site of Object.values(SITES)) if (new URL(site.url).hostname.replace(/^www\./, "") === host) return site.embeddable;
    if (host.endsWith("youtube.com") || host === "youtu.be" || host === "twitter.com") return false;
    return null;
  } catch { return null; }
}

/** Cheap pre-filter: only messages that look like commands go to the classifier. */
export function looksLikeCommand(text: string): boolean {
  const t = text.toLowerCase();
  if (/https?:\/\/|\b[a-z0-9-]+\.(com|in|org|net|io|co)\b/.test(t)) return true;
  if (/^\s*(c2[\s,]+)?(back|forward|refresh|reload|home|peeche|aage)\b/.test(t)) return true;
  const verb = /\b(kholo|khol|chalao|chala|open|search|dhundo|dhoondo|khojo|play|laga|lagao|bajao|sunao|kar do|karo)\b|खोलो|चलाओ|लगा|बजाओ/;
  const target = /\b(youtube|you tube|yt|google|twitter|x|website|site|browser|gaana|gana|song|video|wikipedia|insta|instagram|facebook)\b|यूट्यूब|गूगल|गाना/;
  return verb.test(t) && (target.test(t) || /\b(play|bajao|laga do|lagao)\b/.test(t));
}

function stripWake(text: string) {
  return text.replace(/^\s*c2[\s,:-]*/i, "").trim();
}

/** Deterministic parser, used when the AI classifier is unavailable. Never invents results. */
export function parseCommandLocally(raw: string): BrowserAction[] {
  const text = stripWake(raw);
  const t = text.toLowerCase();
  const nav = t.match(/^(back|peeche|forward|aage|refresh|reload|home)\b/);
  if (nav) {
    const k = nav[1];
    return [{ type: k === "back" || k === "peeche" ? "back" : k === "forward" || k === "aage" ? "forward" : k === "home" ? "home" : "refresh" }];
  }
  const urlMatch = text.match(/(https?:\/\/\S+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|in|org|net|io|co)(\/\S*)?)/i);
  if (urlMatch?.[1]) {
    const v = validateUrl(urlMatch[1]);
    return v.ok ? [{ type: "open_url", url: v.url }] : [];
  }
  const site = SITE_ALIASES.find(([re]) => re.test(text))?.[1];
  const filler = /\b(c2|youtube|you tube|yt|browser|google|pe|par|per|me|mein|main|in|on|kholo|khol|chalao|chala|open|aur|and|then|search|karo|kar|do|dhundo|dhoondo|khojo|play|laga|lagao|bajao|sunao|please|plz|gaana|gana|song|the|ko|ki|ka)\b/gi;
  const query = text.replace(filler, " ").replace(/\s+/g, " ").trim();
  const wantsPlay = /\b(play|laga|lagao|bajao|sunao|chalao)\b/i.test(t) && query.length >= 2;
  const wantsSearch = /\b(search|dhundo|dhoondo|khojo)\b/i.test(t) && query.length >= 2;
  if (site === "youtube" && (wantsPlay || wantsSearch)) return [{ type: "open_site", site }, wantsPlay ? { type: "play_youtube", query } : { type: "search", engine: "youtube", query }];
  if (!site && wantsPlay) return [{ type: "play_youtube", query }];
  if (site === "google" && wantsSearch) return [{ type: "search", engine: "google", query }];
  if (!site && wantsSearch) return [{ type: "search", engine: "google", query }];
  if (site) return [{ type: "open_site", site }];
  return [];
}

/** Validate untrusted classifier output into safe actions. */
export function sanitizeActions(input: unknown): BrowserAction[] {
  if (!Array.isArray(input)) return [];
  const out: BrowserAction[] = [];
  for (const item of input.slice(0, 4)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const query = typeof a["query"] === "string" ? a["query"].trim().slice(0, 120) : "";
    switch (a["type"]) {
      case "open_site": if (typeof a["site"] === "string" && a["site"] in SITES) out.push({ type: "open_site", site: a["site"] as SiteKey }); break;
      case "open_url": { const v = validateUrl(String(a["url"] ?? "")); if (v.ok) out.push({ type: "open_url", url: v.url }); break; }
      case "search": if (query && (a["engine"] === "google" || a["engine"] === "youtube")) out.push({ type: "search", engine: a["engine"], query }); break;
      case "play_youtube": if (query) out.push({ type: "play_youtube", query }); break;
      case "back": case "forward": case "refresh": case "home": out.push({ type: a["type"] }); break;
    }
  }
  return out;
}

/** Greet only on a genuine session start/resume, not every refresh. */
export function shouldGreet(now: number, lastActive: number | null, gapMs = 30 * 60_000) {
  return lastActive === null || now - lastActive >= gapMs;
}

/** Speech engines often fire the same final result twice; drop repeats within a window. */
export function isDuplicateTranscript(text: string, last: { text: string; at: number } | null, now: number, windowMs = 2500) {
  const norm = text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return !!last && last.text === norm && now - last.at < windowMs;
}
export function normalizeTranscript(text: string) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
