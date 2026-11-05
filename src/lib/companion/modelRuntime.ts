import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { validateModelResources, type ModelPackage } from "./modelPackage";
import { createPackageUrls, resolveModelPath } from "./modelPaths";

export type LoadedCharacter = { object: THREE.Group; clips: THREE.AnimationClip[]; radius: number };
export function disposeCharacter(object: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (child instanceof THREE.SkinnedMesh) child.skeleton.dispose();
  });
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
}
export async function loadCharacter(model: ModelPackage, progress: (value: number) => void, signal?: AbortSignal): Promise<LoadedCharacter> {
  await validateModelResources(model);
  const { urls, release } = createPackageUrls(model.files);
  const manager = new THREE.LoadingManager();
  const missing: string[] = [];
  const paths = [...urls.keys()];
  const prefix = "c2-package/";
  let object: THREE.Group | undefined;
  let resourcesDone: () => void = () => {};
  const resources = new Promise<void>(resolve => { resourcesDone = resolve; });
  manager.onLoad = resourcesDone;
  manager.onError = url => { missing.push(url); };
  manager.onProgress = (_url, loaded, total) => progress(Math.min(95, Math.round(loaded / Math.max(total, 1) * 95)));
  const abort = () => { manager.abort(); release(); resourcesDone(); };
  signal?.addEventListener("abort", abort, { once: true });
  manager.setURLModifier(requested => {
    if ([...urls.values()].includes(requested) || requested.startsWith("data:")) return requested;
    let resolved: string;
    try {
      if (requested.startsWith(prefix)) {
        resolved = resolveModelPath(paths, "root", requested.slice(prefix.length));
      } else {
        resolved = resolveModelPath(paths, model.mainPath, requested, model.format === "fbx");
      }
    } catch (error) { missing.push(requested); throw error; }
    const url = urls.get(resolved);
    if (!url) throw new Error(`Missing model resource: ${requested}`);
    return url;
  });
  // A sentinel keeps the resource-completion gate open while the model creates texture requests.
  manager.itemStart("character-parse");
  try {
    if (signal?.aborted) throw new Error("Model loading cancelled.");
    const resourcePath = prefix + model.mainPath.split("/").slice(0, -1).join("/") + "/";
    const virtualMain = prefix + model.mainPath;
    let clips: THREE.AnimationClip[];
    if (model.format === "pmx") {
      // The stdlib MMD loader retains the WebGL material pipeline. Native Three removed it in r172.
      const { MMDLoader } = await import("three-stdlib");
      const mesh = await new MMDLoader(manager).setResourcePath(resourcePath).loadAsync(virtualMain);
      object = new THREE.Group(); object.add(mesh); clips = mesh.animations;
    } else if (model.format === "fbx") {
      object = await new FBXLoader(manager).setResourcePath(resourcePath).loadAsync(virtualMain);
      clips = object.animations;
    } else {
      const gltf = await new GLTFLoader(manager).setResourcePath(resourcePath).loadAsync(virtualMain);
      object = gltf.scene; clips = gltf.animations;
    }
    manager.itemEnd("character-parse");
    await resources;
    if (signal?.aborted) throw new Error("Model loading cancelled.");
    if (missing.length) throw new Error(`Model resources failed: ${missing.join(", ")}. Include textures/BIN in their original folders.`);
    let meshes = 0;
    object.traverse(child => { if (child instanceof THREE.Mesh) meshes++; });
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    if (!meshes || !Number.isFinite(size.length()) || size.length() < 0.00001) throw new Error("This model has no visible geometry.");
    object.scale.multiplyScalar(2.8 / Math.max(size.y, size.x * 0.5, 0.001));
    const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
    object.position.sub(center);
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
    progress(100);
    return { object, clips, radius: sphere.radius };
  } catch (error) {
    manager.abort();
    if (object) disposeCharacter(object);
    throw error;
  } finally { signal?.removeEventListener("abort", abort); release(); }
}
