import { test, expect } from "bun:test";
import { calculateDeployScore } from "./scorer";
import type { DeployInput } from "./scorer";

const perfect: DeployInput = {
  cpu_percent: 40,
  mem_percent: 60,
  disk_percent: 70,
  docker: { available: true, containers: [{ name: "api", status: "running" }, { name: "db", status: "running" }] },
  git: { dirty_files: 0, unpushed_commits: 0 },
};

// ── CPU ──────────────────────────────────────────────────────────────────────

test("cpu < 70%: full 20 pts", () => {
  const r = calculateDeployScore({ ...perfect, cpu_percent: 40 });
  expect(r.items.cpu.score).toBe(20);
});

test("cpu 70–85%: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, cpu_percent: 75 });
  expect(r.items.cpu.score).toBe(10);
  expect(r.items.cpu.warning).toBe(true);
});

test("cpu > 85%: 0 pts", () => {
  const r = calculateDeployScore({ ...perfect, cpu_percent: 90 });
  expect(r.items.cpu.score).toBe(0);
});

// ── Memory ───────────────────────────────────────────────────────────────────

test("mem < 80%: full 20 pts", () => {
  expect(calculateDeployScore({ ...perfect, mem_percent: 70 }).items.memory.score).toBe(20);
});

test("mem 80–90%: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, mem_percent: 85 });
  expect(r.items.memory.score).toBe(10);
  expect(r.items.memory.warning).toBe(true);
});

test("mem > 90%: 0 pts", () => {
  expect(calculateDeployScore({ ...perfect, mem_percent: 95 }).items.memory.score).toBe(0);
});

// ── Disk ─────────────────────────────────────────────────────────────────────

test("disk < 85%: full 20 pts", () => {
  expect(calculateDeployScore({ ...perfect, disk_percent: 70 }).items.disk.score).toBe(20);
});

test("disk 85–95%: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, disk_percent: 90 });
  expect(r.items.disk.score).toBe(10);
  expect(r.items.disk.warning).toBe(true);
});

test("disk > 95%: 0 pts and hard block NO-GO", () => {
  const r = calculateDeployScore({ ...perfect, disk_percent: 97 });
  expect(r.items.disk.score).toBe(0);
  expect(r.hard_block).toBe("disk_full");
  expect(r.go_no_go).toBe("NO-GO");
});

// ── Docker ───────────────────────────────────────────────────────────────────

test("all containers running: full 20 pts", () => {
  expect(calculateDeployScore(perfect).items.docker.score).toBe(20);
});

test("container exited with non-zero: 0 pts", () => {
  const r = calculateDeployScore({
    ...perfect,
    docker: {
      available: true,
      containers: [
        { name: "api", status: "running" },
        { name: "worker", status: "exited", exit_code: 1 },
      ],
    },
  });
  expect(r.items.docker.score).toBe(0);
});

test("container in restarting loop: hard block NO-GO", () => {
  const r = calculateDeployScore({
    ...perfect,
    docker: {
      available: true,
      containers: [{ name: "api", status: "restarting" }],
    },
  });
  expect(r.hard_block).toBe("docker_restarting");
  expect(r.go_no_go).toBe("NO-GO");
});

test("docker unavailable: 20 pts (cannot check, assume ok)", () => {
  const r = calculateDeployScore({ ...perfect, docker: { available: false, containers: [] } });
  expect(r.items.docker.score).toBe(20);
});

test("container exited cleanly (exit 0): partial pts", () => {
  const r = calculateDeployScore({
    ...perfect,
    docker: {
      available: true,
      containers: [
        { name: "api", status: "running" },
        { name: "migrator", status: "exited", exit_code: 0 },
      ],
    },
  });
  expect(r.items.docker.score).toBe(10);
});

// ── Git ──────────────────────────────────────────────────────────────────────

test("clean + no unpushed: full 20 pts", () => {
  expect(calculateDeployScore(perfect).items.git.score).toBe(20);
});

test("dirty files only: 10 pts", () => {
  const r = calculateDeployScore({ ...perfect, git: { dirty_files: 2, unpushed_commits: 0 } });
  expect(r.items.git.score).toBe(10);
});

test("unpushed only: 10 pts", () => {
  const r = calculateDeployScore({ ...perfect, git: { dirty_files: 0, unpushed_commits: 3 } });
  expect(r.items.git.score).toBe(10);
});

test("both dirty and unpushed: 0 pts", () => {
  const r = calculateDeployScore({ ...perfect, git: { dirty_files: 1, unpushed_commits: 2 } });
  expect(r.items.git.score).toBe(0);
});

test("unknown upstream (null): treat as 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, git: { dirty_files: 0, unpushed_commits: null } });
  expect(r.items.git.score).toBe(10);
});

// ── Overall verdict ───────────────────────────────────────────────────────────

test("perfect system scores 100 and is GO", () => {
  const r = calculateDeployScore(perfect);
  expect(r.total).toBe(100);
  expect(r.go_no_go).toBe("GO");
});

test("score >= 80 is GO", () => {
  const r = calculateDeployScore({ ...perfect, cpu_percent: 75 }); // loses 10 pts
  expect(r.total).toBe(90);
  expect(r.go_no_go).toBe("GO");
});

test("score 60–79 is CAUTION", () => {
  const r = calculateDeployScore({
    ...perfect,
    cpu_percent: 75,   // 10 pts
    mem_percent: 85,   // 10 pts
    git: { dirty_files: 1, unpushed_commits: 0 }, // 10 pts
  });
  expect(r.total).toBe(70);
  expect(r.go_no_go).toBe("CAUTION");
});

test("score < 60 is NO-GO without hard block", () => {
  const r = calculateDeployScore({
    ...perfect,
    cpu_percent: 90,   // 0 pts
    mem_percent: 95,   // 0 pts
    git: { dirty_files: 1, unpushed_commits: 2 }, // 0 pts
  });
  expect(r.total).toBeLessThan(60);
  expect(r.go_no_go).toBe("NO-GO");
});
