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

test("non-special key in SHOWING_RESULT → no-op (stays in SHOWING_RESULT)", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, aiResponse: "hi" };
  const { state, action } = handleKey(s, " ");
  expect(state.mode).toBe("SHOWING_RESULT");
  expect(state.aiResponse).toBe("hi");
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

test("createWatchState initialises scrollOffset to 0", () => {
  expect(createWatchState().scrollOffset).toBe(0);
});

test("up arrow in SHOWING_RESULT increments scrollOffset without dismissing", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const };
  const { state, action } = handleKey(s, "\x1b[A");
  expect(state.scrollOffset).toBe(1);
  expect(state.mode).toBe("SHOWING_RESULT");
  expect(action).toBe("none");
});

test("down arrow in SHOWING_RESULT decrements scrollOffset (min 0)", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, scrollOffset: 2 };
  const { state } = handleKey(s, "\x1b[B");
  expect(state.scrollOffset).toBe(1);
  expect(state.mode).toBe("SHOWING_RESULT");
});

test("down arrow at scrollOffset 0 stays at 0", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, scrollOffset: 0 };
  const { state } = handleKey(s, "\x1b[B");
  expect(state.scrollOffset).toBe(0);
});

test("non-special key in SHOWING_RESULT → no-op (keeps scrollOffset)", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, scrollOffset: 5 };
  const { state } = handleKey(s, " ");
  expect(state.mode).toBe("SHOWING_RESULT");
  expect(state.scrollOffset).toBe(5);
});

test("/ in SHOWING_RESULT → QUERYING with empty queryInput", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, aiResponse: "some answer", scrollOffset: 3 };
  const { state, action } = handleKey(s, "/");
  expect(state.mode).toBe("QUERYING");
  expect(state.queryInput).toBe("");
  expect(state.scrollOffset).toBe(0);
  expect(action).toBe("none");
});

test("ESC in SHOWING_RESULT → IDLE and clears history", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const, aiResponse: "some answer", scrollOffset: 3 };
  const { state, action } = handleKey(s, "\x1b");
  expect(state.mode).toBe("IDLE");
  expect(state.aiResponse).toBe("");
  expect(state.scrollOffset).toBe(0);
  expect(action).toBe("none");
});

// ── M2: docker navigation, container selection, compact ──────────────────────

test("createWatchState: new M2 fields initialise correctly", () => {
  const s = createWatchState();
  expect(s.dockerCursor).toBe(-1);
  expect(s.panelFocus).toBeNull();
  expect(s.selectedContainer).toBeNull();
  expect(s.compactMode).toBe(false);
});

test("down arrow in IDLE with containers moves cursor to 0", () => {
  const { state } = handleKey(createWatchState(), "\x1b[B", ["api", "db"]);
  expect(state.dockerCursor).toBe(0);
  expect(state.panelFocus).toBe("docker");
});

test("up arrow in IDLE with containers wraps to last container", () => {
  const { state } = handleKey(createWatchState(), "\x1b[A", ["api", "db"]);
  expect(state.dockerCursor).toBe(1);
});

test("down arrow wraps from last container back to 0", () => {
  const s = { ...createWatchState(), dockerCursor: 1, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\x1b[B", ["api", "db"]);
  expect(state.dockerCursor).toBe(0);
});

test("up arrow decrements cursor", () => {
  const s = { ...createWatchState(), dockerCursor: 1, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\x1b[A", ["api", "db"]);
  expect(state.dockerCursor).toBe(0);
});

test("arrow keys are no-ops in IDLE with no containers", () => {
  const { state } = handleKey(createWatchState(), "\x1b[B", []);
  expect(state.dockerCursor).toBe(-1);
  expect(state.panelFocus).toBeNull();
});

test("Enter in IDLE with docker focused sets selectedContainer", () => {
  const s = { ...createWatchState(), dockerCursor: 0, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\r", ["api", "db"]);
  expect(state.selectedContainer).toBe("api");
});

test("Enter in IDLE toggles off selectedContainer when already selected", () => {
  const s = { ...createWatchState(), dockerCursor: 0, panelFocus: "docker" as const, selectedContainer: "api" };
  const { state } = handleKey(s, "\r", ["api", "db"]);
  expect(state.selectedContainer).toBeNull();
});

test("ESC in IDLE with selectedContainer closes detail only (keeps cursor)", () => {
  const s = { ...createWatchState(), dockerCursor: 0, panelFocus: "docker" as const, selectedContainer: "api" };
  const { state } = handleKey(s, "\x1b", ["api"]);
  expect(state.selectedContainer).toBeNull();
  expect(state.dockerCursor).toBe(0);
});

test("ESC in IDLE with cursor but no selectedContainer clears cursor", () => {
  const s = { ...createWatchState(), dockerCursor: 1, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\x1b", ["api", "db"]);
  expect(state.dockerCursor).toBe(-1);
  expect(state.panelFocus).toBeNull();
});

test("z in IDLE toggles compactMode on and off", () => {
  const s = createWatchState();
  const { state: s1 } = handleKey(s, "z");
  expect(s1.compactMode).toBe(true);
  const { state: s2 } = handleKey(s1, "z");
  expect(s2.compactMode).toBe(false);
});

test("z in SHOWING_RESULT toggles compactMode", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const };
  const { state } = handleKey(s, "z");
  expect(state.compactMode).toBe(true);
});
