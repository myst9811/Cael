import { test, expect } from "bun:test";
import { buildFrame } from "./draw";

const BASE_OPTS = {
  cols: 80,
  rows: 24,
  systemLines: ["SYSTEM", "  cpu 5%"],
  dockerLines: ["DOCKER", "  unavailable"],
  gitLines: ["GIT", "  main"],
  alerts: [],
  timestamp: "12:00:00",
  queryInput: "what is using memory?",
  aiResponse: "The top consumer is Bun.",
  statusError: null,
};

test("buildFrame SHOWING_RESULT renders agentActivity on row before dismiss", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "⟳ calling get_process_list..." });
  const lines = frame.split("\n");
  const dismissIdx = lines.findIndex(l => l.includes("any key to dismiss"));
  const activityIdx = lines.findIndex(l => l.includes("calling get_process_list"));
  expect(activityIdx).toBeGreaterThan(-1);
  expect(activityIdx).toBe(dismissIdx - 1);
});

test("buildFrame SHOWING_RESULT blank activity row when agentActivity is empty", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  expect(frame).toContain("any key to dismiss");
});

test("buildFrame SHOWING_RESULT same line count with and without agentActivity", () => {
  const withActivity = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "⟳ calling X..." });
  const withoutActivity = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  expect(withActivity.split("\n").length).toBe(withoutActivity.split("\n").length);
});

test("buildFrame IDLE same line count as SHOWING_RESULT", () => {
  const idle = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "" });
  const showing = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  expect(idle.split("\n").length).toBe(showing.split("\n").length);
});

test("buildFrame shows scroll hint when response overflows visible area", () => {
  const longResponse = Array(50).fill("line of text that wraps across the frame").join(" ");
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "", aiResponse: longResponse });
  expect(frame).toContain("↑↓");
});

test("buildFrame same line count with scrollOffset > 0 as scrollOffset 0", () => {
  const longResponse = Array(50).fill("overflow line").join(" ");
  const atBottom = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "", aiResponse: longResponse, scrollOffset: 0 });
  const scrolledUp = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "", aiResponse: longResponse, scrollOffset: 5 });
  expect(atBottom.split("\n").length).toBe(scrolledUp.split("\n").length);
});
