import { expect, test } from "bun:test";
import { animationForState, cameraLimits, cameraPreset } from "./modelPresentation";
import { inspectModelUpload } from "./modelPackage";
import { zipSync } from "fflate";

test("missing character states use idle, never an unrelated body animation", () => {
  expect(animationForState(["Walk", "Idle"], "PERSONAL_BOUNDARY")).toBe("Idle");
  expect(animationForState(["Walk"], "TALKING")).toBe(null);
  expect(animationForState(["Listen", "Idle"], "LISTENING")).toBe("Listen");
  expect(animationForState(["Response", "Idle"], "TALKING")).toBe("Response");
});
test("zoom stops outside model bounds and portrait framing fits", () => {
  const portrait = cameraLimits(1.5, 9 / 16, 1);
  expect(portrait.min).toBeGreaterThan(1.5);
  expect(portrait.fit).toBeGreaterThan(cameraLimits(1.5, 1, 1).fit);
  expect(cameraLimits(1.5, 9 / 16, 1.4).min).toBeGreaterThan(2.1);
});
test("unsupported Blender files and invalid GLB are rejected", async () => {
  await expect(inspectModelUpload(new File(["source"], "character.blend"))).rejects.toThrow("not browser-renderable");
  await expect(inspectModelUpload(new File(["not glb"], "character.glb"))).rejects.toThrow("valid GLB");
});
test("ZIP path traversal is rejected before extraction", async () => {
  const bytes = zipSync({ "../model.gltf": new TextEncoder().encode("{}") });
  await expect(inspectModelUpload(new File([bytes.buffer as ArrayBuffer], "unsafe.zip"))).rejects.toThrow("unsafe paths");
});
test("direct GLTF external textures require a package", async () => {
  await expect(inspectModelUpload(new File([JSON.stringify({ images: [{ uri: "skin.png" }] })], "character.gltf"))).rejects.toThrow("together in a ZIP");
});
test("ZIP extraction retains nested GLTF, buffers and all textures", async () => {
  const bytes = zipSync({
    "character/model.gltf": new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "mesh.bin" }], images: [{ uri: "textures/skin.png" }] })),
    "character/mesh.bin": new Uint8Array([1, 2, 3]),
    "character/textures/skin.png": new Uint8Array([4, 5]),
    "source/model.blend": new Uint8Array([9]),
  });
  const model = await inspectModelUpload(new File([bytes.buffer as ArrayBuffer], "character.zip"));
  expect(model.mainPath).toBe("character/model.gltf");
  expect(model.files.map(file => file.path)).toEqual(["character/model.gltf", "character/mesh.bin", "character/textures/skin.png"]);
  expect([...new Uint8Array(await model.files[1]?.blob.arrayBuffer())]).toEqual([1, 2, 3]);
});
test("ZIP chooses GLB and supports FBX with packaged textures", async () => {
  for (const format of ["glb", "fbx"] as const) {
    const bytes = zipSync({ [`avatar.${format}`]: new Uint8Array([1]), "skin.jpg": new Uint8Array([2]) });
    const model = await inspectModelUpload(new File([bytes.buffer as ArrayBuffer], "avatar.zip"));
    expect(model.format).toBe(format);
    expect(model.files.length).toBe(2);
  }
});
test("camera presets cover the requested views and close-up zoom", () => {
  expect(cameraPreset("front").angle).toBe(0);
  expect(cameraPreset("side").angle).toBe(90);
  expect(cameraPreset("back").angle).toBe(180);
  expect(cameraPreset("three-quarter").angle).toBe(26);
  expect(cameraPreset("close-up").distance).toBe(0.55);
  expect(cameraPreset("full-body").distance).toBe(1);
});