import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, Send, Settings as SettingsIcon, Trash2, Upload, MessageCircle, Box, Brain, Globe, ChevronDown, ChevronUp, Menu as MenuIcon, Camera, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { AvatarTouchLayer, type TouchResult } from "@/components/avatar/AvatarTouchLayer";
import { ZoneCalibration } from "@/components/avatar/ZoneCalibration";
import { boundaryAllowed, clampZone, estimateBudget } from "@/lib/companion/behavior";
import { InAppBrowser, type BrowserHandle } from "@/components/browser/InAppBrowser";
import { looksLikeCommand, shouldGreet } from "@/lib/companion/browser";
import { classifyCommand } from "@/lib/companion/browser.functions";
import { AvatarVideoPlayer } from "@/components/avatar/AvatarVideoPlayer";
import { ModelStudioSettings } from "@/components/avatar/ModelStudioSettings";
import { DEFAULT_APPEARANCE, DEFAULT_CAMERA, type CameraView, type ModelAppearance, type ModelState } from "@/lib/companion/modelPresentation";
import { ModelStudioViewer } from "@/components/avatar/ModelStudioViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  AVATAR_STATES,
  EXPECTED_ASSET_FILENAMES,
  STATE_LABELS,
  type AvatarState,
} from "@/lib/companion/avatarStates";
import { AvatarVideoStateManager } from "@/lib/companion/AvatarVideoStateManager";
import { sendChat } from "@/lib/companion/chat.functions";
import { detectLanguage, languageLabel, resolveReplyLanguage, type PreferredLanguage } from "@/lib/companion/language";
import {
  clearMemories,
  forgetMemory,
  listMemories,
  saveMemory,
  type MemoryRow,
} from "@/lib/companion/memory.functions";
import { loadSettings, saveSettings, type CompanionSettings, type VoiceEngine } from "@/lib/companion/settings";
import { loadAssetLibrary } from "@/lib/companion/videoAssetStore";
import { BUNDLED_CLIPS } from "@/lib/companion/bundledAssets";
import { VoiceController } from "@/lib/companion/voice";
import { inspectModelUpload, listModelPackages, removeModelPackage, saveModelPackage, type ModelPackage } from "@/lib/companion/modelPackage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "C2 — AI Companion with a live 3D character" },
      {
        name: "description",
        content:
          "C2 is a Hindi/Hinglish AI companion with a portrait 3D character, idle/thinking/talking states, persistent memory and configurable touch boundaries.",
      },
      { property: "og:title", content: "C2 — AI Companion with a live 3D character" },
      {
        property: "og:description",
        content: "Hindi/Hinglish AI companion with a live character, persistent memory and boundary-aware touch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CompanionApp,
});

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; language: string };

function uid() {
  return Math.random().toString(36).slice(2);
}

