import { test, expect } from "bun:test";
import { formatScoreTable, formatVerdict } from "./formatter";
import type { ScoreResult } from "./scorer";

const goResult: ScoreResult = {
  total: 100,
  go_no_go: "GO",
  items: {
    cpu:    { score: 20, max: 20, label: "40%" },
    memory: { score: 20, max: 20, label: "60%" },
    disk:   { score: 20, max: 20, label: "70%" },
    docker: { score: 20, max: 20, label: "2/2 UP" },
    git:    { score: 20, max: 20, label: "clean" },
  },
};

const cautionResult: ScoreResult = {
  total: 70,
  go_no_go: "CAUTION",
  items: {
    cpu:    { score: 10, max: 20, label: "75%", warning: true },
    memory: { score: 20, max: 20, label: "60%" },
    disk:   { score: 20, max: 20, label: "70%" },
    docker: { score: 0,  max: 20, label: "1/2 UP", details: "worker: Exited (1)", warning: true },
    git:    { score: 20, max: 20, label: "clean" },
  },
};

test("formatVerdict: GO result shows score and GO", () => {
  const out = formatVerdict(goResult);
  expect(out).toContain("100/100");
  expect(out).toContain("GO");
});

test("formatVerdict: CAUTION result shows warning symbol", () => {
  const out = formatVerdict(cautionResult);
  expect(out).toContain("70/100");
  expect(out).toContain("CAUTION");
  expect(out).toContain("⚠");
});

test("formatVerdict: NO-GO hard block shows hard block label", () => {
  const noGoResult: ScoreResult = {
    ...cautionResult,
    total: 40,
    go_no_go: "NO-GO",
    hard_block: "disk_full",
  };
  const out = formatVerdict(noGoResult);
  expect(out).toContain("NO-GO");
  expect(out).toContain("✗");
});

test("formatScoreTable: each row contains the item label", () => {
  const out = formatScoreTable(goResult);
  expect(out).toContain("40%");
  expect(out).toContain("60%");
  expect(out).toContain("2/2 UP");
  expect(out).toContain("clean");
});

test("formatScoreTable: passing items show checkmark and full score", () => {
  const out = formatScoreTable(goResult);
  expect(out).toContain("✓");
  expect(out).toContain("20/20");
});

test("formatScoreTable: failing item shows cross and details", () => {
  const out = formatScoreTable(cautionResult);
  expect(out).toContain("worker: Exited (1)");
  expect(out).toContain("0/20");
});

test("formatScoreTable: has rows for all five categories", () => {
  const out = formatScoreTable(goResult);
  expect(out).toContain("CPU");
  expect(out).toContain("Memory");
  expect(out).toContain("Disk");
  expect(out).toContain("Docker");
  expect(out).toContain("Git");
});
