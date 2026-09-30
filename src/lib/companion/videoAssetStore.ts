import { AVATAR_STATES, type AvatarState } from "./avatarStates";

/**
 * Browser-local storage for the five avatar clips.
 * The videos stay on the device (IndexedDB) so they survive refreshes and
 * restarts without uploading large media anywhere.
 */

const DB_NAME = "c2-avatar-assets";
const STORE = "clips";
const VERSION = 1;

export type StoredAsset = {
  state: AvatarState;
  name: string;
  type: string;
  size: number;
  savedAt: number;
  blob: Blob;
};

export type AssetMeta = Omit<StoredAsset, "blob">;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot store videos locally."));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "state" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local storage."));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
    });
  } finally {
    db.close();
  }
}

export async function putAsset(state: AvatarState, file: File): Promise<AssetMeta> {
  const record: StoredAsset = {
    state,
    name: file.name,
    type: file.type || "video/mp4",
    size: file.size,
    savedAt: Date.now(),
    blob: file,
  };
  await tx("readwrite", (store) => store.put(record) as IDBRequest<IDBValidKey>);
  const { blob: _blob, ...meta } = record;
  return meta;
}

export async function deleteAsset(state: AvatarState) {
  await tx("readwrite", (store) => store.delete(state) as unknown as IDBRequest<undefined>);
}

export async function clearAssets() {
  await tx("readwrite", (store) => store.clear() as unknown as IDBRequest<undefined>);
}

export async function getAllAssets(): Promise<StoredAsset[]> {
  const all = await tx<StoredAsset[]>("readonly", (store) => store.getAll() as IDBRequest<StoredAsset[]>);
  return all.filter((item) => AVATAR_STATES.includes(item.state));
}

export type AssetLibrary = {
  urls: Partial<Record<AvatarState, string>>;
  meta: Partial<Record<AvatarState, AssetMeta>>;
  revoke: () => void;
};

export async function loadAssetLibrary(): Promise<AssetLibrary> {
  const assets = await getAllAssets();
  const urls: Partial<Record<AvatarState, string>> = {};
  const meta: Partial<Record<AvatarState, AssetMeta>> = {};
  for (const asset of assets) {
    urls[asset.state] = URL.createObjectURL(asset.blob);
    const { blob: _blob, ...rest } = asset;
    meta[asset.state] = rest;
  }
  return {
    urls,
    meta,
    revoke: () => {
      for (const url of Object.values(urls)) if (url) URL.revokeObjectURL(url);
    },
  };
}
