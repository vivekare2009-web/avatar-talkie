import { useCallback, useRef } from "react";

import type { TouchZone } from "@/lib/companion/settings";
import { cn } from "@/lib/utils";

export type TouchResult = {
  zone: TouchZone | null;
  blockedByCooldown: boolean;
  triggeredBoundary: boolean;
};

export type AvatarTouchLayerProps = {
  enabled: boolean;
  protectedZonesEnabled: boolean;
  zones: TouchZone[];
  cooldownMs: number;
  showZones: boolean;
  onTouch: (result: TouchResult) => void;
};

/**
 * Transparent tap surface over the avatar. Ordinary taps land on "ordinary"
 * areas and never trigger a boundary reaction. Protected zones only exist once
 * the user switches them on in Settings.
 */
export function AvatarTouchLayer({
  enabled,
  protectedZonesEnabled,
  zones,
  cooldownMs,
  showZones,
  onTouch,
}: AvatarTouchLayerProps) {
  const lastBoundaryAt = useRef(0);

  const handlePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;

      const zone =
        zones.find((z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) ?? null;

      const isProtected = Boolean(zone?.protected) && protectedZonesEnabled;
      if (!isProtected) {
        onTouch({ zone, blockedByCooldown: false, triggeredBoundary: false });
        return;
      }

      const now = Date.now();
      if (now - lastBoundaryAt.current < cooldownMs) {
        onTouch({ zone, blockedByCooldown: true, triggeredBoundary: false });
        return;
      }
      lastBoundaryAt.current = now;
      onTouch({ zone, blockedByCooldown: false, triggeredBoundary: true });
    },
    [enabled, protectedZonesEnabled, zones, cooldownMs, onTouch],
  );

  return (
    <div className="absolute inset-0" onPointerDown={handlePointer} role="presentation">
      {showZones &&
        zones.map((zone) => {
          const active = zone.protected && protectedZonesEnabled;
          return (
            <div
              key={zone.id}
              className={cn(
                "pointer-events-none absolute rounded-lg border-2 border-dashed text-[10px] font-medium",
                active ? "border-destructive/80 bg-destructive/10" : "border-accent/70 bg-accent/10",
              )}
              style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
            >
              <span className="absolute left-1 top-1 rounded bg-surface-deep/70 px-1 text-foreground">
                {zone.label}
                {active ? " · protected" : ""}
              </span>
            </div>
          );
        })}
    </div>
  );
}
