import { test, expect } from "bun:test";
import { extractTimeline, formatTimeline } from "./timeline";
import type { PostmortemContext } from "./context";

function makeCtx(gitTimelineLog: string, containerLogs: PostmortemContext["containerLogs"]): PostmortemContext {
  return {
    timestamp: "2026-06-26T12:00:00Z",
    systemMetrics: "",
    dockerStatus: "",
    containerLogs,
    gitLog: "",
    gitTimelineLog,
    gitLastCommit: "",
    topProcesses: "",
  };
}

const GIT_LOG = `abc1234abcdef 2026-06-26T10:00:01+00:00 fix: bump connection pool size
def5678defabc 2026-06-26T10:05:00+00:00 chore: update deps`;

const CONTAINER_LOGS = [
  {
    name: "api",
    truncated: false,
    logs: [
      "2026-06-26T10:00:03Z ERROR [123] Database connection failed",
      "2026-06-26T10:00:04Z ERROR [124] Database connection failed",
      "2026-06-26T10:00:05Z INFO  Request started",
    ].join("\n"),
  },
];

test("extractTimeline: parses git commits into events", () => {
  const events = extractTimeline(makeCtx(GIT_LOG, []));
  const gitEvents = events.filter(e => e.source === "git");
  expect(gitEvents.length).toBe(2);
  expect(gitEvents[0]!.timestamp).toBe("2026-06-26T10:00:01+00:00");
  expect(gitEvents[0]!.message).toContain("fix: bump connection pool");
});

test("extractTimeline: parses container log timestamps", () => {
  const events = extractTimeline(makeCtx("", CONTAINER_LOGS));
  const logEvents = events.filter(e => e.source === "log");
  expect(logEvents.length).toBeGreaterThan(0);
  expect(logEvents[0]!.container).toBe("api");
});

test("extractTimeline: sorts events by timestamp ascending", () => {
  const events = extractTimeline(makeCtx(GIT_LOG, CONTAINER_LOGS));
  const timed = events.filter(e => e.timestamp !== "");
  for (let i = 1; i < timed.length; i++) {
    expect(timed[i]!.timestamp >= timed[i - 1]!.timestamp).toBe(true);
  }
});

test("extractTimeline: deduplicates repeated log lines into one entry", () => {
  const repeatedLogs = [
    {
      name: "api", truncated: false,
      logs: [
        "2026-06-26T10:00:01Z ERROR Database connection failed",
        "2026-06-26T10:00:02Z ERROR Database connection failed",
        "2026-06-26T10:00:03Z ERROR Database connection failed",
      ].join("\n"),
    },
  ];
  const events = extractTimeline(makeCtx("", repeatedLogs));
  const logEvents = events.filter(e => e.source === "log");
  expect(logEvents.length).toBe(1);
  expect(logEvents[0]!.message).toContain("×3");
  // Grouped event should be anchored to the FIRST occurrence's timestamp
  expect(logEvents[0]!.timestamp).toContain("10:00:01");
});

test("extractTimeline: untimed events appear after all timed events", () => {
  const mixedLogs = [
    {
      name: "api", truncated: false,
      logs: ["no timestamp here", "2026-06-26T10:00:01Z INFO ready"].join("\n"),
    },
  ];
  const events = extractTimeline(makeCtx("", mixedLogs));
  const firstUntimed = events.findIndex(e => e.timestamp === "");
  const lastTimed = events.map((e, i) => e.timestamp !== "" ? i : -1).filter(i => i >= 0).pop() ?? -1;
  if (firstUntimed >= 0 && lastTimed >= 0) {
    expect(firstUntimed).toBeGreaterThan(lastTimed);
  }
});

test("formatTimeline: returns a markdown table with header row", () => {
  const events = extractTimeline(makeCtx(GIT_LOG, CONTAINER_LOGS));
  const table = formatTimeline(events);
  expect(table).toContain("| Time |");
  expect(table).toContain("| Source |");
  expect(table).toContain("| Message |");
  expect(table).toContain("|---");
});

test("formatTimeline: empty events returns empty string", () => {
  expect(formatTimeline([])).toBe("");
});
