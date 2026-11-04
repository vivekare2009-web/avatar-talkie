import { expect, test } from "bun:test";
import { buildSystemPrompt, eligibleCheckIn, parseTags, prepareSpeech, requestsQuiet, retryDelay, SendGuard, speechChunks, type IdleConditions, type IdleState } from "./conversation";
import { DEFAULT_SETTINGS } from "./settings";

const state: IdleState = { lastInteraction: 0, lastCheckIn: null, consumed: false, quiet: false };
const conditions: IdleConditions = { enabled: true, visible: true, chat: true, ready: true, busy: false, speaking: false, listening: false, media: false };
test("check-ins start at 75 seconds only after engagement", () => {
  expect(eligibleCheckIn(74_999, state, conditions)).toBe(false);
  expect(eligibleCheckIn(75_000, state, conditions)).toBe(true);
  expect(eligibleCheckIn(75_000, { ...state, lastInteraction: null }, conditions)).toBe(false);
});
test("five-minute cooldown and one per idle period", () => {
  expect(eligibleCheckIn(299_999, { ...state, lastCheckIn: 0 }, conditions)).toBe(false);
  expect(eligibleCheckIn(300_000, { ...state, lastCheckIn: 0 }, conditions)).toBe(true);
  expect(eligibleCheckIn(600_000, { ...state, consumed: true }, conditions)).toBe(false);
});
test("hidden, nonchat, disabled, unready, mic, speech, request and media suppress check-ins", () => {
  for (const key of ["enabled", "visible", "chat", "ready"] as const) expect(eligibleCheckIn(80_000, state, { ...conditions, [key]: false })).toBe(false);
  for (const key of ["busy", "speaking", "listening", "media"] as const) expect(eligibleCheckIn(80_000, state, { ...conditions, [key]: true })).toBe(false);
});
test("quiet requests suppress unsolicited conversation", () => {
  for (const text of ["leave it", "don't ask", "I want quiet", "rehne do", "mat poocho", "चुप रहो"]) expect(requestsQuiet(text)).toBe(true);
  expect(requestsQuiet("kuch nahi")).toBe(false);
  expect(eligibleCheckIn(80_000, { ...state, quiet: true }, conditions)).toBe(false);
});
test("proactive default on and device fallback configurable", () => {
  expect(DEFAULT_SETTINGS.proactiveConversation).toBe(true);
  expect(DEFAULT_SETTINGS.deviceVoiceFallback).toBe(true);
});
test("memory and mood tags stay hidden in parsed and spoken output", () => {
  const raw = 'Achha! <<REMEMBER key="city" value="Delhi">> <<MOOD upset>>';
  expect(parseTags(raw)).toEqual({ text: "Achha!", saved: [{ key: "city", value: "Delhi" }], mood: "upset" });
  expect(prepareSpeech(raw)).toBe("Achha!");
  expect(prepareSpeech('Hi <<REMEMBER key="broken')).toBe("Hi");
});
test("speech preserves punctuation and chunks without dropping words", () => {
  expect(prepareSpeech("**Hello!** Kaise ho? ठीक हो।")).toBe("Hello! Kaise ho? ठीक हो।");
  const text = "Hello there. ".repeat(150).trim();
  expect(speechChunks(text).join(" ")).toBe(text);
  expect(speechChunks(text).every(chunk => chunk.length <= 700)).toBe(true);
});
test("prompt retains context and tag contract while modes differ", () => {
  const prompt = buildSystemPrompt("hinglish", "Vivek", [{ key: "interest", value: "music" }]);
  expect(prompt.includes("music")).toBe(true);
  expect(prompt.includes("<<REMEMBER")).toBe(true);
  expect(prompt).not.toBe(buildSystemPrompt("en", "Vivek", [], "checkin"));
});
test("send admission prevents simultaneous sends and invalidates stale completion", () => {
  const guard = new SendGuard(); const first = guard.acquire();
  expect(first).not.toBeNull(); expect(guard.acquire()).toBeNull();
  if (first === null) throw new Error("missing token");
  guard.invalidate(); expect(guard.isCurrent(first)).toBe(false);
  const second = guard.acquire(); expect(second).not.toBeNull();
  guard.release(first); expect(guard.busy).toBe(true);
  if (second !== null) guard.release(second);
  expect(guard.busy).toBe(false);
});
test("only 429 and server errors get one delayed retry", () => {
  for (const status of [400, 401, 402, 403, 404, 422]) expect(retryDelay(status, 0)).toBeNull();
  expect(retryDelay(429, 0, "2")).toBe(2000);
  expect(retryDelay(503, 0)).toBeGreaterThanOrEqual(1000);
  expect(retryDelay(503, 1)).toBeNull();
  expect(retryDelay(429, 0, "60")).toBeNull();
});