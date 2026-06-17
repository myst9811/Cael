import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePsOutput } from "./process";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parsePsOutput: parses first process from macOS ps output", () => {
  const result = parsePsOutput(fixture("macos-ps.txt"));
  expect(result.length).toBeGreaterThan(0);
  const first = result[0];
  expect(first.pid).toBe(39899);
  expect(first.user).toBe("shannensaikia");
  expect(first.cpu_percent).toBe(12.3);
  expect(first.mem_mb).toBeGreaterThan(0);
  expect(first.name).toBe("claude");
});

test("parsePsOutput: RSS is converted from KB to MB", () => {
  const result = parsePsOutput(fixture("macos-ps.txt"));
  const first = result[0];
  // RSS=387120 KB → 378 MB
  expect(first.mem_mb).toBeCloseTo(387120 / 1024, 0);
});

test("parsePsOutput: extracts process name from path", () => {
  const result = parsePsOutput(fixture("macos-ps.txt"));
  const ecosystemd = result.find(p => p.name === "ecosystemd");
  expect(ecosystemd).toBeDefined();
});

test("parsePsOutput: parses processes from Linux ps output", () => {
  const result = parsePsOutput(fixture("linux-ps.txt"));
  expect(result.length).toBeGreaterThan(0);
  const nginx = result.find(p => p.command.includes("nginx"));
  expect(nginx).toBeDefined();
  expect(nginx!.cpu_percent).toBe(5.3);
  expect(nginx!.user).toBe("www-data");
});

test("parsePsOutput: returns empty array for header-only output", () => {
  const header = "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n";
  expect(parsePsOutput(header)).toHaveLength(0);
});

test("parsePsOutput: skips lines with non-numeric PID", () => {
  const output =
    "USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND\n" +
    "root notapid 0.0 0.1 1000 2000 ? Ss 09:00 0:00 init\n";
  expect(parsePsOutput(output)).toHaveLength(0);
});

test("parsePsOutput: all processes have positive mem_mb", () => {
  const result = parsePsOutput(fixture("macos-ps.txt"));
  for (const p of result) {
    expect(p.mem_mb).toBeGreaterThanOrEqual(0);
  }
});
