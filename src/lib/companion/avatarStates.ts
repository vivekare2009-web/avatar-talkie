export const AVATAR_STATES = [
  "IDLE",
  "THINKING",
  "TALKING",
  "UPSET",
  "PERSONAL_BOUNDARY",
] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];

/** States that hold until something else changes them. */
export type SustainedState = Extract<AvatarState, "IDLE" | "THINKING" | "TALKING">;
/** States that play once and then return to the sustained state. */
export type TransientState = Extract<AvatarState, "UPSET" | "PERSONAL_BOUNDARY">;

export const EXPECTED_ASSET_FILENAMES: Record<AvatarState, string> = {
  IDLE: "Character_idle_loop_animation_20260919112236.mp4",
  THINKING: "thinking.mp4",
  TALKING: "talking.mp4",
  UPSET: "upset.mp4",
  PERSONAL_BOUNDARY: "personal boundaries.mp4",
};

export const STATE_LABELS: Record<AvatarState, string> = {
  IDLE: "Idle",
  THINKING: "Thinking",
  TALKING: "Talking",
  UPSET: "Upset",
  PERSONAL_BOUNDARY: "Personal boundary",
};

export const TRANSIENT_STATES: TransientState[] = ["UPSET", "PERSONAL_BOUNDARY"];

export function isTransient(state: AvatarState): state is TransientState {
  return state === "UPSET" || state === "PERSONAL_BOUNDARY";
}
