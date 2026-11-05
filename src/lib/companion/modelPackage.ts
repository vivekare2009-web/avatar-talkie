import { unzip } from "fflate";
import { BLENDER_GUIDANCE, modelExtension as extension, normalizeArchivePath, resolveModelPath } from "./modelPaths";

export type SupportedModelFormat = "glb" | "gltf" | "fbx" | "pmx";
export type ModelCandidate = { path: string; format: SupportedModelFormat };

export type ModelPackageFile = {
  path: string;
  blob: Blob;
};

export type ModelPackage = {
  id: string;
  name: string;
  format: SupportedModelFormat;
  mainPath: string;
  files: ModelPackageFile[];
  savedAt: number;
  candidates?: ModelCandidate[];
};

export type ModelPackageSummary = Omit<ModelPackage, "files"> & {
  fileCount: number;
  totalBytes: number;
};

const DB_NAME = "c2-character-model";
const STORE = "packages";
const VERSION = 1;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 150 * 1024 * 1024;
const MAX_ENTRIES = 200;
const MODEL_EXTENSIONS = ["glb", "gltf", "fbx", "pmx"] as const;
const AUXILIARY_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bin", "tga", "bmp", "sph", "spa"]);

function safePath(path: string) {
  try { normalizeArchivePath(path); return true; } catch { return false; }
}

