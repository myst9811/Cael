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

test("buildFrame SHOWING_RESULT renders agentActivity on row before hint", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "⟳ calling get_process_list..." });
  const lines = frame.split("\n");
  const hintIdx = lines.findIndex(l => l.includes("ESC") && l.includes("clear"));
  const activityIdx = lines.findIndex(l => l.includes("calling get_process_list"));
  expect(activityIdx).toBeGreaterThan(-1);
  expect(activityIdx).toBe(hintIdx - 1);
});

test("buildFrame SHOWING_RESULT blank activity row when agentActivity is empty", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  expect(frame).toContain("[ESC] clear");
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

test("buildFrame compact: panel area shows only 3 rows of content (row 4 hidden)", () => {
  // Compact PANEL_ROWS=3 means content rows 4 and 5 are not rendered in the panel area.
  // Total frame height stays the same — saved rows go to the status section.
  const sys5 = ["SYSTEM", " row1", " row2", " row3", " row4", " row5"];
  const compact  = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", compact: true,  lastRefreshAt: 0, systemLines: sys5 });
  const expanded = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", compact: false, lastRefreshAt: 0, systemLines: sys5 });
  expect(compact).not.toContain(" row4");
  expect(expanded).toContain(" row4");
});

test("buildFrame with detailLines null: no detail section", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", detailLines: null, lastRefreshAt: 0 });
  expect(frame).not.toContain("image:");
});

test("buildFrame with detailLines set: detail content appears", () => {
  const frame = buildFrame({
    ...BASE_OPTS, mode: "IDLE", agentActivity: "",
    detailLines: ["  nginx  RUNNING  started 2h ago", "  image: nginx:1.25  ports: none"],
    lastRefreshAt: 0,
  });
  expect(frame).toContain("nginx:1.25");
});

test("buildFrame with detailLines: same total height, detail content replaces status rows", () => {
  const without = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", detailLines: null, lastRefreshAt: 0 });
  const withDetail = buildFrame({
    ...BASE_OPTS, mode: "IDLE", agentActivity: "",
    detailLines: ["  row one", "  row two"],
    lastRefreshAt: 0,
  });
  // Total line count stays the same — detail rows are absorbed from the status section budget
  expect(without.split("\n").length).toBe(withDetail.split("\n").length);
});
