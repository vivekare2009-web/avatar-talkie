export type ModelState = "IDLE" | "THINKING" | "LISTENING" | "TALKING" | "UPSET" | "PERSONAL_BOUNDARY";
export type ModelAppearance = { scale: number; vertical: number; rotation: number };
export const DEFAULT_APPEARANCE: ModelAppearance = { scale: 1, vertical: 0, rotation: 0 };
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