export const BLENDER_GUIDANCE = ".blend source files are not browser-renderable. Open the source in Blender, select the character, then File → Export → glTF 2.0. Choose GLB, include materials/textures, skinning and animations, and import the exported file here.";

export function modelExtension(path: string) { return path.split(".").pop()?.toLowerCase() ?? ""; }
export function normalizeArchivePath(path: string) {
  const value = path.replaceAll("\\", "/");
  if (!value || value.startsWith("/") || /[:\u0000-\u001f]/.test(value) || value.split("/").includes("..")) throw new Error(`ZIP contains unsafe paths: ${path}`);
  const normalized = value.split("/").filter(part => part && part !== ".").join("/");
  if (!normalized) throw new Error("ZIP contains unsafe paths.");
  return normalized;
}

/** Resource references may go to a parent directory, but never outside the archive. */
export function resolveModelPath(paths: string[], mainPath: string, requested: string, legacyBasename = false) {
  let decoded: string;
  try { decoded = decodeURIComponent(requested).replaceAll("\\", "/"); } catch { throw new Error(`Invalid resource path: ${requested}`); }
  const absolute = /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(decoded);
  const directory = mainPath.split("/").slice(0, -1);
  const parts = [...directory];
  if (!absolute) for (const part of decoded.split("/")) {
    if (part === "..") { if (!parts.length) throw new Error(`Resource escapes archive: ${requested}`); parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  const wanted = parts.join("/");
  const exact = !absolute ? paths.find(path => path === wanted) : undefined;
  if (exact) return exact;
  const folded = !absolute ? paths.filter(path => path.toLowerCase() === wanted.toLowerCase()) : [];
  if (folded.length === 1) return folded[0] ?? "";
  if (legacyBasename && !/^https?:/i.test(decoded)) {
    const basename = decoded.split("/").pop()?.toLowerCase();
    const matches = paths.filter(path => path.split("/").pop()?.toLowerCase() === basename);
    if (matches.length === 1) return matches[0] ?? "";
    if (matches.length > 1) throw new Error(`Ambiguous texture path: ${requested}. Keep the original folders.`);
  }
  throw new Error(`Missing model resource: ${requested} (relative to ${mainPath}). Include its original folders in the ZIP.`);
}

export function createPackageUrls(files: { path: string; blob: Blob }[]) {
  const urls = new Map<string, string>();
  let released = false;
  const release = () => { if (released) return; released = true; urls.forEach(url => URL.revokeObjectURL(url)); };
  try { for (const file of files) urls.set(file.path, URL.createObjectURL(file.blob)); }
  catch (error) { release(); throw error; }
  return { urls, release };
}