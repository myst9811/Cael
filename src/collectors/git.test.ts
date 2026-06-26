import { test, expect } from "bun:test";
import { parseGitShortStatus, parseUnpushedCount, parseDirtyFilePaths, parseBehindCount } from "./git";

test("parseGitShortStatus: counts dirty files (modified, added, deleted)", () => {
  const output = " M src/foo.ts\nM  src/bar.ts\nA  src/new.ts\n D src/old.ts\n";
  const result = parseGitShortStatus(output);
  expect(result.dirty).toBe(4);
  expect(result.untracked).toBe(0);
});

test("parseGitShortStatus: counts untracked files separately", () => {
  const output = "?? newfile.ts\n?? another.txt\n M src/modified.ts\n";
  const result = parseGitShortStatus(output);
  expect(result.dirty).toBe(1);
  expect(result.untracked).toBe(2);
});

test("parseGitShortStatus: returns zeros for clean repo", () => {
  expect(parseGitShortStatus("")).toEqual({ dirty: 0, untracked: 0 });
  expect(parseGitShortStatus("   \n  ")).toEqual({ dirty: 0, untracked: 0 });
});

test("parseGitShortStatus: handles mixed dirty and untracked", () => {
  const output = " M src/a.ts\n?? b.ts\nD  src/c.ts\n?? d.txt\n";
  const result = parseGitShortStatus(output);
  expect(result.dirty).toBe(2);
  expect(result.untracked).toBe(2);
});

test("parseUnpushedCount: returns number for valid git rev-list output", () => {
  expect(parseUnpushedCount("3")).toBe(3);
  expect(parseUnpushedCount("0")).toBe(0);
  expect(parseUnpushedCount("  2  \n")).toBe(2);
});

test("parseUnpushedCount: returns null when no upstream branch", () => {
  expect(parseUnpushedCount("no-upstream")).toBeNull();
});

test("parseUnpushedCount: returns null for empty string (git error)", () => {
  expect(parseUnpushedCount("")).toBeNull();
  expect(parseUnpushedCount("   ")).toBeNull();
});

test("parseUnpushedCount: returns null for non-numeric output", () => {
  expect(parseUnpushedCount("fatal: no upstream")).toBeNull();
});

test("parseDirtyFilePaths: returns paths including untracked files", () => {
  const output = " M src/foo.ts\nM  src/bar.ts\nA  src/new.ts\n?? untracked.ts\n";
  expect(parseDirtyFilePaths(output)).toEqual(["src/foo.ts", "src/bar.ts", "src/new.ts", "untracked.ts"]);
});

test("parseDirtyFilePaths: empty output returns empty array", () => {
  expect(parseDirtyFilePaths("")).toEqual([]);
});

test("parseDirtyFilePaths: untracked lockfile is included (deploy risk)", () => {
  expect(parseDirtyFilePaths("?? bun.lock\n")).toEqual(["bun.lock"]);
});

test("parseBehindCount: parses numeric output", () => {
  expect(parseBehindCount("3")).toBe(3);
  expect(parseBehindCount("0")).toBe(0);
});

test("parseBehindCount: returns null for no upstream", () => {
  expect(parseBehindCount("no-upstream")).toBeNull();
  expect(parseBehindCount("")).toBeNull();
  expect(parseBehindCount("fatal: no upstream")).toBeNull();
});
