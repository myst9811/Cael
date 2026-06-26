import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDockerInspect } from "./docker-inspect";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8"));

test("parseDockerInspect: extracts name (strips leading slash)", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.name).toBe("api");
});

test("parseDockerInspect: running container status", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.status).toBe("running");
  expect(result.exitCode).toBe(0);
  expect(result.restartCount).toBe(0);
});

test("parseDockerInspect: extracts startedAt and finishedAt", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.startedAt).toBe("2026-06-25T10:00:00Z");
  expect(result.finishedAt).toBe("0001-01-01T00:00:00Z");
});

test("parseDockerInspect: extracts image", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.image).toBe("nginx:latest");
});

test("parseDockerInspect: maps ports to host:container format", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.ports).toContain("0.0.0.0:80->80/tcp");
  expect(result.ports).toContain("0.0.0.0:443->443/tcp");
});

test("parseDockerInspect: exited container with restart count and exit code", () => {
  const result = parseDockerInspect(fixture("docker-inspect-exited.json"));
  expect(result.name).toBe("worker");
  expect(result.status).toBe("exited");
  expect(result.exitCode).toBe(1);
  expect(result.restartCount).toBe(3);
  expect(result.ports).toHaveLength(0);
});
