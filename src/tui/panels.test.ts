import { test, expect } from "bun:test";
import { renderSystemPanel, renderDockerPanel, renderGitPanel } from "./panels";
import type { SystemMetrics, DockerStatus, GitStatus } from "../collectors/types";

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function joined(lines: string[]): string {
  return strip(lines.join("\n"));
}

// ── SYSTEM ──────────────────────────────────────────────────────────────────

const metrics: SystemMetrics = {
  cpu_percent: 47,
  mem_used_gb: 6.2,
  mem_total_gb: 16,
  mem_percent: 38.75,
  disk_used_gb: 80,
  disk_total_gb: 200,
  disk_percent: 40,
  load_avg: [0.52, 0.48, 0.44],
};

test("renderSystemPanel: shows CPU percent", () => {
  expect(joined(renderSystemPanel(metrics))).toContain("47%");
});

test("renderSystemPanel: shows memory used GB", () => {
  expect(joined(renderSystemPanel(metrics))).toContain("6.2");
});

test("renderSystemPanel: shows disk percent", () => {
  expect(joined(renderSystemPanel(metrics))).toContain("40%");
});

test("renderSystemPanel: shows load average", () => {
  expect(joined(renderSystemPanel(metrics))).toContain("0.52");
});

test("renderSystemPanel: handles collector error", () => {
  const out = joined(renderSystemPanel({ error: "timeout after 5000ms" }));
  expect(out).toContain("timeout");
});

test("renderSystemPanel: high CPU is flagged (>85)", () => {
  const hot = { ...metrics, cpu_percent: 91 };
  const lines = renderSystemPanel(hot);
  // The line containing "91%" should have a red ANSI code (\x1b[31m)
  const cpuLine = lines.find(l => strip(l).includes("91%")) ?? "";
  expect(cpuLine).toContain("\x1b[31m");
});

// ── DOCKER ──────────────────────────────────────────────────────────────────

const docker: DockerStatus = {
  available: true,
  containers: [
    { name: "api", status: "running", image: "node:18", ports: ["3000:3000"] },
    { name: "worker", status: "exited", exit_code: 1, image: "node:18", ports: [] },
  ],
};

test("renderDockerPanel: shows running container name", () => {
  expect(joined(renderDockerPanel(docker))).toContain("api");
});

test("renderDockerPanel: shows DOWN for exited container", () => {
  expect(joined(renderDockerPanel(docker))).toContain("DOWN");
});

test("renderDockerPanel: shows UP for running container", () => {
  expect(joined(renderDockerPanel(docker))).toContain("UP");
});

test("renderDockerPanel: daemon unavailable", () => {
  const out = joined(renderDockerPanel({ available: false, containers: [] }));
  expect(out).toContain("not running");
});

test("renderDockerPanel: empty container list", () => {
  const out = joined(renderDockerPanel({ available: true, containers: [] }));
  expect(out).toContain("no containers");
});

test("renderDockerPanel: handles collector error", () => {
  const out = joined(renderDockerPanel({ error: "permission denied" }));
  expect(out).toContain("permission denied");
});

const dockerWithHealth: DockerStatus = {
  available: true,
  containers: [
    { name: "api",    status: "running", health: "healthy",   image: "nginx:latest", ports: [] },
    { name: "db",     status: "running", health: "unhealthy", image: "postgres:15",  ports: [] },
    { name: "cache",  status: "running", health: "none",      image: "redis:7",      ports: [] },
  ],
};

test("renderDockerPanel: highlights cursor row with reverse video", () => {
  const lines = renderDockerPanel(dockerWithHealth, 0);
  const row = lines[1] ?? "";
  expect(row).toContain("\x1b[7m");
});

test("renderDockerPanel: non-cursor rows do not have reverse video", () => {
  const lines = renderDockerPanel(dockerWithHealth, 0);
  const row = lines[2] ?? "";
  expect(row).not.toContain("\x1b[7m");
});

test("renderDockerPanel: shows HELTH for healthy container", () => {
  expect(joined(renderDockerPanel(dockerWithHealth, -1))).toContain("HELTH");
});

test("renderDockerPanel: shows UNHLT for unhealthy container", () => {
  expect(joined(renderDockerPanel(dockerWithHealth, -1))).toContain("UNHLT");
});

test("renderDockerPanel: shows NONE for no-health container", () => {
  expect(joined(renderDockerPanel(dockerWithHealth, -1))).toContain("NONE");
});

test("renderDockerPanel: cursor -1 does not highlight any row", () => {
  for (const l of renderDockerPanel(docker, -1)) {
    expect(l).not.toContain("\x1b[7m");
  }
});

// ── GIT ─────────────────────────────────────────────────────────────────────

const git: GitStatus = {
  is_git_repo: true,
  branch: "main",
  dirty_files: 3,
  unpushed_commits: 2,
  untracked_files: 1,
  stash_count: 0,
};

test("renderGitPanel: shows branch name", () => {
  expect(joined(renderGitPanel(git))).toContain("main");
});

test("renderGitPanel: shows unpushed count", () => {
  expect(joined(renderGitPanel(git))).toContain("2");
});

test("renderGitPanel: shows dirty file count", () => {
  expect(joined(renderGitPanel(git))).toContain("3");
});

test("renderGitPanel: not a git repo", () => {
  const out = joined(renderGitPanel({ is_git_repo: false }));
  expect(out).toContain("not a git repo");
});

test("renderGitPanel: handles collector error", () => {
  const out = joined(renderGitPanel({ error: "git not found" }));
  expect(out).toContain("git not found");
});

test("renderGitPanel: null unpushed_commits shown as unknown", () => {
  const g = { ...git, unpushed_commits: null };
  const out = joined(renderGitPanel(g));
  // Should not crash — just not show unpushed count
  expect(out).toContain("main");
});
