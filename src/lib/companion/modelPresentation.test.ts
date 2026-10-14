import { expect, test } from "bun:test";
import { animationForState, cameraLimits } from "./modelPresentation";
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