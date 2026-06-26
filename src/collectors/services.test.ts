import { test, expect } from "bun:test";
import { parseLaunchctlList, parseSystemctlList, parseDockerComposePsJson } from "./services";

const LAUNCHCTL_OUTPUT = `PID\tStatus\tLabel
1234\t0\tcom.apple.Finder
-\t0\tcom.apple.gamed
789\t0\tcom.docker.helper`;

const SYSTEMCTL_OUTPUT = `UNIT                    LOAD   ACTIVE SUB     DESCRIPTION
nginx.service           loaded active running A high performance web server
docker.service          loaded active running Docker Application Container Engine
 `;

const COMPOSE_JSON = `{"Service":"web","State":"running","Status":"Up 2 hours"}
{"Service":"db","State":"running","Status":"Up 2 hours"}
{"Service":"cache","State":"exited","Status":"Exited (1) 5 minutes ago"}`;

test("parseLaunchctlList: numeric PID means running", () => {
  const result = parseLaunchctlList(LAUNCHCTL_OUTPUT);
  const finder = result.find(s => s.name === "com.apple.Finder")!;
  expect(finder.status).toBe("running");
  expect(finder.source).toBe("launchctl");
});

test("parseLaunchctlList: dash PID means stopped", () => {
  const result = parseLaunchctlList(LAUNCHCTL_OUTPUT);
  const gamed = result.find(s => s.name === "com.apple.gamed")!;
  expect(gamed.status).toBe("stopped");
});

test("parseSystemctlList: extracts service name and description", () => {
  const result = parseSystemctlList(SYSTEMCTL_OUTPUT);
  expect(result.length).toBe(2);
  const nginx = result.find(s => s.name === "nginx.service")!;
  expect(nginx.status).toBe("running");
  expect(nginx.source).toBe("systemd");
  expect(nginx.description).toContain("web server");
});

test("parseDockerComposePsJson: parses JSON lines", () => {
  const result = parseDockerComposePsJson(COMPOSE_JSON);
  expect(result.length).toBe(3);
  expect(result.find(s => s.name === "web")?.status).toBe("running");
  expect(result.find(s => s.name === "cache")?.status).toBe("stopped");
});

test("parseDockerComposePsJson: handles invalid JSON lines gracefully", () => {
  const bad = `{"Service":"ok","State":"running","Status":"Up"}\nnot json at all`;
  const result = parseDockerComposePsJson(bad);
  expect(result.length).toBe(1);
  expect(result[0]!.name).toBe("ok");
});

test("getRuntimeServices result has unavailable_sources field", async () => {
  const { getRuntimeServices } = await import("./services");
  const result = await getRuntimeServices("all");
  expect(Array.isArray(result.services)).toBe(true);
  expect(Array.isArray(result.unavailable_sources)).toBe(true);
});
