import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Home, Loader2, Play, RotateCw, Search, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITES, addressToAction, googleSearchUrl, isEmbeddableKnown, type BrowserAction } from "@/lib/companion/browser";
import { checkEmbeddable, searchYouTube } from "@/lib/companion/browser.functions";

type Video = { id: string; title: string; channel: string };
type Entry =
  | { kind: "home" }
  | { kind: "page"; url: string; embeddable: boolean; reason: string }
  | { kind: "youtube"; query: string; videos: Video[]; error: string | null }
  | { kind: "player"; video: Video };

export type ActionOutcome = { status: "completed" | "playing" | "blocked" | "failed"; message: string };
export type BrowserHandle = {
  run: (action: BrowserAction, onStep: (step: string) => void) => Promise<ActionOutcome>;
  pauseMedia: () => void;
};

const YT_ORIGIN = "https://www.youtube-nocookie.com";

function entryUrl(e: Entry) {
  if (e.kind === "page") return e.url;
  if (e.kind === "youtube") return `https://www.youtube.com/results?search_query=${encodeURIComponent(e.query)}`;
  if (e.kind === "player") return `https://www.youtube.com/watch?v=${e.video.id}`;
  return "";
}

export function InAppBrowser({ ref, onLog }: { ref: Ref<BrowserHandle>; onLog: (m: string) => void }) {
  const [stack, setStack] = useState<Entry[]>([{ kind: "home" }]);
  const [index, setIndex] = useState(0);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [playerState, setPlayerState] = useState<number | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<HTMLIFrameElement | null>(null);
  const playerStateRef = useRef<number | null>(null);
  const stackRef = useRef({ stack, index });
  stackRef.current = { stack, index };
  const current = stack[index] ?? { kind: "home" as const };

  useEffect(() => { setAddress(entryUrl(current)); }, [current]);

  // One listener for YouTube player state; removed on unmount.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YT_ORIGIN || typeof event.data !== "string") return;
      try {
        const msg = JSON.parse(event.data) as { event?: string; info?: { playerState?: number } };
        const s = msg.info?.playerState;
        if (typeof s === "number") { playerStateRef.current = s; setPlayerState(s); if (s === 1) setNeedsTap(false); }
      } catch { /* ignore foreign messages */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const push = useCallback((entry: Entry) => {
    const { stack: s, index: i } = stackRef.current;
    const next = [...s.slice(0, i + 1), entry].slice(-30);
    stackRef.current = { stack: next, index: next.length - 1 };
    setStack(next);
    setIndex(next.length - 1);
  }, []);

  const postPlayer = (func: string) =>
    playerRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), YT_ORIGIN);

  const openUrl = useCallback(async (url: string): Promise<ActionOutcome> => {
    setLoading(true);
    try {
      const known = isEmbeddableKnown(url);
      const check = known === null ? await checkEmbeddable({ data: url }) : { embeddable: known, reason: known ? "" : "This site blocks being shown inside other apps." };
      push({ kind: "page", url, embeddable: check.embeddable, reason: check.reason });
      return check.embeddable
        ? { status: "completed", message: `Opened ${new URL(url).hostname}.` }
        : { status: "blocked", message: `${new URL(url).hostname} can't be shown inside the app (${check.reason}). Use "Open in browser".` };
    } finally { setLoading(false); }
  }, [push]);

  const ytSearch = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const r = await searchYouTube({ data: query });
      const entry: Entry = { kind: "youtube", query, videos: r.videos, error: r.error };
      push(entry);
      return r;
    } catch {
      push({ kind: "youtube", query, videos: [], error: "YouTube search failed." });
      return { videos: [], error: "YouTube search failed." };
    } finally { setLoading(false); }
  }, [push]);

  const verifyPlayback = useCallback(async (): Promise<boolean> => {
    playerStateRef.current = null;
    setPlayerState(null);
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      playerRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1 }), YT_ORIGIN);
      if (playerStateRef.current === 1) return true;
    }
    return false;
  }, []);

  const run = useCallback<BrowserHandle["run"]>(async (action, onStep) => {
    const { stack: s, index: i } = stackRef.current;
    switch (action.type) {
      case "back": if (i === 0) return { status: "failed", message: "Nothing to go back to." }; setIndex(i - 1); stackRef.current.index = i - 1; return { status: "completed", message: "Went back." };
      case "forward": if (i >= s.length - 1) return { status: "failed", message: "Nothing to go forward to." }; setIndex(i + 1); stackRef.current.index = i + 1; return { status: "completed", message: "Went forward." };
      case "refresh": setReloadKey((k) => k + 1); return { status: "completed", message: "Refreshed." };
      case "home": push({ kind: "home" }); return { status: "completed", message: "Browser home." };
      case "open_site": {
        onStep(`Opening ${SITES[action.site].label}`);
        if (action.site === "youtube") { push({ kind: "youtube", query: "", videos: [], error: null }); return { status: "completed", message: "YouTube opened (in-app search view; youtube.com itself can't be embedded)." }; }
        return openUrl(SITES[action.site].url);
      }
      case "open_url": onStep(`Opening ${new URL(action.url).hostname}`); return openUrl(action.url);
      case "search": {
        onStep(`Searching "${action.query}"`);
        if (action.engine === "google") return openUrl(googleSearchUrl(action.query));
        const r = await ytSearch(action.query);
        return r.videos.length ? { status: "completed", message: `Found ${r.videos.length} YouTube results.` } : { status: "failed", message: r.error ?? "No results." };
      }
      case "play_youtube": {
        onStep(`Searching YouTube for "${action.query}"`);
        const r = await ytSearch(action.query);
        const video = r.videos[0];
        if (!video) return { status: "failed", message: r.error ?? "No playable YouTube result found." };
        onStep(`Playing "${video.title}"`);
        setNeedsTap(false);
        push({ kind: "player", video });
        onLog(`youtube: selected real result ${video.id}`);
        const ok = await verifyPlayback();
        if (ok) return { status: "playing", message: `Playing "${video.title}".` };
        setNeedsTap(true);
        return { status: "blocked", message: `"${video.title}" is loaded, but the browser blocked autoplay. Tap Play to start it.` };
      }
    }
  }, [openUrl, push, ytSearch, verifyPlayback, onLog]);

  useImperativeHandle(ref, () => ({
    run,
    pauseMedia: () => { if (playerStateRef.current === 1) postPlayer("pauseVideo"); },
  }), [run]);

  const submitAddress = async () => {
    const a = addressToAction(address);
    if ("error" in a) { onLog(`browser: ${a.error}`); setAddress(a.error); return; }
    await run(a, () => {});
  };

  const external = entryUrl(current);
  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center gap-1 border-b border-border p-1.5">
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Back" disabled={index === 0} onClick={() => void run({ type: "back" }, () => {})}><ArrowLeft className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Forward" disabled={index >= stack.length - 1} onClick={() => void run({ type: "forward" }, () => {})}><ArrowRight className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Refresh" onClick={() => setReloadKey((k) => k + 1)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}</Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="Home" onClick={() => void run({ type: "home" }, () => {})}><Home className="h-4 w-4" /></Button>
        <form className="min-w-0 flex-1" onSubmit={(e) => { e.preventDefault(); void submitAddress(); }}>
          <Input aria-label="Address or search" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Search or type URL" className="h-8 text-xs" inputMode="url" />
        </form>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        {current.kind === "home" && (
          <div className="grid grid-cols-3 gap-2 p-3">
            {(Object.keys(SITES) as (keyof typeof SITES)[]).map((key) => (
              <Button key={key} variant="outline" className="h-14 text-xs" onClick={() => void run({ type: "open_site", site: key }, () => {})}>{SITES[key].label}</Button>
            ))}
            <p className="col-span-3 text-xs text-muted-foreground">Ya C2 ko bolo: "YouTube kholo aur Kaho Na Kaho laga do".</p>
          </div>
        )}
        {current.kind === "page" && (current.embeddable ? (
          <iframe key={`${current.url}-${reloadKey}`} ref={iframeRef} title="In-app page" src={current.url} className="h-full w-full border-0 bg-background" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" onLoad={() => setLoading(false)} />
        ) : (
          <div className="space-y-3 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium"><ShieldAlert className="h-4 w-4 text-destructive" /> Can't show this inside C2</p>
            <p className="text-xs text-muted-foreground">{current.reason} {new URL(current.url).hostname}</p>
            <Button asChild><a href={current.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Open in browser</a></Button>
          </div>
        ))}
        {current.kind === "youtube" && (
          <div className="space-y-2 p-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (typeof q === "string" && q.trim().length >= 2) void ytSearch(q.trim()); }}>
              <Input name="q" defaultValue={current.query} placeholder="Search YouTube" aria-label="Search YouTube" className="h-8 text-xs" />
              <Button size="sm" type="submit" aria-label="Search YouTube"><Search className="h-4 w-4" /></Button>
            </form>
            {current.error && <p role="status" className="text-xs text-destructive">{current.error}</p>}
            {current.videos.map((v) => (
              <button key={v.id} className="grid w-full grid-cols-[96px_minmax(0,1fr)] gap-2 text-left" onClick={() => { setNeedsTap(false); push({ kind: "player", video: v }); }}>
                <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" className="aspect-video w-24 rounded object-cover" loading="lazy" />
                <span className="min-w-0"><span className="line-clamp-2 text-xs">{v.title}</span><span className="block truncate text-[10px] text-muted-foreground">{v.channel}</span></span>
              </button>
            ))}
          </div>
        )}
        {current.kind === "player" && (
          <div className="space-y-2 p-2">
            <iframe key={`${current.video.id}-${reloadKey}`} ref={playerRef} title={current.video.title} className="aspect-video w-full rounded border-0" allow="autoplay; encrypted-media; picture-in-picture"
              src={`${YT_ORIGIN}/embed/${current.video.id}?enablejsapi=1&autoplay=1&playsinline=1&origin=${encodeURIComponent(typeof window === "undefined" ? "" : window.location.origin)}`} />
            <p className="truncate text-xs">{current.video.title}</p>
            <p className="text-[10px] text-muted-foreground">Player: {playerState === 1 ? "playing" : playerState === 2 ? "paused" : playerState === null ? "unknown" : `state ${playerState}`}</p>
            {needsTap && <Button className="w-full" onClick={() => { postPlayer("playVideo"); }}><Play className="mr-1 h-4 w-4" />Play (autoplay was blocked)</Button>}
          </div>
        )}
      </div>
      {external && <a href={external} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 border-t border-border py-1 text-[10px] text-muted-foreground"><ExternalLink className="h-3 w-3" />Open in system browser</a>}
    </div>
  );
}
