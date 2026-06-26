import { test, expect } from "bun:test";
import { analyzeLogLines } from "./log-patterns";

const SAMPLE_LOGS = [
  "2026-06-26T10:00:01Z ERROR [123] Database connection failed",
  "2026-06-26T10:00:02Z ERROR [124] Database connection failed",
  "2026-06-26T10:00:03Z ERROR [125] Database connection failed",
  "2026-06-26T10:00:04Z WARN  [126] Retrying in 5s",
  "2026-06-26T10:00:05Z INFO  [127] Starting worker",
  "2026-06-26T10:00:06Z ERROR [128] Database connection failed",
  "2026-06-26T10:00:07Z INFO  [129] Request processed successfully",
];

test("analyzeLogLines: top pattern is the most frequent message", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  expect(result.patterns[0]!.count).toBe(4);
  expect(result.patterns[0]!.pattern).toContain("Database connection failed");
});

test("analyzeLogLines: error_count counts ERROR lines", () => {
  expect(analyzeLogLines(SAMPLE_LOGS).error_count).toBe(4);
});

test("analyzeLogLines: warn_count counts WARN lines", () => {
  expect(analyzeLogLines(SAMPLE_LOGS).warn_count).toBe(1);
});

test("analyzeLogLines: lines_analyzed equals actual input size", () => {
  expect(analyzeLogLines(SAMPLE_LOGS).lines_analyzed).toBe(7);
});

test("analyzeLogLines: top pattern has first_seen and last_seen timestamps", () => {
  const top = analyzeLogLines(SAMPLE_LOGS).patterns[0]!;
  expect(top.first_seen).toBe("2026-06-26T10:00:01");
  expect(top.last_seen).toBe("2026-06-26T10:00:06");
});

test("analyzeLogLines: top pattern level is error", () => {
  expect(analyzeLogLines(SAMPLE_LOGS).patterns[0]!.level).toBe("error");
});

test("analyzeLogLines: empty input returns zero counts", () => {
  const result = analyzeLogLines([]);
  expect(result.error_count).toBe(0);
  expect(result.warn_count).toBe(0);
  expect(result.patterns).toHaveLength(0);
  expect(result.lines_analyzed).toBe(0);
});

test("analyzeLogLines: returns at most 10 patterns", () => {
  const many = Array.from({ length: 30 }, (_, i) => `2026-06-26T10:00:00Z INFO unique message number ${i}`);
  expect(analyzeLogLines(many).patterns.length).toBeLessThanOrEqual(10);
});