function mimeFor(path: string) {
  const ext = extension(path);
  if (ext === "glb") return "model/gltf-binary";
  if (ext === "gltf") return "model/gltf+json";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

export function discoverModelCandidates(paths: string[]): ModelCandidate[] {
  return MODEL_EXTENSIONS.flatMap(format => paths.filter(path => extension(path) === format).map(path => ({ path, format })));
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `model_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function inspectModelUpload(file: File, progress: (stage: string) => void = () => {}): Promise<ModelPackage> {
  progress("Reading package");
  if (file.size > MAX_ARCHIVE_BYTES) throw new Error("Model package is larger than 100 MB.");
  const directExt = extension(file.name);
  if (MODEL_EXTENSIONS.includes(directExt as SupportedModelFormat)) {
    if (directExt === "glb") {
      const header = new DataView(await file.slice(0, 12).arrayBuffer());
      if (header.byteLength < 12 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== file.size) throw new Error("This is not a valid GLB 2.0 file.");
    }
    if (directExt === "gltf") {
      const text = await file.text();
      let parsed: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
      try { parsed = JSON.parse(text) as typeof parsed; }
      catch { throw new Error("This GLTF file is not valid JSON."); }
      const external = [...(parsed.buffers ?? []), ...(parsed.images ?? [])]
        .map((item) => item.uri)
        .filter((uri): uri is string => Boolean(uri && !uri.startsWith("data:")));
      if (external.length) throw new Error("This GLTF references external files. Put the GLTF, BIN, and textures together in a ZIP.");
    }
    return {
      id: createId(),
      name: file.name,
      format: directExt as SupportedModelFormat,
      mainPath: file.name,
      files: [{ path: file.name, blob: file }],
      savedAt: Date.now(),
    };
  }
  if (directExt !== "zip") {
    if (directExt === "blend") throw new Error(BLENDER_GUIDANCE);
    throw new Error("Supported uploads are ZIP, GLB, GLTF, FBX and PMX.");
  }

  let entries: Record<string, Uint8Array>;
  let expanded = 0;
  let count = 0;
  progress("Extracting ZIP");
  try { const bytes = new Uint8Array(await file.arrayBuffer()); entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => { unzip(bytes, { filter: entry => {
    if (!entry.name.endsWith("/")) count++;
    expanded += entry.originalSize;
    if (count > MAX_ENTRIES || expanded > MAX_EXTRACTED_BYTES || !safePath(entry.name)) throw new Error("ZIP exceeds safety limits or contains unsafe paths.");
    return true;
   } }, (error, result) => { if (error) reject(error); else resolve(result); }); }); }
  catch (error) { throw new Error(error instanceof Error && error.message.startsWith("ZIP exceeds") ? error.message : "This ZIP could not be read. It may be damaged or encrypted."); }
  const paths = Object.keys(entries).filter((path) => !path.endsWith("/") && !path.startsWith("__MACOSX/"));
  if (paths.length > MAX_ENTRIES) throw new Error(`ZIP has too many files (${paths.length}; maximum ${MAX_ENTRIES}).`);
  if (paths.some((path) => !safePath(path))) throw new Error("ZIP contains an unsafe file path and was blocked.");
  const total = paths.reduce((sum, path) => sum + (entries[path]?.byteLength ?? 0), 0);
  if (total > MAX_EXTRACTED_BYTES) throw new Error("ZIP expands beyond the 150 MB safety limit.");
  const candidates = discoverModelCandidates(paths);
  const main = candidates[0];
  if (!main) {
    const hasBlend = paths.some((path) => extension(path) === "blend");
    throw new Error(hasBlend
      ? BLENDER_GUIDANCE
      : "No supported model was found. ZIPs must contain GLB, GLTF, FBX or PMX; ZIPs inside ZIPs must be unpacked first.");
  }
  const keptPaths = paths.filter((path) => candidates.some(candidate => candidate.path === path) || AUXILIARY_EXTENSIONS.has(extension(path)));
  const normalized = keptPaths.map(normalizeArchivePath);
  if (new Set(normalized).size !== normalized.length) throw new Error("ZIP contains duplicate normalized paths.");
  progress(candidates.length > 1 ? "Choose a model" : "Checking resources");
  const model: ModelPackage = {
    id: createId(),
    name: file.name,
    format: main.format,
    mainPath: normalizeArchivePath(main.path),
    candidates: candidates.map(candidate => ({ ...candidate, path: normalizeArchivePath(candidate.path) })),
    files: keptPaths.map((path) => ({
      path: normalizeArchivePath(path),
      blob: new Blob([new Uint8Array(entries[path] ?? []).buffer], { type: mimeFor(path) }),
    })),
    savedAt: Date.now(),
  };
  if (candidates.length === 1) await validateModelResources(model);
  return model;
}

export async function validateModelResources(model: ModelPackage) {
  if (model.format !== "gltf") return;
  const main = model.files.find(file => file.path === model.mainPath);
  if (!main) throw new Error("The main model file is missing.");
  let parsed: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try { parsed = JSON.parse(await main.blob.text()); } catch { throw new Error("This GLTF file is not valid JSON."); }
  for (const item of [...(parsed.buffers ?? []), ...(parsed.images ?? [])]) {
    if (item.uri && !item.uri.startsWith("data:")) resolveModelPath(model.files.map(file => file.path), model.mainPath, item.uri);
  }
}

export async function selectModelCandidate(model: ModelPackage, path: string): Promise<ModelPackage> {
  const candidate = model.candidates?.find(item => item.path === path);
  if (!candidate) throw new Error("Select a model found in this package.");
  const selected = { ...model, id: createId(), mainPath: candidate.path, format: candidate.format };
  await validateModelResources(selected);
  return selected;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot store 3D models."));
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open 3D model storage."));
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Model storage was not committed."));
      tx.onerror = () => reject(tx.error ?? new Error("Model storage failed."));
      request.onerror = () => reject(request.error ?? new Error("3D model storage failed."));
    });
  } finally { db.close(); }
}

export async function saveModelPackage(model: ModelPackage) {
  await transaction("readwrite", (store) => store.put(model) as IDBRequest<IDBValidKey>);
}

export async function loadLatestModelPackage(): Promise<ModelPackage | null> {
  const all = await transaction<ModelPackage[]>("readonly", (store) => store.getAll() as IDBRequest<ModelPackage[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}

export async function listModelPackages(): Promise<ModelPackage[]> {
  const all = await transaction<ModelPackage[]>("readonly", store => store.getAll() as IDBRequest<ModelPackage[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function removeModelPackage(id: string) {
  await transaction("readwrite", store => store.delete(id) as IDBRequest<undefined>);
}

export async function clearModelPackages() {
  await transaction("readwrite", (store) => store.clear() as unknown as IDBRequest<undefined>);
}

export function summarizeModelPackage(model: ModelPackage): ModelPackageSummary {
  return {
    id: model.id,
    name: model.name,
    format: model.format,
    mainPath: model.mainPath,
    savedAt: model.savedAt,
    fileCount: model.files.length,
    totalBytes: model.files.reduce((sum, file) => sum + file.blob.size, 0),
  };
}
