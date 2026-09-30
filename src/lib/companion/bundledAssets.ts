import type { AvatarState } from "./avatarStates";
import idle from "@/assets/avatar/Character_idle_loop_animation_20260919112236.mp4.asset.json";
import thinking from "@/assets/avatar/thinking.mp4.asset.json";
import talking from "@/assets/avatar/talking.mp4.asset.json";
import upset from "@/assets/avatar/upset.mp4.asset.json";
import boundary from "@/assets/avatar/personal_boundaries.mp4.asset.json";

/** The user's original clips, hosted on the CDN. Device uploads override these. */
export const BUNDLED_CLIPS: Record<AvatarState, string> = {
  IDLE: idle.url,
  THINKING: thinking.url,
  TALKING: talking.url,
  UPSET: upset.url,
  PERSONAL_BOUNDARY: boundary.url,
};
