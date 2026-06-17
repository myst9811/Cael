import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseMacOSMemory, parseLinuxMemory, parseMacOSCpu, parseLinuxCpu, parseDisk } from "./system";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parseMacOSMemory: extracts page size from header and computes total/used GB", () => {
  const result = parseMacOSMemory(fixture("macos-vm_stat.txt"));
  // total = (9897+205807+203776+875+155153+433950) * 16384 bytes
  expect(result.total_gb).toBeCloseTo(15.4, 0);
  expect(result.used_gb).toBeCloseTo(15.25, 0);
  expect(result.percent).toBeGreaterThan(95);
});

test("parseMacOSMemory: used is always less than total", () => {
  const result = parseMacOSMemory(fixture("macos-vm_stat.txt"));
  expect(result.used_gb).toBeLessThanOrEqual(result.total_gb);
});

test("parseMacOSMemory: returns zeros for empty input", () => {
  const result = parseMacOSMemory("");
  expect(result.total_gb).toBe(0);
  expect(result.used_gb).toBe(0);
  expect(result.percent).toBe(0);
});

test("parseLinuxMemory: extracts total and used GB from /proc/meminfo", () => {
  const result = parseLinuxMemory(fixture("linux-meminfo.txt"));
  // MemTotal 16384000 kB → 15.625 GB; MemAvailable 8192000 kB → used = 7.8125 GB
  expect(result.total_gb).toBeCloseTo(15.625, 0);
  expect(result.used_gb).toBeCloseTo(7.8125, 0);
  expect(result.percent).toBeCloseTo(50, 1);
});

test("parseLinuxMemory: percent matches used/total ratio", () => {
  const result = parseLinuxMemory(fixture("linux-meminfo.txt"));
  const expectedPercent = (result.used_gb / result.total_gb) * 100;
  expect(result.percent).toBeCloseTo(expectedPercent, 1);
});

test("parseMacOSCpu: uses second sample (last CPU usage line)", () => {
  const result = parseMacOSCpu(fixture("macos-top.txt"));
  // Second sample: CPU usage: 5.96% user, 3.64% sys, 90.39% idle → 9.61%
  expect(result).toBeCloseTo(9.61, 0);
});

test("parseMacOSCpu: returns 0 for input with no CPU usage line", () => {
  expect(parseMacOSCpu("no cpu data here")).toBe(0);
});

test("parseLinuxCpu: computes CPU percent from two /proc/stat samples", () => {
  const result = parseLinuxCpu(
    fixture("linux-proc-stat-1.txt"),
    fixture("linux-proc-stat-2.txt")
  );
  // delta_total=6174, delta_idle=5210, cpu%≈15.6
  expect(result).toBeCloseTo(15.6, 0);
});

test("parseLinuxCpu: returns 0 when samples are identical", () => {
  const stat = fixture("linux-proc-stat-1.txt");
  expect(parseLinuxCpu(stat, stat)).toBe(0);
});

test("parseDisk: extracts GB from macOS df -k output", () => {
  const result = parseDisk(fixture("macos-df.txt"));
  // 482797652 1K-blocks → 460.67 GB; used 190240284 → 181.43 GB
  expect(result.total_gb).toBeCloseTo(460, 0);
  expect(result.used_gb).toBeCloseTo(181, 0);
  expect(result.percent).toBe(44);
});

test("parseDisk: extracts GB from Linux df -k output", () => {
  const result = parseDisk(fixture("linux-df.txt"));
  // 41943040 1K-blocks → 40 GB; used 20971520 → 20 GB
  expect(result.total_gb).toBeCloseTo(40, 0);
  expect(result.used_gb).toBeCloseTo(20, 0);
  expect(result.percent).toBe(52);
});

test("parseDisk: returns zeros for empty output", () => {
  const result = parseDisk("");
  expect(result.total_gb).toBe(0);
  expect(result.used_gb).toBe(0);
  expect(result.percent).toBe(0);
});
