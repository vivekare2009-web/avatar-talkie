import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { AvatarState } from "@/lib/companion/avatarStates";
import type { ModelPackage } from "@/lib/companion/modelPackage";

type CameraPreset = "front" | "side" | "back" | "three-quarter" | "close-up" | "full-body";
type LoadedModel = { object: THREE.Group; clips: THREE.AnimationClip[]; height: number };

const PRESETS: Record<CameraPreset, { azimuth: number; polar: number; distance: number }> = {
  front: { azimuth: 0, polar: 82, distance: 4.4 },
  side: { azimuth: 90, polar: 82, distance: 4.4 },
  back: { azimuth: 180, polar: 82, distance: 4.4 },
  "three-quarter": { azimuth: 38, polar: 78, distance: 4.1 },
  "close-up": { azimuth: 15, polar: 76, distance: 2.5 },
  "full-body": { azimuth: 0, polar: 80, distance: 5.2 },
};

function normalizedPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function buildUrls(model: ModelPackage) {
  const entries = model.files.map((file) => [normalizedPath(file.path), URL.createObjectURL(file.blob)] as const);
  const urls = new Map(entries);
  const byName = new Map(entries.map(([path, url]) => [path.split("/").pop() ?? path, url]));
  return {
    main: urls.get(normalizedPath(model.mainPath)),
    resolve: (requested: string) => {
      const decoded = decodeURIComponent(requested).replace(/^blob:[^/]+\//, "");
      const clean = normalizedPath(decoded);
      return urls.get(clean) ?? byName.get(clean.split("/").pop() ?? clean) ?? requested;
    },
    revoke: () => entries.forEach(([, url]) => URL.revokeObjectURL(url)),
  };
}

async function loadModel(model: ModelPackage, onProgress: (value: number) => void): Promise<LoadedModel> {
  const packageUrls = buildUrls(model);
  if (!packageUrls.main) throw new Error("The main model file is missing from this package.");
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(packageUrls.resolve);
  manager.onProgress = (_url, loaded, total) => onProgress(total ? Math.round((loaded / total) * 100) : 0);
  try {
    const loaded = model.format === "fbx"
      ? await new FBXLoader(manager).loadAsync(packageUrls.main, (event) => onProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 25))
      : await new GLTFLoader(manager).loadAsync(packageUrls.main, (event) => onProgress(event.total ? Math.round((event.loaded / event.total) * 100) : 25));
    const object = model.format === "fbx" ? loaded as THREE.Group : (loaded as { scene: THREE.Group }).scene;
    const clips = model.format === "fbx" ? object.animations : (loaded as { animations: THREE.AnimationClip[] }).animations;
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2.8 / Math.max(size.y, 0.001);
    object.scale.setScalar(scale);
    const scaled = new THREE.Box3().setFromObject(object);
    const center = scaled.getCenter(new THREE.Vector3());
    object.position.set(-center.x, -scaled.min.y - 1.4, -center.z);
    onProgress(100);
    return { object, clips, height: 2.8 };
  } finally {
    window.setTimeout(packageUrls.revoke, 3000);
  }
}

function Character({ loaded, state }: { loaded: LoadedModel; state: AvatarState }) {
  const root = useRef<THREE.Group>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(loaded.object), [loaded.object]);
  const hasAnimation = loaded.clips.length > 0;
  useEffect(() => {
    if (!hasAnimation) return;
    const expressions: Record<AvatarState, RegExp> = {
      IDLE: /idle|breath|stand/i,
      THINKING: /think|idle|stand/i,
      TALKING: /talk|speak|idle/i,
      UPSET: /upset|angry|sad|idle/i,
      PERSONAL_BOUNDARY: /boundary|back|upset|angry|idle/i,
    };
    const clip = loaded.clips.find((item) => expressions[state].test(item.name)) ?? loaded.clips[0];
    if (!clip) return;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).reset().fadeIn(0.2).play();
    return () => { action.fadeOut(0.15); };
  }, [hasAnimation, loaded.clips, mixer, state]);
  useEffect(() => () => mixer.stopAllAction(), [mixer]);
  useFrame(({ clock }, delta) => {
    mixer.update(Math.min(delta, 0.05));
    if (!root.current || hasAnimation) return;
    const t = clock.getElapsedTime();
    root.current.position.y = Math.sin(t * 1.4) * 0.012;
    root.current.rotation.y = state === "THINKING" ? Math.sin(t * 0.7) * 0.04 : Math.sin(t * 0.28) * 0.018;
  });
  return <group ref={root}><primitive object={loaded.object} /></group>;
}

