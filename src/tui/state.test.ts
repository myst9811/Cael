import { test, expect } from "bun:test";
import { createWatchState, handleKey } from "./state";

test("initial state is IDLE", () => {
  expect(createWatchState().mode).toBe("IDLE");
});

test("/ in IDLE → QUERYING", () => {
  const { state, action } = handleKey(createWatchState(), "/");
  expect(state.mode).toBe("QUERYING");
  expect(action).toBe("none");
});

test("q in IDLE → quit action", () => {
  const { action } = handleKey(createWatchState(), "q");
  expect(action).toBe("quit");
});

test("ESC in QUERYING → IDLE", () => {
  let { state } = handleKey(createWatchState(), "/");
  ({ state } = handleKey(state, "\x1b"));
  expect(state.mode).toBe("IDLE");
});

test("Ctrl+C in QUERYING → quit action", () => {
  let { state } = handleKey(createWatchState(), "/");
  const { action } = handleKey(state, "\x03");
  expect(action).toBe("quit");
});

test("typing in QUERYING appends to queryInput", () => {
  let { state } = handleKey(createWatchState(), "/");
  ({ state } = handleKey(state, "h"));
  ({ state } = handleKey(state, "e"));
  ({ state } = handleKey(state, "y"));
  expect(state.queryInput).toBe("hey");
});

test("backspace removes last char in QUERYING", () => {
  let { state } = handleKey(createWatchState(), "/");
  ({ state } = handleKey(state, "h"));
  ({ state } = handleKey(state, "i"));
  ({ state } = handleKey(state, "\x7f"));
  expect(state.queryInput).toBe("h");
});

test("Enter with text → submit action", () => {
  let { state } = handleKey(createWatchState(), "/");
  ({ state } = handleKey(state, "x"));
  const { action } = handleKey(state, "\r");
  expect(action).toBe("submit");
});

test("Enter with empty queryInput → no action", () => {
  let { state } = handleKey(createWatchState(), "/");
  const { action } = handleKey(state, "\r");
  expect(action).toBe("none");
  expect(state.mode).toBe("QUERYING");
});

test("any printable key in SHOWING_RESULT → back to IDLE", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, aiResponse: "hi" };
  const { state, action } = handleKey(s, " ");
  expect(state.mode).toBe("IDLE");
  expect(state.aiResponse).toBe("");
  expect(action).toBe("none");
});

test("q in SHOWING_RESULT → quit action", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, aiResponse: "hi" };
  const { action } = handleKey(s, "q");
  expect(action).toBe("quit");
});

test("ESC clears queryInput when returning to IDLE", () => {
  let { state } = handleKey(createWatchState(), "/");
  ({ state } = handleKey(state, "a"));
  ({ state } = handleKey(state, "b"));
  ({ state } = handleKey(state, "\x1b"));
  expect(state.queryInput).toBe("");
  expect(state.mode).toBe("IDLE");
});

test("createWatchState initialises agentActivity to empty string", () => {
  expect(createWatchState().agentActivity).toBe("");
});
