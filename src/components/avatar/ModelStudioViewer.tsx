import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ModelPackage } from "@/lib/companion/modelPackage";
import { animationForState, cameraLimits, type CameraView, type ModelAppearance, type ModelState } from "@/lib/companion/modelPresentation";
import { disposeCharacter, loadCharacter, type LoadedCharacter } from "@/lib/companion/modelRuntime";

class RenderBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { this.props.onError(`3D rendering failed: ${error.message}`); }
  override render() { return this.state.failed ? null : this.props.children; }
}
function Character({ loaded, state, appearance, onError }: { loaded: LoadedCharacter; state: ModelState; appearance: ModelAppearance; onError: (message: string) => void }) {
  const root = useRef<THREE.Group>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(loaded.object), [loaded.object]);
  const name = animationForState(loaded.clips.map(clip => clip.name), state);
  const failed = useRef(false);
  const reduced = useRef(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.current = media.matches;
    const change = () => { reduced.current = media.matches; };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const clip = loaded.clips.find(item => item.name === name);
    if (!clip) return undefined;
    try {
      const action = mixer.clipAction(clip).reset().fadeIn(0.25).play();
      return () => { action.fadeOut(0.25); };
    } catch { mixer.stopAllAction(); return undefined; }
  }, [loaded, mixer, name]);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(loaded.object); }, [loaded, mixer]);
  useFrame(({ clock }, rawDelta) => {
    if (!root.current) return;
    try {
      if (!failed.current) mixer.update(Math.min(rawDelta, 0.05));
      const t = clock.getElapsedTime();
      root.current.position.y = appearance.vertical + (!name && !reduced.current ? Math.sin(t * 1.4) * 0.012 : 0);
    } catch {
      failed.current = true;
      mixer.stopAllAction();
      onError("The model animation failed. Remove or replace this model to recover.");
    }
  });
  return <group ref={root} scale={appearance.scale} rotation-y={THREE.MathUtils.degToRad(appearance.rotation)}><primitive object={loaded.object} dispose={null} /></group>;
}
function CameraRig({ radius, appearance, view, reset, onView }: { radius: number; appearance: ModelAppearance; view: CameraView; reset: number; onView: (view: CameraView) => void }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const limits = cameraLimits(radius, size.width / Math.max(size.height, 1), appearance.scale);
  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    const angle = THREE.MathUtils.degToRad(view.angle);
    const elevation = THREE.MathUtils.degToRad(view.elevation);
    const distance = THREE.MathUtils.clamp(limits.fit * view.distance, limits.min, limits.max);
    control.target.set(0, appearance.vertical, 0);
    camera.position.set(Math.sin(angle) * Math.cos(elevation) * distance, appearance.vertical + Math.sin(elevation) * distance, Math.cos(angle) * Math.cos(elevation) * distance);
    camera.lookAt(control.target);
    control.update();
    control.saveState();
  }, [camera, view.angle, view.elevation, view.distance, reset, limits.fit, limits.min, limits.max, appearance.vertical]);
  useFrame(() => {
    const control = controls.current;
    if (!control) return;
    // Keep optional two-finger pan close to the character so zoom cannot enter its bounds.
    const center = new THREE.Vector3(0, appearance.vertical, 0);
    const offset = control.target.clone().sub(center);
    if (offset.length() > radius * appearance.scale * 0.15) {
      const next = center.add(offset.clampLength(0, radius * appearance.scale * 0.15));
      camera.position.add(next.clone().sub(control.target));
      control.target.copy(next);
    }
  });
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} enablePan screenSpacePanning panSpeed={0.35} minDistance={limits.min} maxDistance={limits.max} minPolarAngle={0.25} maxPolarAngle={Math.PI - 0.25} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />;
}
export function ModelStudioViewer({ model, state, appearance, reset, view, onView, onLoaded, onProgress, onError }: {
  model: ModelPackage; state: ModelState; appearance: ModelAppearance; reset: number;
  view: CameraView; onView: (view: CameraView) => void;
  onLoaded: (id: string, clips: string[]) => void; onProgress: (progress: number) => void; onError: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedCharacter | null>(null);
  const [rendered, setRendered] = useState(false);
  const loadedNotice = useRef(false);
  useEffect(() => {
    let live = true;
    let owned: LoadedCharacter | null = null;
    loadedNotice.current = false;
    setRendered(false);
    setLoaded(null);
    onProgress(0);
    const timer = window.setTimeout(() => { if (live) { live = false; onError("Model loading timed out. Try a smaller GLB."); } }, 30000);
    void loadCharacter(model, value => { if (live) onProgress(value); }).then(result => {
      window.clearTimeout(timer);
      if (!live) { disposeCharacter(result.object); return; }
      owned = result;
      setLoaded(result);
    }).catch((error: unknown) => {
      window.clearTimeout(timer);
      if (live) onError(error instanceof Error ? error.message : "This model could not load.");
    });
    return () => { live = false; window.clearTimeout(timer); if (owned) disposeCharacter(owned.object); };
  }, [model, onProgress, onError]);
  useEffect(() => {
    if (!loaded || !rendered || loadedNotice.current) return;
    loadedNotice.current = true;
    onLoaded(model.id, loaded.clips.map(clip => clip.name));
  }, [loaded, rendered, model.id, onLoaded]);
  return <div className="relative h-full w-full touch-none bg-surface-deep" data-scene-ready={rendered && loaded ? "true" : undefined} aria-label="Live 3D character viewport">
    <RenderBoundary onError={onError}>
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 8], fov: 38, near: 0.03, far: 200 }} gl={{ antialias: true, alpha: true }} fallback={<div className="p-4 text-sm">3D is unavailable on this device.</div>} onCreated={({ gl }) => {
        const lost = (event: Event) => { event.preventDefault(); onError("3D graphics were interrupted. Tap Retry to restore the character."); };
        gl.domElement.addEventListener("webglcontextlost", lost, { once: true });
      }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} />
        <directionalLight position={[-3, 2, 1]} intensity={0.7} />
        <Suspense fallback={null}>
          <Environment><Lightformer intensity={2} position={[0, 5, 2]} scale={[8, 8, 1]} /><Lightformer intensity={1} position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} /></Environment>
          {loaded && <><Character loaded={loaded} state={state} appearance={appearance} onError={onError} /><CameraRig radius={loaded.radius} appearance={appearance} view={view} onView={onView} reset={reset} /><FirstFrame onFrame={() => setRendered(true)} /></>}
        </Suspense>
      </Canvas>
    </RenderBoundary>
  </div>;
}
function FirstFrame({ onFrame }: { onFrame: () => void }) {
  const frames = useRef(0);
  useFrame(() => { frames.current++; if (frames.current === 3) onFrame(); });
  return null;
}
