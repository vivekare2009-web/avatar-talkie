import { Upload, Trash2, RotateCcw, Loader2, Box } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModelPackage } from "@/lib/companion/modelPackage";
import { animationForState, cameraPreset, type CameraView, type CameraPreset, type ModelAppearance, type ModelState } from "@/lib/companion/modelPresentation";

export function ModelStudioSettings({ models, model, pending, stage, onCandidate, onCancelCandidate, busy, progress, ready, error, clips, appearance, preview, view, onView, onImport, onSelect, onRemove, onRetry, onReset, onAppearance, onPreview }: {
  pending: ModelPackage | null; stage: string; onCandidate: (path: string) => void; onCancelCandidate: () => void;
  models: ModelPackage[]; model: ModelPackage | null; busy: boolean; progress: number; ready: boolean; error: string | null; clips: string[];
  appearance: ModelAppearance; preview: ModelState | null;
  view: CameraView; onView: (value: CameraView) => void;
  onImport: (file: File) => void; onSelect: (id: string) => void; onRemove: () => void; onRetry: () => void; onReset: () => void;
  onAppearance: (value: ModelAppearance) => void; onPreview: (state: ModelState | null) => void;
}) {
  const upload = useRef<HTMLInputElement>(null);
  const states: ModelState[] = ["IDLE", "THINKING", "LISTENING", "TALKING", "UPSET", "PERSONAL_BOUNDARY"];
  return <section className="space-y-4 rounded-md border border-border/60 bg-card/40 p-3 backdrop-blur-xl" aria-label="3D Model Studio">
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Box className="h-4 w-4 text-primary" />3D Model Studio</h2>
      <Button size="sm" variant="outline" className="bg-secondary/30" disabled={busy} onClick={() => upload.current?.click()}><Upload className="h-3.5 w-3.5" />{model ? "Replace" : "Import"}</Button>
      <input ref={upload} type="file" aria-label="Import 3D model" className="hidden" accept=".zip,.glb,.gltf,.fbx,.pmx,.blend" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onImport(file); }} />
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">GLB, GLTF, FBX or PMX; ZIP folders stay intact. PMX is a private local preview: bones and vertex morphs supported; no VMD or physics. Blender .blend requires export. Maximum 100 MB upload, 150 MB expanded, 200 files. Large textures may exceed phone memory.</p>
    {stage && <p role="status" className="break-words text-xs text-muted-foreground">{stage}</p>}
    {pending && <div className="space-y-2"><Select onValueChange={onCandidate}><SelectTrigger aria-label="Model inside ZIP" className="w-full min-w-0"><SelectValue placeholder="Choose model inside ZIP" /></SelectTrigger><SelectContent>{pending.candidates?.map(candidate => <SelectItem key={candidate.path} value={candidate.path}>{candidate.path}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="ghost" onClick={onCancelCandidate}>Cancel import</Button></div>}
    {!!models.length && <div className="space-y-1.5"><label className="text-xs text-muted-foreground">Active character</label><Select value={model?.id ?? ""} onValueChange={onSelect}><SelectTrigger aria-label="Active character" className="w-full min-w-0 bg-secondary/20"><SelectValue placeholder="Select character" /></SelectTrigger><SelectContent>{models.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>}
    {(busy || model) && <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground" role="status">
      {(!ready && !error) && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
      <span className="min-w-0 break-all">{busy && !model ? "Inspecting package…" : `${model?.name ?? "Inspecting package"} · ${error ? "Not loaded" : ready ? "Loaded in viewport" : `Loading ${progress}%`}`}</span>
    </div>}
    {error && <div role="alert" className="space-y-2 text-xs text-destructive"><p className="break-words">{error}</p><Button variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>}
    {model && <>
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" />Reset camera</Button><Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}><Trash2 className="h-3.5 w-3.5" />Remove</Button></div>
      <div className="space-y-3 border-t border-border/50 pt-3" aria-label="Camera controls">
        <div className="flex flex-wrap gap-1">{(["front", "side", "back", "three-quarter", "close-up", "full-body"] as CameraPreset[]).map(preset => <Button key={preset} size="sm" variant="outline" className="h-9 bg-secondary/20 px-2 text-[11px]" onClick={() => { onReset(); onView(cameraPreset(preset)); }}>{preset === "three-quarter" ? "¾ view" : preset === "close-up" ? "Close-up" : preset === "full-body" ? "Full body" : preset[0]?.toUpperCase() + preset.slice(1)}</Button>)}</div>
        {([['angle', 'Camera angle', -180, 180, 1], ['elevation', 'Camera elevation', -65, 65, 1], ['distance', 'Camera distance', 0.3, 2.5, 0.01]] as const).map(([key, label, min, max, step]) => <div key={key} className="space-y-2"><div className="flex justify-between text-xs"><span>{label}</span><span className="text-muted-foreground">{key === "distance" ? `${Math.round(view[key] * 100)}%` : `${view[key]}°`}</span></div><Slider aria-label={label} value={[view[key]]} min={min} max={max} step={step} onValueChange={([value]) => onView({ ...view, [key]: value ?? view[key] })} /></div>)}
      </div>
      <div className="space-y-3 border-t border-border/50 pt-3">
        {([['scale', 'Character size', 0.7, 1.4, 0.01], ['vertical', 'Vertical position', -0.5, 0.5, 0.01], ['rotation', 'Character rotation', -180, 180, 1]] as const).map(([key, label, min, max, step]) => <div key={key} className="space-y-2"><div className="flex justify-between text-xs"><span>{label}</span><span className="text-muted-foreground">{key === "scale" ? `${Math.round(appearance[key] * 100)}%` : key === "rotation" ? `${appearance[key]}°` : appearance[key].toFixed(2)}</span></div><Slider aria-label={label} value={[appearance[key]]} min={min} max={max} step={step} onValueChange={([value]) => onAppearance({ ...appearance, [key]: value ?? appearance[key] })} /></div>)}
      </div>
      {ready && <div className="space-y-2 border-t border-border/50 pt-3"><div className="flex justify-between text-xs"><span>Character expression</span><Button size="sm" variant="ghost" className="h-5 px-1 text-[10px]" onClick={() => onPreview(null)}>Live</Button></div><div className="flex flex-wrap gap-1">{states.map(state => <Button key={state} variant={preview === state ? "secondary" : "outline"} size="sm" className="h-7 bg-card/30 px-2 text-[10px]" disabled={state !== "IDLE" && !clips.some(name => animationForState([name], state) === name && animationForState([name], "IDLE") !== name)} onClick={() => onPreview(state)}>{state === "PERSONAL_BOUNDARY" ? "Boundary" : state === "TALKING" ? "Response" : state[0] + state.slice(1).toLowerCase()}</Button>)}</div><p className="text-[10px] text-muted-foreground">{clips.length ? `${clips.length} animation clip${clips.length === 1 ? "" : "s"} · unavailable expressions return to idle` : "No animation clips · gentle procedural breathing"}</p></div>}
    </>}
  </section>;
}