export function ModelStudioViewer({ model, state, onError }: { model: ModelPackage; state: AvatarState; onError: (message: string) => void }) {
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [progress, setProgress] = useState(0);
  const [camera, setCamera] = useState(PRESETS["three-quarter"]);
  const controls = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setProgress(0);
    loadModel(model, (value) => { if (live) setProgress(value); })
      .then((result) => { if (live) setLoaded(result); })
      .catch((error: unknown) => { if (live) onError(error instanceof Error ? error.message : "The 3D model could not be loaded."); });
    return () => { live = false; };
  }, [model, onError]);

  const applyCamera = useCallback((next: typeof camera) => {
    setCamera(next);
    const control = controls.current;
    if (!control) return;
    const azimuth = THREE.MathUtils.degToRad(next.azimuth);
    const polar = THREE.MathUtils.degToRad(next.polar);
    control.setAzimuthalAngle(azimuth);
    control.setPolarAngle(polar);
    const direction = new THREE.Vector3().setFromSphericalCoords(next.distance, polar, azimuth);
    control.object.position.copy(control.target).add(direction);
    control.update();
  }, []);

  return (
    <div className="relative h-full w-full bg-surface-deep">
      <Canvas dpr={[1, 1.5]} camera={{ position: [2.3, 0.4, 3.5], fov: 38, near: 0.05, far: 100 }} gl={{ antialias: true, alpha: true }}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
        <directionalLight position={[-3, 2, 1]} intensity={0.8} />
        <Suspense fallback={null}>{loaded && <Character loaded={loaded} state={state} />}</Suspense>
        <Environment>
          <Lightformer intensity={2} position={[0, 5, 2]} scale={[8, 8, 1]} />
          <Lightformer intensity={1} color="#67e8f9" position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
        </Environment>
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} enablePan minDistance={1.6} maxDistance={8} minPolarAngle={0.35} maxPolarAngle={Math.PI - 0.25} target={[0, 0, 0]} />
      </Canvas>
      {!loaded && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">Loading model · {progress}%</div>}
      <div className="absolute inset-x-2 bottom-2 z-10 space-y-2 rounded-md border border-border bg-card/90 p-2 backdrop-blur-md">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {(Object.keys(PRESETS) as CameraPreset[]).map((preset) => (
            <Button key={preset} size="sm" variant="outline" className="h-7 shrink-0 px-2 text-[10px]" onClick={() => applyCamera(PRESETS[preset])}>{preset}</Button>
          ))}
          <Button size="sm" className="h-7 shrink-0 px-2 text-[10px]" onClick={() => applyCamera(PRESETS["three-quarter"])}>Reset</Button>
        </div>
        <div className="grid grid-cols-[52px_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          <span>Angle</span><Slider aria-label="Camera angle" value={[camera.azimuth]} min={-180} max={180} step={1} onValueChange={([value]) => applyCamera({ ...camera, azimuth: value ?? 0 })} />
          <span>Distance</span><Slider aria-label="Camera distance" value={[camera.distance]} min={1.6} max={8} step={0.1} onValueChange={([value]) => applyCamera({ ...camera, distance: value ?? 4.1 })} />
        </div>
      </div>
    </div>
  );
}
