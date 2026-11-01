export type ModelState = "IDLE" | "THINKING" | "LISTENING" | "TALKING" | "UPSET" | "PERSONAL_BOUNDARY";
export type ModelAppearance = { scale: number; vertical: number; rotation: number };
export const DEFAULT_APPEARANCE: ModelAppearance = { scale: 1, vertical: 0, rotation: 0 };
export type CameraView = { angle: number; elevation: number; distance: number };
export type CameraPreset = "front" | "side" | "back" | "three-quarter" | "close-up" | "full-body";
export const DEFAULT_CAMERA: CameraView = { angle: 26, elevation: 2, distance: 1 };
export function cameraPreset(preset: CameraPreset): CameraView {
  return { angle: preset === "back" ? 180 : preset === "side" ? 90 : preset === "three-quarter" ? 26 : 0, elevation: 2, distance: preset === "close-up" ? 0.55 : 1 };
}
const PATTERNS: Record<ModelState, RegExp> = {
  IDLE: /idle|breath|stand/i,
  THINKING: /think/i,
  LISTENING: /listen/i,
  TALKING: /talk|speak|response/i,
  UPSET: /upset|angry|sad/i,
  PERSONAL_BOUNDARY: /boundary|back.?off/i,
};
export function animationForState(names: string[], state: ModelState) {
  return names.find(name => PATTERNS[state].test(name)) ?? names.find(name => PATTERNS.IDLE.test(name)) ?? null;
}
export function cameraLimits(radius: number, aspect: number, scale: number) {
  const r = Math.max(radius * scale, 0.1);
  const halfFov = Math.atan(Math.tan(38 * Math.PI / 360) * Math.min(aspect, 1));
  const fit = r / Math.sin(halfFov) * 1.12;
  return { min: r * 1.25 + 0.1, fit, max: fit * 2.5 };
}