import type { TouchZone } from "./settings";

/** Frame coordinates stay below the character's head and inside the video. */
export function clampZone(zone: TouchZone): TouchZone {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const w = Math.max(5, Math.min(80, finite(zone.w, 32)));
  const h = Math.max(5, Math.min(74, finite(zone.h, 12)));
  return {
    ...zone, w, h,
    x: Math.max(0, Math.min(100 - w, finite(zone.x, 34))),
    y: Math.max(26, Math.min(100 - h, finite(zone.y, 28))),
  };
}

export function touchedZone(zones: TouchZone[], x: number, y: number) {
  return zones.find(zone => x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h) ?? null;
}

export function boundaryAllowed(zone: TouchZone | null, enabled: boolean, protectedEnabled: boolean, now: number, last: number | null, cooldown: number) {
  return enabled && protectedEnabled && Boolean(zone?.protected) && (last === null || now - last >= cooldown);
}

export function songTitleFromRequest(text: string): string | null {
  const match = text.trim().match(/^(?:play\s+(.+)|(.+?)\s+(?:play\s+karo|bajao|chalao))\s*[.!?]*$/i);
  return (match?.[1] ?? match?.[2])?.trim() || null;
}

export function estimateBudget(inputTokens: number, outputTokens: number, inputRate: number, outputRate: number, budget: number) {
  if (inputRate <= 0 || outputRate <= 0) return null;
  const used = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
  return { used, remaining: budget > 0 ? Math.max(0, budget - used) : null };
}