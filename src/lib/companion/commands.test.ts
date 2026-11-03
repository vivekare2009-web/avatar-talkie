import { expect, test } from "bun:test";
import { isDuplicateTranscript, looksLikeCommand, normalizeTranscript, parseCommandLocally } from "./browser";
import { swipeIntent } from "./navigation";

test("YT alias opens YouTube and plays the song", () => {
  expect(looksLikeCommand("C2, open YT and play Kesariya")).toBe(true);
  expect(parseCommandLocally("C2, open YT and play Kesariya")).toEqual([{ type: "open_site", site: "youtube" }, { type: "play_youtube", query: "Kesariya" }]);
  expect(parseCommandLocally("You Tube kholo")).toEqual([{ type: "open_site", site: "youtube" }]);
});
test("Hinglish gana chalao plays a song", () => {
  expect(looksLikeCommand("Kesariya gana chalao")).toBe(true);
  expect(parseCommandLocally("Kesariya gana chalao")).toEqual([{ type: "play_youtube", query: "Kesariya" }]);
});
test("English play song", () => {
  expect(looksLikeCommand("play song Tum Hi Ho")).toBe(true);
  expect(parseCommandLocally("play song Tum Hi Ho")).toEqual([{ type: "play_youtube", query: "Tum Hi Ho" }]);
});
test("Google search and browser site commands", () => {
  expect(parseCommandLocally("Google par weather search karo")).toEqual([{ type: "search", engine: "google", query: "weather" }]);
  expect(looksLikeCommand("Browser mein Wikipedia kholo")).toBe(true);
  expect(parseCommandLocally("Browser mein Wikipedia kholo")).toEqual([{ type: "open_site", site: "wikipedia" }]);
});
test("navigation commands", () => {
  for (const [w, t] of [["Back", "back"], ["forward", "forward"], ["C2 refresh", "refresh"], ["home", "home"]] as const) {
    expect(looksLikeCommand(w)).toBe(true);
    expect(parseCommandLocally(w)).toEqual([{ type: t }]);
  }
});
test("duplicate final transcripts are dropped", () => {
  const last = { text: normalizeTranscript("YouTube kholo."), at: 1000 };
  expect(isDuplicateTranscript("youtube kholo", last, 2000)).toBe(true);
  expect(isDuplicateTranscript("youtube kholo", last, 4000)).toBe(false);
});
test("sidebar swipes need the left edge and ignore scrolling", () => {
  expect(swipeIntent({ x: 10, y: 300 }, { x: 120, y: 310 }, false)).toBe("open");
  expect(swipeIntent({ x: 200, y: 300 }, { x: 320, y: 300 }, false)).toBe(null);
  expect(swipeIntent({ x: 10, y: 300 }, { x: 80, y: 420 }, false)).toBe(null);
  expect(swipeIntent({ x: 250, y: 300 }, { x: 120, y: 300 }, true)).toBe("close");
});
