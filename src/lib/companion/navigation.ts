/** Pure sidebar gesture rules (browser-safe, tested). */
export const EDGE_ZONE_PX = 24;
export const SWIPE_MIN_PX = 60;

export type SidebarSection = "chat" | "gallery" | "outfit" | "settings" | "memory";

/** Decide whether a finished horizontal drag should open/close the drawer. */
export function swipeIntent(start: { x: number; y: number }, end: { x: number; y: number }, open: boolean): "open" | "close" | null {
  const dx = end.x - start.x, dy = end.y - start.y;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx) * 0.6) return null; // vertical scroll wins
  if (!open && dx > 0 && start.x <= EDGE_ZONE_PX) return "open";
  if (open && dx < 0) return "close";
  return null;
}

/** Elements that own their own pointer gestures must never start a sidebar swipe. */
export const GESTURE_EXEMPT = "input,textarea,select,button,a,[role=slider],[data-no-swipe],iframe";
