import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelPackage } from "./modelPackage";

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
function clean(path: string) {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
export async function loadCharacter(model: ModelPackage, progress: (value: number) => void): Promise<LoadedCharacter> {
  const urls = new Map(model.files.map(file => [clean(file.path), URL.createObjectURL(file.blob)]));
  const main = urls.get(clean(model.mainPath));
  const directory = model.mainPath.split("/").slice(0, -1).join("/");
  const manager = new THREE.LoadingManager();
  const missing: string[] = [];
  manager.onError = url => { missing.push(url); };
  manager.setURLModifier(requested => {
    if ([...urls.values()].includes(requested) || requested.startsWith("data:")) return requested;
    let decoded: string;
    try { decoded = decodeURIComponent(requested); } catch { throw new Error("Invalid texture path."); }
    const relative = decoded.replace(/^blob:.*\//, "");
    const resolved = urls.get(clean(`${directory}/${relative}`)) ?? urls.get(clean(relative));
    if (!resolved) throw new Error(`Missing or unsupported model resource: ${relative}. Include it in the ZIP.`);
    return resolved;
  });
  manager.onProgress = (_url, loaded, total) => progress(Math.min(95, Math.round(loaded / Math.max(total, 1) * 95)));
  let object: THREE.Group | undefined;
  try {
    if (!main) throw new Error("The main model file is missing.");
    let clips: THREE.AnimationClip[];
    if (model.format === "fbx") {
      object = await new FBXLoader(manager).loadAsync(main);
      clips = object.animations;
    } else {
      const gltf = await new GLTFLoader(manager).loadAsync(main);
      object = gltf.scene;
      clips = gltf.animations;
    }
    if (missing.length) throw new Error("A texture or model resource failed to load. Check the ZIP contents.");
    let meshes = 0;
    object.traverse(child => { if (child instanceof THREE.Mesh) meshes++; });
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    if (!meshes || !Number.isFinite(size.length()) || size.length() < 0.00001) throw new Error("This model has no visible geometry.");
    object.scale.multiplyScalar(2.8 / Math.max(size.y, size.x * 0.5, 0.001));
    const scaled = new THREE.Box3().setFromObject(object);
    const center = scaled.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
    progress(100);
    return { object, clips, radius: sphere.radius };
  } catch (error) {
    if (object) disposeCharacter(object);
    throw error;
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url));
  }
}