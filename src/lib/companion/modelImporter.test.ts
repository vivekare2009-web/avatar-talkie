import { expect, test } from "bun:test";
import { zipSync } from "fflate";
import { discoverModelCandidates, inspectModelUpload, selectModelCandidate } from "./modelPackage";
import { createPackageUrls, normalizeArchivePath, resolveModelPath } from "./modelPaths";

function archive(entries: Record<string, string>) {
  const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, new TextEncoder().encode(text)])));
  return new File([new Uint8Array(bytes).buffer], "test.zip");
}
test("recursive discovery retains Chinese, spaces and uppercase extensions", () => {
  expect(discoverModelCandidates(["a/b/c/蓝色 女孩.GLTf", "角色/模型.PMX", "a/Foo.FBX"]).map(item => item.format)).toEqual(["gltf", "fbx", "pmx"]);
});
test("archive normalization preserves names and rejects traversal and absolute paths", () => {
  expect(normalizeArchivePath("./蓝色\\a//model.GLB")).toBe("蓝色/a/model.GLB");
  for (const path of ["../x", "a/../x", "/x", "C:\\x", "a\u0000x"]) expect(() => normalizeArchivePath(path)).toThrow("unsafe paths");
});
test("multiple candidates retain original paths and allow explicit selection", async () => {
  const model = await inspectModelUpload(archive({ "一/a.gltf": "{}", "二/a.gltf": "{}", "一/skin.png": "one", "二/skin.png": "two" }));
  expect(model.candidates?.length).toBe(2);
  const selected = await selectModelCandidate(model, "二/a.gltf");
  expect(selected.mainPath).toBe("二/a.gltf");
  expect(selected.files.length).toBe(4);
  await expect(selectModelCandidate(model, "missing.gltf")).rejects.toThrow("Select a model");
});
test("duplicate basenames resolve by relative folder, not flattening", () => {
  const paths = ["a/skin.png", "b/skin.png"];
  expect(resolveModelPath(paths, "b/model.gltf", "skin.png")).toBe("b/skin.png");
  expect(() => resolveModelPath(paths, "c/model.fbx", "C:/skin.png", true)).toThrow("Ambiguous");
  expect(resolveModelPath(paths, "b/nested/model.gltf", "../skin.png")).toBe("b/skin.png");
});
test("missing BIN is detected before loading", async () => {
  await expect(inspectModelUpload(archive({ "a/model.gltf": '{"buffers":[{"uri":"mesh.bin"}]}' }))).rejects.toThrow("mesh.bin");
});
test("missing texture is detected before loading", async () => {
  await expect(inspectModelUpload(archive({ "a/model.gltf": '{"images":[{"uri":"skin.png"}]}' }))).rejects.toThrow("skin.png");
});
test("encoded Unicode resource references preserve nested paths", () => {
  expect(resolveModelPath(["角色/皮肤 图.png"], "角色/model.gltf", "%E7%9A%AE%E8%82%A4%20%E5%9B%BE.png")).toBe("角色/皮肤 图.png");
  expect(() => resolveModelPath([], "model.gltf", "../outside.bin")).toThrow("escapes archive");
});
test("Blender-only ZIP provides actual export instructions", async () => {
  await expect(inspectModelUpload(archive({ "角色/model.blend": "source" }))).rejects.toThrow("File → Export → glTF 2.0");
});
test("object URL ownership revokes exactly once", () => {
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = []; let next = 0;
  URL.createObjectURL = () => `blob:test-${++next}`;
  URL.revokeObjectURL = url => { revoked.push(url); };
  try {
    const owned = createPackageUrls([{ path: "a", blob: new Blob() }, { path: "b", blob: new Blob() }]);
    expect(owned.urls.size).toBe(2); owned.release(); owned.release();
    expect(revoked).toEqual(["blob:test-1", "blob:test-2"]);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});