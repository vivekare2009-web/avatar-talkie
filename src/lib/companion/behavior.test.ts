import { describe, expect, test } from "bun:test";
import { boundaryAllowed, clampZone, estimateBudget, songTitleFromRequest, touchedZone } from "./behavior";
import { DEFAULT_SETTINGS, DEFAULT_ZONES } from "./settings";
import { detectLanguage, resolveReplyLanguage } from "./language";
import { AvatarVideoStateManager } from "./AvatarVideoStateManager";

describe("protected touches", () => {
  test("protected zones are off until explicitly enabled", () => {
    expect(DEFAULT_SETTINGS.protectedZonesEnabled).toBe(false);
    expect(boundaryAllowed(DEFAULT_ZONES[0] ?? null, true, false, 9000, null, 8000)).toBe(false);
  });
  test("ordinary head taps never trigger a boundary", () => {
    const zone = touchedZone(DEFAULT_ZONES, 50, 20);
    expect(zone).toBe(null);
    expect(boundaryAllowed(zone, true, true, 9000, null, 8000)).toBe(false);
  });
  test("one reaction per configured cooldown", () => {
    const zone = touchedZone(DEFAULT_ZONES, 50, 33);
    expect(boundaryAllowed(zone, true, true, 100, null, 8000)).toBe(true);
    expect(boundaryAllowed(zone, true, true, 7999, 0, 8000)).toBe(false);
    expect(boundaryAllowed(zone, true, true, 8000, 0, 8000)).toBe(true);
  });
  test("calibration never crosses head or frame edges", () => {
    const base = DEFAULT_ZONES[0];
    if (!base) throw new Error("Chest zone missing");
    const zone = clampZone({ ...base, x: 95, y: 0, w: 30, h: 12 });
    expect(zone.x).toBe(70);
    expect(zone.y).toBe(26);
  });
});

test("one-shot reactions return to prior sustained state", () => {
  const manager = new AvatarVideoStateManager();
  manager.setSustained("THINKING");
  manager.playTransient("PERSONAL_BOUNDARY");
  expect(manager.state).toBe("PERSONAL_BOUNDARY");
  manager.endTransient();
  expect(manager.state).toBe("THINKING");
  manager.dispose();
});

test("Hindi and Hinglish preserve response language", () => {
  expect(resolveReplyLanguage("mera naam Vivek hai", "hinglish").language).toBe("hinglish");
  expect(detectLanguage("आप कैसे हैं?").language).toBe("hi");
  expect(resolveReplyLanguage("English mein bolo", "hinglish").language).toBe("en");
  expect(resolveReplyLanguage("How are you today?", "hinglish").language).toBe("en");
});

test("song requests retain the requested title", () => {
  expect(songTitleFromRequest("Kaho Na Kaho play karo")).toBe("Kaho Na Kaho");
  expect(songTitleFromRequest("play Kaho Na Kaho")).toBe("Kaho Na Kaho");
  expect(songTitleFromRequest("Can you explain how to play chess?")).toBe(null);
});

test("budget estimates use entered rates, never invented prices", () => {
  expect(estimateBudget(1000, 500, 0, 0, 10)).toBe(null);
  expect(estimateBudget(1_000_000, 500_000, 1, 2, 10)).toEqual({ used: 2, remaining: 8 });
});