function CompanionApp() {
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [avatarState, setAvatarState] = useState<AvatarState>("IDLE");
  const [sources, setSources] = useState<Partial<Record<AvatarState, string>>>(BUNDLED_CLIPS);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryReady, setMemoryReady] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState("Waiting for backend");
  const [memoryLastOperation, setMemoryLastOperation] = useState("None yet");
  const [modelPackage, setModelPackage] = useState<ModelPackage | null>(null);
  const [models, setModels] = useState<ModelPackage[]>([]);
  const [modelProgress, setModelProgress] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [modelClips, setModelClips] = useState<string[]>([]);
  const [appearance, setAppearance] = useState<ModelAppearance>(DEFAULT_APPEARANCE);
  const [modelPreview, setModelPreview] = useState<ModelState | null>(null);
  const [cameraReset, setCameraReset] = useState(0);
  const [cameraView, setCameraView] = useState<CameraView>(DEFAULT_CAMERA);
  const [modelRetry, setModelRetry] = useState(0);
  const modelToken = useRef(0);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [showZones, setShowZones] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [listening, setListening] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [chatExpanded, setChatExpanded] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [calibrating, setCalibrating] = useState(false);
  const [commandStatus, setCommandStatus] = useState("");
  const [requests, setRequests] = useState(0);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const sendBusy = useRef(false);
  const searchBusy = useRef(false);
  const assetLoad = useRef(0);
  const browserRef = useRef<BrowserHandle | null>(null);
  const greeted = useRef(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);

  const manager = useRef<AvatarVideoStateManager | null>(null);
  const voice = useRef<VoiceController | null>(null);
  const revokeAssets = useRef<() => void>(() => {});
  const modelBoundaryAt = useRef<number | null>(null);
  const modelTap = useRef<{ x: number; y: number; at: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const log = useCallback((message: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()} · ${message}`, ...prev].slice(0, 60));
  }, []);

  // Settings + state machine + voice: created once, cleaned up on unmount.
  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    saveSettings(loaded);

    const stateManager = new AvatarVideoStateManager();
    manager.current = stateManager;
    const unsubscribe = stateManager.subscribe((next, event) => {
      setAvatarState(next);
      log(`state ${event.from} → ${event.to} (${event.reason})`);
    });
    voice.current = new VoiceController();

    return () => {
      unsubscribe();
      stateManager.dispose();
      voice.current?.dispose();
      recognitionRef.current?.stop();
      voice.current = null;
      manager.current = null;
    };
  }, [log]);

  // Load stored avatar clips.
  const refreshAssets = useCallback(async () => {
    const token = ++assetLoad.current;
    const library = await loadAssetLibrary();
    if (token !== assetLoad.current) { library.revoke(); return; }
    const previous = revokeAssets.current;
    window.setTimeout(previous, 1000);
    revokeAssets.current = library.revoke;
    setSources({ ...BUNDLED_CLIPS, ...library.urls });
  }, []);

  useEffect(() => {
    void refreshAssets().catch(() => toast.error("Device clips could not load. Original clips are still available."));
    let live = true;
    void listModelPackages().then(all => {
      if (!live) return;
      setModels(all);
      const id = localStorage.getItem("c2.activeModel");
      setModelPackage(all.find(item => item.id === id) ?? all[0] ?? null);
    }).catch(() => { if (live) setModelError("Saved 3D model could not be restored."); });
    return () => { live = false; modelToken.current++; assetLoad.current += 1; revokeAssets.current(); };
  }, [refreshAssets]);

  const refreshMemories = useCallback(async (ownerKey: string) => {
    setMemoryReady(false);
    setMemoryStatus("Loading from backend");
    let result;
    try { result = await listMemories({ data: { ownerKey } }); }
    catch { setMemoryStatus("Backend unavailable"); setMemoryLastOperation("Load failed"); toast.error("Memories could not load. Please retry."); return; }
    if (!result.ok) {
      setMemoryStatus("Backend error");
      setMemoryLastOperation("Load failed");
      toast.error(result.error ?? "Could not load memories.");
      return;
    }
    setMemories(result.data ?? []);
    setMemoryReady(true);
    setMemoryStatus("Backend connected");
    setMemoryLastOperation(`Loaded ${result.data?.length ?? 0} memories`);
  }, []);

  useEffect(() => {
    if (settings?.ownerKey) void refreshMemories(settings.ownerKey);
  }, [settings?.ownerKey, refreshMemories]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const update = useCallback((patch: Partial<CompanionSettings>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch, zones: (patch.zones ?? prev.zones).map(clampZone) };
      if (patch.autoSpeak === false) { voice.current?.stop(); manager.current?.setSustained("IDLE", "voice muted"); setVoiceStatus("idle"); }
      saveSettings(next);
      return next;
    });
  }, []);

  const speak = useCallback(
    (text: string, language: "hi" | "hinglish" | "en") => {
      if (!settings || !settings.autoSpeak) return;
      const stateManager = manager.current;
      voice.current?.speak(
        text,
        {
          engine: settings.voiceEngine,
          language,
          geminiVoice: settings.geminiVoice,
          sovitsUrl: settings.sovitsUrl,
        },
        {
          onStart: () => {
            browserRef.current?.pauseMedia();
            setVoiceStatus("speaking");
            stateManager?.setSustained("TALKING", "voice started");
          },
          onEnd: () => {
            setVoiceStatus("idle");
            stateManager?.setSustained("IDLE", "voice ended");
          },
          onError: (message) => {
            setVoiceStatus("error");
            toast.error(message);
          },
        },
      );
    },
    [settings],
  );

  const runCommand = useCallback(async (text: string) => {
    setActiveTab("browser");
    setCommandStatus("Understanding…");
    try {
      const result = await classifyCommand({ data: text });
      if (result.notice) log(`command: ${result.notice}`);
      if (!result.actions.length) { setCommandStatus("Blocked · command samajh nahi aaya"); return false; }
      let last = "";
      for (const action of result.actions) {
        const handle = browserRef.current;
        if (!handle) { setCommandStatus("Failed · browser not ready"); return true; }
        const outcome = await handle.run(action, (step) => setCommandStatus(`${step}…`));
        last = outcome.message;
        log(`command ${action.type}: ${outcome.status} — ${outcome.message}`);
        setCommandStatus(`${outcome.status === "completed" ? "Completed" : outcome.status === "playing" ? "Playing" : outcome.status === "blocked" ? "Blocked" : "Failed"} · ${outcome.message}`);
        if (outcome.status === "failed") break;
      }
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: last, language: "en" }]);
      return true;
    } catch {
      setCommandStatus("Failed · command error");
      return true;
    }
  }, [log]);

  const handleSend = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || !settings || sendBusy.current) return;
      if (!memoryReady) { toast.info("C2 is still loading your memories. Please wait a moment."); return; }
      if (looksLikeCommand(text)) {
        setMessages(prev => [...prev, { id: uid(), role: "user", content: text, language: detectLanguage(text).language }]);
        setInput("");
        sendBusy.current = true;
        try { if (await runCommand(text)) return; } finally { sendBusy.current = false; }
      }
      const resolved = resolveReplyLanguage(text, settings.preferredLanguage);
      const userMessage: ChatMessage = { id: uid(), role: "user", content: text, language: resolved.language };
      const history = [...messages, userMessage];
      setMessages(history);
      setInput("");
      sendBusy.current = true;
      voice.current?.stop();
      setVoiceStatus("idle");
      setThinking(true);
      setRequests((n) => n + 1);
      setInputTokens((n) => n + Math.ceil(history.slice(-12).reduce((a, m) => a + m.content.length, 0) / 3));
      manager.current?.setSustained("THINKING", "generating reply");
      log(`language → ${resolved.language} (${resolved.reason})`);

      try {
        const reply = await sendChat({
          data: {
            ownerKey: settings.ownerKey,
            displayName: settings.displayName,
            language: resolved.language,
            messages: history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
            memories: memories.slice(0, 60).map((m) => ({ key: m.memory_key, value: m.memory_value })),
          },
        });

        setMessages((prev) => [
          ...prev,
          { id: uid(), role: "assistant", content: reply.reply, language: reply.language },
        ]);
        setOutputTokens((n) => n + Math.ceil(reply.reply.length / 3));
        if (reply.notice) toast.warning(reply.notice);
        if (reply.saved.length) {
          toast.success(`Saved to memory: ${reply.saved.map((s) => s.key).join(", ")}`);
          void refreshMemories(settings.ownerKey);
        }
        if (reply.mood === "upset") manager.current?.playTransient("UPSET", 6000, "upset reply");
        setThinking(false);
        if (settings.autoSpeak) speak(reply.reply, reply.language);
        else manager.current?.setSustained("IDLE", "reply shown");
      } catch {
        setThinking(false);
        manager.current?.setSustained("IDLE", "chat failed");
        toast.error("C2 could not answer right now. Please try again.");
      } finally { sendBusy.current = false; }
    },
    [input, settings, thinking, messages, memories, memoryReady, log, refreshMemories, speak, runCommand],
  );

  const handleTouch = useCallback(
    (result: TouchResult) => {
      if (result.triggeredBoundary) {
        voice.current?.stop();
        manager.current?.setSustained("IDLE", "boundary");
        manager.current?.playTransient("PERSONAL_BOUNDARY", 8000, "protected zone touched");
        if (settings?.autoSpeak) speak("Arre, please thoda personal space do. Hum aaram se baat karte hain.", "hinglish");
        log(`boundary triggered by zone: ${result.zone?.label}`);
        return;
      }
      if (result.blockedByCooldown) {
        log("boundary skipped (cooldown)");
        return;
      }
      log(`tap on ${result.zone ? result.zone.label : "open area"}`);
    },
    [log, settings?.autoSpeak, speak],
  );

  const onTransientEnded = useCallback((state: AvatarState) => {
    manager.current?.endTransient(`${state} clip finished`);
  }, []);

  const modelFailed = useCallback((message: string) => {
    setModelError(message); setModelBusy(false); setModelReady(false); log(`3D model: ${message}`);
  }, [log]);
  const modelLoaded = useCallback((id: string, clips: string[]) => {
    setModelReady(true); setModelBusy(false); setModelClips(clips);
    setModelError(null);
    try { localStorage.setItem("c2.activeModel", id); } catch { log("Active model selection could not be saved."); }
    log("3D character rendered");
  }, [log]);
  const selectModel = useCallback((id: string) => {
    modelToken.current++;
    const next = models.find(item => item.id === id);
    if (!next) return;
    setModelPackage(next); setModelError(null); setModelReady(false); setModelClips([]);
    setAppearance(DEFAULT_APPEARANCE); setModelPreview(null);
    setCameraView(DEFAULT_CAMERA);
  }, [models]);
  const importModel = useCallback(async (file: File) => {
    const token = ++modelToken.current;
    setModelBusy(true); setModelError(null);
    try {
      const parsed = await inspectModelUpload(file);
      if (token !== modelToken.current) return;
      setModelPackage(parsed); setModelReady(false); setModelClips([]); setAppearance(DEFAULT_APPEARANCE); setModelPreview(null);
      setCameraView(DEFAULT_CAMERA);
    } catch (error) {
      if (token === modelToken.current) { setModelError(error instanceof Error ? error.message : "Import failed."); setModelBusy(false); }
    }
  }, []);
  useEffect(() => {
    if (!modelPackage || !modelReady || models.some(item => item.id === modelPackage.id)) return;
    const token = modelToken.current;
    void saveModelPackage(modelPackage).then(() => {
      if (token !== modelToken.current) return;
      setModels(prev => [modelPackage, ...prev]);
      toast.success("3D character loaded and saved on this device.");
    }).catch(() => toast.error("Character loaded, but could not be saved on this device."));
  }, [modelPackage, modelReady, models]);
  useEffect(() => {
    if (!modelPreview) return;
    const timer = window.setTimeout(() => setModelPreview(null), 5000);
    return () => window.clearTimeout(timer);
  }, [modelPreview]);

  const lastUserText = useMemo(
    () => [...messages].reverse().find((m) => m.role === "user")?.content ?? "",
    [messages],
  );
  const detection = useMemo(
    () => detectLanguage(input.trim() ? input : lastUserText),
    [input, lastUserText],
  );

  // Greet once per genuine session start/resume (30 min inactivity), not on every refresh.
  useEffect(() => {
    if (!settings || greeted.current) return;
    greeted.current = true;
    const key = "c2.lastActive";
    const last = Number(localStorage.getItem(key)) || null;
    if (shouldGreet(Date.now(), last)) {
      const name = settings.displayName || "Master";
      const text = `Hello ${name}, kaise ho? Kaisa gaya aaj ka din?`;
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: text, language: "hinglish" }]);
      speak(text, "hinglish");
    }
    const touch = () => localStorage.setItem(key, String(Date.now()));
    touch();
    const id = window.setInterval(touch, 60_000);
    return () => window.clearInterval(id);
  }, [settings, speak]);

  const startListening = useCallback(() => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: new () => never; webkitSpeechRecognition?: new () => never })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("This browser can't listen to the microphone. Type instead.");
      return;
    }
    try {
      const recognition = new SpeechRecognition() as unknown as {
        lang: string;
        interimResults: boolean;
        onresult: (event: { results: { 0: { 0: { transcript: string } } } }) => void;
        onerror: (event: { error: string }) => void;
        onend: () => void;
        start: () => void;
        stop: () => void;
      };
      if (recognitionRef.current) return;
      recognitionRef.current = recognition;
      recognition.lang = settings?.preferredLanguage === "en" ? "en-IN" : "hi-IN";
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        void handleSend(transcript);
      };
      recognition.onerror = (event) => {
        setListening(false);
        toast.error(
          event.error === "not-allowed"
            ? "Microphone permission was denied. Allow it in your browser settings."
            : "The microphone stopped. Try again.",
        );
      };
      recognition.onend = () => { setListening(false); recognitionRef.current = null; };
      setListening(true);
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      toast.error("Could not start the microphone.");
    }
  }, [settings?.preferredLanguage, handleSend]);

  if (!settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const budgetEstimate = estimateBudget(inputTokens, outputTokens, settings.inputTokenRate, settings.outputTokenRate, settings.monthlyBudget);
  const missingAssets = AVATAR_STATES.filter((state) => !sources[state]);

  return (
    <div className="c2-app c2-galaxy relative min-h-[100dvh] w-full overflow-x-hidden text-foreground">
      <div className="c2-particles" aria-hidden="true" />
      <Toaster />
      <main className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-md flex-col pb-44 pt-[env(safe-area-inset-top)]">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
        <button type="button" onClick={() => setRailOpen(v => !v)} aria-label={railOpen ? "Hide navigation" : "Show navigation"} aria-expanded={railOpen} className="c2-glass grid h-11 w-11 shrink-0 place-items-center rounded-full transition-transform active:scale-95">
          <MenuIcon className="h-5 w-5" />
        </button>
        <div className="min-w-0 text-center">
          <h1 className="truncate text-base font-semibold tracking-wide">C2</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {STATE_LABELS[avatarState]} · voice {voiceStatus} · {languageLabel(detection.language)}
          </p>
        </div>
        <button type="button" disabled title="Capture is not available yet" aria-label="Capture (not available yet)" className="c2-glass flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm opacity-50">
          <Camera className="h-4 w-4" /><span className="hidden min-[360px]:inline">Capture</span>
        </button>
      </header>
      {commandStatus && <p role="status" className="c2-glass mx-3 mb-2 truncate rounded-full px-3 py-1 text-[11px] text-muted-foreground">Command: {commandStatus}</p>}

      <Tabs value={activeTab} onValueChange={value => { setActiveTab(value); if (value !== "settings") setCalibrating(false); }} className="relative min-w-0 flex-1">
      {railOpen && <TabsList className="c2-glass absolute left-2 top-3 z-30 flex h-auto w-14 flex-col gap-1 rounded-full p-1.5">
        {([
          ["chat", MessageCircle, "Chat"], ["avatar", Box, "Avatar"],
          ["memory", Brain, "Memory"], ["settings", SettingsIcon, "Setup"], ["browser", Globe, "Browser"],
        ] as const).map(([value, Icon, label]) => (
          <TabsTrigger key={value} value={value} aria-label={label} title={label} className="h-11 w-11 rounded-full p-0 text-muted-foreground transition-colors data-[state=active]:bg-primary/40 data-[state=active]:text-foreground data-[state=active]:shadow-none"><Icon className="h-5 w-5" /></TabsTrigger>
        ))}
      </TabsList>}

      <div className={cn("relative aspect-[9/16] overflow-hidden rounded-[2rem] border border-glass-border bg-surface-deep/40 shadow-[var(--shadow-glow)]", railOpen ? "ml-[4.5rem] mr-3" : "mx-3")} onPointerDownCapture={event => {
          if (!modelPackage || !event.isPrimary || (event.target as HTMLElement).closest("button")) { modelTap.current = null; return; }
          modelTap.current = { x: event.clientX, y: event.clientY, at: Date.now() };
        }} onPointerUpCapture={event => {
          const start = modelTap.current; modelTap.current = null;
          if (!start || !settings.touchEnabled || calibrating || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 || Date.now() - start.at > 400) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const zone = settings.zones.find(z => { const x = (event.clientX - rect.left) / rect.width * 100, y = (event.clientY - rect.top) / rect.height * 100; return x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h; });
          if (zone?.protected && settings.protectedZonesEnabled) {
            const allowed = boundaryAllowed(zone, settings.touchEnabled, settings.protectedZonesEnabled, Date.now(), modelBoundaryAt.current, settings.boundaryCooldownMs);
            if (allowed) modelBoundaryAt.current = Date.now();
            handleTouch({ zone, triggeredBoundary: allowed, blockedByCooldown: !allowed });
          }
        }}>
        {modelPackage && !modelError ? <ModelStudioViewer key={`${modelPackage.id}-${modelRetry}`} model={modelPackage} state={modelPreview ?? (listening ? "LISTENING" : avatarState)} appearance={appearance} reset={cameraReset} view={cameraView} onView={setCameraView} onLoaded={modelLoaded} onProgress={setModelProgress} onError={modelFailed} /> : activeTab !== "avatar" ? <AvatarVideoPlayer state={avatarState} sources={sources} onTransientEnded={onTransientEnded} onLog={log} /> : <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"><Box className="h-10 w-10 text-primary/70" /><p className="text-sm font-medium">{modelError ? "Character unavailable" : "Your C2 character"}</p><p className="text-xs text-muted-foreground">{modelError ? "Replace the model below or retry." : "Import a 3D character below"}</p></div>}
        {modelPackage && !modelError && !modelReady && <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-surface-deep/60 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading character · {modelProgress}%</div>}
        {(!modelPackage || modelError) && <AvatarTouchLayer
          enabled={settings.touchEnabled && !calibrating}
          protectedZonesEnabled={settings.protectedZonesEnabled}
          zones={settings.zones}
          cooldownMs={settings.boundaryCooldownMs}
          showZones={showZones && !calibrating}
          onTouch={handleTouch}
        />}
        {calibrating && activeTab === "settings" && <ZoneCalibration zones={settings.zones} onChange={zones => update({ zones })} />}
        {activeTab === "chat" && (
          <div className="c2-glass absolute inset-x-2 bottom-2 z-10 rounded-3xl">
            <Button variant="ghost" className="h-8 w-full justify-between text-xs" aria-expanded={chatExpanded} onClick={() => setChatExpanded(v => !v)}>
              <span>Conversation · {messages.length} messages</span>{chatExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
            {chatExpanded && <div ref={scrollRef} className="max-h-32 space-y-2 overflow-y-auto border-t border-border p-2 text-xs">
              {messages.length === 0 && <span className="text-muted-foreground">C2 se baat karo…</span>}
              {messages.slice(-6).map(message => <p key={message.id} className={message.role === "user" ? "text-accent-foreground" : "text-foreground"}><strong>{message.role === "user" ? "You" : "C2"}: </strong>{message.content}</p>)}
              {thinking && <p>C2 soch rahi hai…</p>}
            </div>}
          </div>
        )}
      </div>

      {missingAssets.length > 0 && (
        <p className="c2-glass mx-4 mt-3 rounded-2xl px-3 py-2 text-xs text-muted-foreground">
          Missing clips: {missingAssets.map(state => EXPECTED_ASSET_FILENAMES[state]).join(", ")}
        </p>
      )}

        <TabsContent value="chat" className="mt-3 space-y-3 px-3">
          <p className="text-[11px] text-muted-foreground">
            Detected: {languageLabel(detection.language)} · confidence {detection.confidence}
            {detection.matched.length ? ` · signals: ${detection.matched.join(", ")}` : ""}
          </p>
        </TabsContent>

        <TabsContent value="avatar" className="mt-3 space-y-3 px-3">
          <ModelStudioSettings models={models} model={modelPackage} busy={modelBusy} progress={modelProgress} ready={modelReady} error={modelError} clips={modelClips} appearance={appearance} preview={modelPreview} view={cameraView} onView={setCameraView} onImport={file => void importModel(file)} onSelect={selectModel} onAppearance={setAppearance} onPreview={setModelPreview} onReset={() => { setCameraView(DEFAULT_CAMERA); setCameraReset(n => n + 1); }} onRetry={() => { setModelError(null); setModelReady(false); setModelRetry(n => n + 1); }} onRemove={() => {
            if (!modelPackage) return;
            const id = modelPackage.id;
            modelToken.current++;
            setModelPackage(null); setModelError(null); setModelReady(false); setModelBusy(false); setModelPreview(null);
            localStorage.removeItem("c2.activeModel");
            void removeModelPackage(id).then(() => setModels(prev => prev.filter(item => item.id !== id))).catch(() => toast.error("The saved model could not be removed. Please retry."));
          }} />
        </TabsContent>

        <TabsContent value="memory" className="mt-3 space-y-3 px-3">
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-3 text-center text-[10px]"><div><span className="block text-muted-foreground">Backend</span>{memoryStatus}</div><div><span className="block text-muted-foreground">Loaded</span>{memories.length}</div><div><span className="block text-muted-foreground">Last operation</span>{memoryLastOperation}</div></div>
          <div className="flex gap-2">
            <Input placeholder="Key (e.g. city)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
            <Input placeholder="Value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
            <Button
              size="sm"
              disabled={memoryBusy}
              onClick={async () => {
                if (!newKey.trim() || !newValue.trim()) return;
                setMemoryBusy(true);
                let result;
                try { result = await saveMemory({ data: { ownerKey: settings.ownerKey, key: newKey.trim(), value: newValue.trim(), source: "manual", importance: 3 } }); }
                catch { setMemoryBusy(false); toast.error("The memory was NOT saved. Please retry."); return; }
                setMemoryBusy(false);
                if (!result.ok) {
                  toast.error(result.error ?? "The memory was NOT saved.");
                  return;
                }
                setNewKey("");
                setNewValue("");
                toast.success("Memory saved.");
                void refreshMemories(settings.ownerKey);
              }}
            >
              Save
            </Button>
          </div>

          <div className="space-y-2">
            {memories.length === 0 && <p className="text-xs text-muted-foreground">No memories stored yet.</p>}
            {memories.map((memory) => (
              <div key={memory.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{memory.memory_key}</p>
                  <p className="text-xs text-muted-foreground">{memory.memory_value}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {memory.source} · updated {new Date(memory.updated_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    let result;
                    try { result = await forgetMemory({ data: { ownerKey: settings.ownerKey, id: memory.id } }); }
                    catch { toast.error("The memory was NOT deleted. Please retry."); return; }
                    if (!result.ok) {
                      toast.error(result.error ?? "The memory was NOT deleted.");
                      return;
                    }
                    toast.success("Memory forgotten.");
                    void refreshMemories(settings.ownerKey);
                  }}
                  aria-label="Forget"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshMemories(settings.ownerKey)}
            >
              Reload from server
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Clear all memories for this device profile?")) return;
                let result;
                try { result = await clearMemories({ data: { ownerKey: settings.ownerKey } }); }
                catch { toast.error("Memories were NOT cleared. Please retry."); return; }
                if (!result.ok) {
                  toast.error(result.error ?? "Memories were NOT cleared.");
                  return;
                }
                toast.success(`Cleared ${result.data?.removed ?? 0} memories.`);
                void refreshMemories(settings.ownerKey);
              }}
            >
              Clear all
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Memory test: save a fact, refresh the page, then ask C2 about it. Your memories are tied to this profile key
            ({settings.ownerKey.slice(0, 12)}…). This is a device profile, not a signed-in account.
          </p>
        </TabsContent>

        <TabsContent value="settings" className="mt-3 space-y-4 px-3">
          <div className="space-y-1">
            <Label>Your name</Label>
            <Input value={settings.displayName} onChange={(e) => update({ displayName: e.target.value })} />
          </div>

          <div className="space-y-1">
            <Label>Preferred language</Label>
            <div className="flex flex-wrap gap-2">
              {(["hinglish", "hi", "en", "auto"] as PreferredLanguage[]).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={settings.preferredLanguage === option ? "default" : "outline"}
                  onClick={() => update({ preferredLanguage: option })}
                >
                  {option === "hinglish" ? "Hinglish" : option === "hi" ? "हिंदी" : option === "en" ? "English" : "Auto"}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Voice</Label>
            <div className="flex flex-wrap gap-2">
              {(["browser", "gemini", "sovits"] as VoiceEngine[]).map((engine) => (
                <Button
                  key={engine}
                  size="sm"
                  variant={settings.voiceEngine === engine ? "default" : "outline"}
                  onClick={() => update({ voiceEngine: engine })}
                >
                  {engine === "browser" ? "Device voice" : engine === "gemini" ? "Gemini voice" : "GPT-SoVITS"}
                </Button>
              ))}
            </div>
            {settings.voiceEngine === "sovits" && (
              <>
                <Input
                  placeholder="https://your-gpt-sovits-server/tts"
                  value={settings.sovitsUrl}
                  onChange={(e) => update({ sovitsUrl: e.target.value })}
                />
                {!settings.sovitsUrl && (
                  <p className="text-[11px] text-destructive">GPT-SoVITS is not configured yet.</p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between">
            <Label>Speak replies out loud</Label>
            <Switch checked={settings.autoSpeak} onCheckedChange={(v) => update({ autoSpeak: v })} />
          </div>

          <div className="flex items-center justify-between">
            <Label>Show touch zones</Label>
            <Switch checked={showZones} onCheckedChange={setShowZones} />
          </div>

          <div className="flex items-center justify-between">
            <Label>Touch interaction</Label>
            <Switch checked={settings.touchEnabled} onCheckedChange={(v) => update({ touchEnabled: v })} />
          </div>

          <div className="flex items-center justify-between">
            <Label>Protected zones (boundary reaction)</Label>
            <Switch
              checked={settings.protectedZonesEnabled}
              onCheckedChange={(v) => update({ protectedZonesEnabled: v })}
            />
          </div>

          <div className="space-y-1">
            <Label>Boundary cooldown: {(settings.boundaryCooldownMs / 1000).toFixed(0)}s</Label>
            <Slider
              value={[settings.boundaryCooldownMs]}
              min={2000}
              max={30000}
              step={1000}
              onValueChange={([value]) => update({ boundaryCooldownMs: value ?? 8000 })}
            />
          </div>

          <Button variant="outline" size="sm" onClick={() => { setCalibrating(v => !v); setShowZones(false); }}>
            {calibrating ? "Finish calibration" : "Calibrate touch zones"}
          </Button>

          {settings.zones.map((zone, index) => (
            <div key={zone.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{zone.label}</p>
                <Switch
                  checked={zone.protected}
                  onCheckedChange={(v) => {
                    const zones = settings.zones.map((z, i) => (i === index ? { ...z, protected: v } : z));
                    update({ zones });
                  }}
                />
              </div>
              {(["x", "y", "w", "h"] as const).map((axis) => (
                <div key={axis} className="mt-2">
                  <Label className="text-[11px] uppercase">
                    {axis}: {zone[axis]}%
                  </Label>
                  <Slider
                    value={[zone[axis]]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([value]) => {
                      const zones = settings.zones.map((z, i) => (i === index ? { ...z, [axis]: value ?? z[axis] } : z));
                      update({ zones });
                    }}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="space-y-2 border-t border-border pt-4">
            <h2 className="text-sm font-semibold">C2 usage · this device</h2>
            <p className="text-xs text-muted-foreground">{requests} requests · approximately {(inputTokens + outputTokens).toLocaleString()} text tokens this session. Estimates include visible text only; system instructions, memory and voice usage are not counted.</p>
            <Label htmlFor="budget">Your monthly budget (USD, 0 = unset)</Label>
            <Input id="budget" type="number" min="0" step="0.01" value={settings.monthlyBudget || 0} onChange={e => update({ monthlyBudget: Math.max(0, Number(e.target.value) || 0) })} />
            <Label htmlFor="input-rate">Input rate (USD / 1M tokens, 0 = unknown)</Label>
            <Input id="input-rate" type="number" min="0" step="0.01" value={settings.inputTokenRate} onChange={e => update({ inputTokenRate: Math.max(0, Number(e.target.value) || 0) })} />
            <Label htmlFor="output-rate">Output rate (USD / 1M tokens, 0 = unknown)</Label>
            <Input id="output-rate" type="number" min="0" step="0.01" value={settings.outputTokenRate} onChange={e => update({ outputTokenRate: Math.max(0, Number(e.target.value) || 0) })} />
            <p className="text-xs text-muted-foreground">{budgetEstimate ? `Estimated text cost: $${budgetEstimate.used.toFixed(6)} · budget remaining: ${budgetEstimate.remaining === null ? "unset" : "$" + budgetEstimate.remaining.toFixed(6)}` : "Estimated text cost and budget remaining: unavailable until both token rates are entered."}</p>
            <p className="text-xs text-muted-foreground">Based on your rates and this session only; excludes voice, memory and system instructions. Actual provider billing, quota and Lovable workspace credits: unavailable. This budget is not a spending limit.</p>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-medium">Diagnostics</p>
            <div className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-muted-foreground">
              {logs.length === 0 && <p>No events yet.</p>}
              {logs.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </div>
          </div>
        </TabsContent>
        <div className={activeTab === "browser" ? "c2-glass mx-3 mt-3 h-[70dvh] overflow-hidden rounded-3xl" : "hidden"}>
          <InAppBrowser ref={browserRef} onLog={log} />
        </div>
      </Tabs>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex justify-center">
          <button
            type="button"
            onClick={() => listening ? recognitionRef.current?.stop() : startListening()}
            aria-label={listening ? "Stop listening" : "Speak to C2"}
            aria-pressed={listening}
            className={cn("c2-mic grid h-16 w-16 place-items-center rounded-full text-primary-foreground transition-transform duration-200 active:scale-95", listening && "c2-mic-live")}
          >
            <Mic className="h-7 w-7" />
          </button>
        </div>
        <div className="c2-glass flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5">
          <MessageCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onFocus={() => { if (activeTab !== "chat" && activeTab !== "browser") setActiveTab("chat"); }}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void handleSend(); } }}
            placeholder="Ask Anything"
            aria-label="Message C2"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {voiceStatus === "speaking" ? (
            <button type="button" onClick={() => voice.current?.stop()} aria-label="Stop C2 speaking" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-colors">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={() => void handleSend()} disabled={thinking || !input.trim()} aria-label="Send" className="c2-mic grid h-10 w-10 shrink-0 place-items-center rounded-full text-primary-foreground transition-opacity disabled:opacity-40">
              {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
