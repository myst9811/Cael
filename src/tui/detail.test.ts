import { test, expect } from "bun:test";
import { formatUptime, renderContainerDetail } from "./detail";
import type { ContainerInspect } from "../collectors/types";

const FIXED_NOW = new Date("2026-06-26T12:00:00Z").getTime();

const running: ContainerInspect = {
  name: "nginx",
  status: "running",
  startedAt: "2026-06-26T09:46:00Z",
  finishedAt: "0001-01-01T00:00:00Z",
  restartCount: 0,
  exitCode: 0,
  image: "nginx:1.25",
  ports: ["0.0.0.0:443->443/tcp", "0.0.0.0:80->80/tcp"],
};

const exited: ContainerInspect = {
  name: "worker",
  status: "exited",
  startedAt: "2026-06-26T08:00:00Z",
  finishedAt: "2026-06-26T11:55:00Z",
  restartCount: 3,
  exitCode: 1,
  image: "myapp:latest",
  ports: [],
};

test("formatUptime: running container shows started X ago", () => {
  const result = formatUptime("2026-06-26T09:46:00Z", "0001-01-01T00:00:00Z", "running", FIXED_NOW);
  expect(result).toContain("2h");
  expect(result).toContain("14m");
  expect(result).toContain("ago");
});

test("formatUptime: exited container shows stopped X ago", () => {
  const result = formatUptime("", "2026-06-26T11:55:00Z", "exited", FIXED_NOW);
  expect(result).toContain("5m");
  expect(result).toContain("ago");
});

test("formatUptime: less than 60 seconds shows seconds", () => {
  const start = new Date(FIXED_NOW - 30_000).toISOString();
  const result = formatUptime(start, "0001-01-01T00:00:00Z", "running", FIXED_NOW);
  expect(result).toContain("30s");
});

test("renderContainerDetail: expanded produces 2 lines", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines).toHaveLength(2);
});

test("renderContainerDetail: compact produces 1 line", () => {
  const lines = renderContainerDetail(running, true);
  expect(lines).toHaveLength(1);
});

test("renderContainerDetail: shows container name", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines.join("\n")).toContain("nginx");
});

test("renderContainerDetail: shows RUNNING status", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines.join("\n").toUpperCase()).toContain("RUNNING");
});

test("renderContainerDetail: shows image on second line in expanded", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines[1]).toContain("nginx:1.25");
});

test("renderContainerDetail: shows restart count", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines.join("\n")).toContain("0");
});

test("renderContainerDetail: exited container shows exit code", () => {
  const lines = renderContainerDetail(exited, false);
  expect(lines.join("\n")).toContain("1");
});

test("renderContainerDetail: no ports shows 'no ports'", () => {
  const lines = renderContainerDetail(exited, false);
  expect(lines.join("\n")).toContain("no ports");
});
