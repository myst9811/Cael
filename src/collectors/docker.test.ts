import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDockerPs } from "./docker";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parseDockerPs: parses running containers", () => {
  const result = parseDockerPs(fixture("docker-ps-running.txt"));
  expect(result).toHaveLength(2);
  expect(result[0].name).toBe("api");
  expect(result[0].status).toBe("running");
  expect(result[0].image).toBe("nginx:latest");
  expect(result[1].name).toBe("db");
  expect(result[1].status).toBe("running");
});

test("parseDockerPs: parses ports from running container", () => {
  const result = parseDockerPs(fixture("docker-ps-running.txt"));
  expect(result[0].ports).toContain("0.0.0.0:80->80/tcp");
  expect(result[1].ports).toContain("5432/tcp");
});

test("parseDockerPs: parses exited container and extracts exit code", () => {
  const result = parseDockerPs(fixture("docker-ps-mixed.txt"));
  expect(result).toHaveLength(3);
  const worker = result.find(c => c.name === "worker")!;
  expect(worker).toBeDefined();
  expect(worker.status).toBe("exited");
  expect(worker.exit_code).toBe(1);
});

test("parseDockerPs: running containers have no exit_code", () => {
  const result = parseDockerPs(fixture("docker-ps-running.txt"));
  expect(result[0].exit_code).toBeUndefined();
});

test("parseDockerPs: running containers have uptime", () => {
  const result = parseDockerPs(fixture("docker-ps-running.txt"));
  expect(result[0].uptime).toContain("Up");
});

test("parseDockerPs: returns empty array for empty output", () => {
  expect(parseDockerPs("")).toHaveLength(0);
  expect(parseDockerPs("   \n  ")).toHaveLength(0);
});

test("parseDockerPs: handles container with no ports", () => {
  const result = parseDockerPs(fixture("docker-ps-mixed.txt"));
  const worker = result.find(c => c.name === "worker")!;
  expect(worker.ports).toHaveLength(0);
});

test("parseDockerPs: parses healthy container", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "api")!.health).toBe("healthy");
});

test("parseDockerPs: parses unhealthy container", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "db")!.health).toBe("unhealthy");
});

test("parseDockerPs: parses health:starting container", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "cache")!.health).toBe("starting");
});

test("parseDockerPs: exited container with no health indicator gets none", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "worker")!.health).toBe("none");
});

test("parseDockerPs: containers without health parens get none", () => {
  const result = parseDockerPs(fixture("docker-ps-running.txt"));
  for (const c of result) {
    expect(c.health).toBe("none");
  }
});
