import { useRef } from "react";
import { Move, Scaling } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampZone } from "@/lib/companion/behavior";
import type { TouchZone } from "@/lib/companion/settings";

export function ZoneCalibration({ zones, onChange }: { zones: TouchZone[]; onChange: (zones: TouchZone[]) => void }) {
  const drag = useRef<{ x: number; y: number; zone: TouchZone; resize: boolean } | null>(null);
  return <>{zones.map(zone => <div
    key={zone.id}
    aria-label={`${zone.label} calibration`}
    className="absolute touch-none border-2 border-dashed border-destructive bg-destructive/20"
    style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.w}%`, height: `${zone.h}%` }}
    onPointerDown={event => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, zone, resize: (event.target as Element).closest('[data-resize]') !== null };
    }}
    onPointerMove={event => {
      const start = drag.current;
      const rect = event.currentTarget.parentElement?.getBoundingClientRect();
      if (!start || !rect || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const dx = (event.clientX - start.x) / rect.width * 100;
      const dy = (event.clientY - start.y) / rect.height * 100;
      const next = clampZone(start.resize
        ? { ...start.zone, w: start.zone.w + dx, h: start.zone.h + dy }
        : { ...start.zone, x: start.zone.x + dx, y: start.zone.y + dy });
      onChange(zones.map(item => item.id === zone.id ? next : item));
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }}
  >
    <span className="absolute left-1 top-1 flex items-center gap-1 bg-card/90 px-1 text-[10px] text-foreground"><Move className="h-3 w-3" />{zone.label}</span>
    <Button data-resize variant="destructive" size="icon" className="absolute bottom-0 right-0 h-6 w-6 touch-none" aria-label={`Resize ${zone.label}`} title={`Resize ${zone.label}`}><Scaling className="h-3 w-3" /></Button>
  </div>)}</>;
}