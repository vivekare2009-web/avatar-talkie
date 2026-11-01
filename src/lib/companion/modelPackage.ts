import { unzip } from "fflate";

export type SupportedModelFormat = "glb" | "gltf" | "fbx";

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
const MODEL_EXTENSIONS = ["glb", "gltf", "fbx"] as const;
const AUXILIARY_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bin"]);

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function cleanPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function safePath(path: string) {
  const clean = cleanPath(path);
  return Boolean(clean) && !clean.startsWith("/") && !clean.split("/").includes("..") && !/[:\u0000]/.test(clean);
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

function chooseMain(paths: string[]) {
  for (const ext of MODEL_EXTENSIONS) {
    const match = paths.find((path) => extension(path) === ext);
    if (match) return { path: match, format: ext };
  }
  return null;
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `model_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function inspectModelUpload(file: File): Promise<ModelPackage> {
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
    if (directExt === "blend") throw new Error(".blend source files are not browser-renderable. Export the character as GLB first.");
    throw new Error("Supported uploads are .zip, .glb, .gltf, and .fbx.");
  }

  let entries: Record<string, Uint8Array>;
  let expanded = 0;
  let count = 0;
  try { const bytes = new Uint8Array(await file.arrayBuffer()); entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => { unzip(bytes, { filter: entry => {
    count++;
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
  const main = chooseMain(paths);
  if (!main) {
    const hasBlend = paths.some((path) => extension(path) === "blend");
    throw new Error(hasBlend
      ? "This ZIP contains a .blend source but no GLB, GLTF, or FBX. Export a web model from Blender and include it in the ZIP."
      : "No supported model was found. ZIPs must contain a GLB, GLTF (+ BIN/textures), or FBX file.");
  }
  const keptPaths = paths.filter((path) => path === main.path || AUXILIARY_EXTENSIONS.has(extension(path)));
  return {
    id: createId(),
    name: file.name,
    format: main.format,
    mainPath: cleanPath(main.path),
    files: keptPaths.map((path) => ({
      path: cleanPath(path),
      blob: new Blob([new Uint8Array(entries[path] ?? []).buffer], { type: mimeFor(path) }),
    })),
    savedAt: Date.now(),
  };
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
