import { test, expect } from "bun:test";
import { parseTimeSince } from "./time-parser";

// ── Valid durations ───────────────────────────────────────────────────────────

test("30m passes through as-is", () => {
  expect(parseTimeSince("30m")).toBe("30m");
});

test("2h passes through as-is", () => {
  expect(parseTimeSince("2h")).toBe("2h");
});

test("45s passes through as-is", () => {
  expect(parseTimeSince("45s")).toBe("45s");
});

test("1h30m compound passes through", () => {
  expect(parseTimeSince("1h30m")).toBe("1h30m");
});

test("2h45m30s compound passes through", () => {
  expect(parseTimeSince("2h45m30s")).toBe("2h45m30s");
});

// ── Day conversion ────────────────────────────────────────────────────────────

test("1d converts to 24h", () => {
  expect(parseTimeSince("1d")).toBe("24h");
});

test("2d converts to 48h", () => {
  expect(parseTimeSince("2d")).toBe("48h");
});

test("7d converts to 168h", () => {
  expect(parseTimeSince("7d")).toBe("168h");
});

// ── ISO timestamps ────────────────────────────────────────────────────────────

test("ISO datetime with Z passes through", () => {
  expect(parseTimeSince("2026-06-17T14:00:00Z")).toBe("2026-06-17T14:00:00Z");
});

test("ISO date-only passes through", () => {
  expect(parseTimeSince("2026-06-17")).toBe("2026-06-17");
});

test("ISO datetime with offset passes through", () => {
  expect(parseTimeSince("2026-06-17T14:00:00+05:30")).toBe("2026-06-17T14:00:00+05:30");
});

// ── Invalid inputs ────────────────────────────────────────────────────────────

test("empty string returns null", () => {
  expect(parseTimeSince("")).toBeNull();
  expect(parseTimeSince("   ")).toBeNull();
});

test("plain word returns null", () => {
  expect(parseTimeSince("yesterday")).toBeNull();
  expect(parseTimeSince("invalid")).toBeNull();
});

test("decimal duration returns null", () => {
  expect(parseTimeSince("1.5h")).toBeNull();
});

test("bare number with no unit returns null", () => {
  expect(parseTimeSince("30")).toBeNull();
});

test("compound duration with d returns null (unsupported)", () => {
  expect(parseTimeSince("2d12h")).toBeNull();
});

test("invalid ISO date returns null", () => {
  expect(parseTimeSince("2026-99-99")).toBeNull();
});
