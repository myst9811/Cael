import { test, expect } from "bun:test";
import { calculateDeployScore } from "./scorer";
import type { DeployInput } from "./scorer";
import { DEFAULT_POLICY } from "./policy";

const perfect: DeployInput = {
  cpu_percent: 40,
  mem_percent: 60,
  disk_percent: 70,
  disk_inode_percent: 50,
  docker: { available: true, containers: [{ name: "api", status: "running" }, { name: "db", status: "running" }] },
  git: { dirty_files: 0, dirty_file_paths: [], unpushed_commits: 0, behind_commits: 0 },
};

// ── CPU ──────────────────────────────────────────────────────────────────────

test("cpu < 70%: full 20 pts", () => {
  expect(calculateDeployScore({ ...perfect, cpu_percent: 40 }).items.cpu.score).toBe(20);
});

test("cpu 70–85%: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, cpu_percent: 75 });
  expect(r.items.cpu.score).toBe(10);
  expect(r.items.cpu.warning).toBe(true);
});

test("cpu > 85%: 0 pts", () => {
  expect(calculateDeployScore({ ...perfect, cpu_percent: 90 }).items.cpu.score).toBe(0);
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

// ── Inodes ────────────────────────────────────────────────────────────────────

test("inodes undefined: full 20 pts (benefit of the doubt)", () => {
  expect(calculateDeployScore({ ...perfect, disk_inode_percent: undefined }).items.inodes.score).toBe(20);
});

test("inodes < 85%: full 20 pts", () => {
  expect(calculateDeployScore({ ...perfect, disk_inode_percent: 70 }).items.inodes.score).toBe(20);
});

test("inodes 85–95%: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, disk_inode_percent: 90 });
  expect(r.items.inodes.score).toBe(10);
  expect(r.items.inodes.warning).toBe(true);
});

test("inodes > 95%: 0 pts and hard block", () => {
  const r = calculateDeployScore({ ...perfect, disk_inode_percent: 97 });
  expect(r.items.inodes.score).toBe(0);
  expect(r.hard_block).toBe("inode_critical");
  expect(r.go_no_go).toBe("NO-GO");
});

// ── Branch upstream ───────────────────────────────────────────────────────────

test("behind 0: full 20 pts", () => {
  expect(calculateDeployScore({ ...perfect, git: { ...perfect.git, behind_commits: 0 } }).items.branch_upstream.score).toBe(20);
});

test("behind 1–5: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, git: { ...perfect.git, behind_commits: 3 } });
  expect(r.items.branch_upstream.score).toBe(10);
  expect(r.items.branch_upstream.warning).toBe(true);
});

test("behind > 5: 0 pts", () => {
  expect(calculateDeployScore({ ...perfect, git: { ...perfect.git, behind_commits: 10 } }).items.branch_upstream.score).toBe(0);
});

test("behind null (no upstream): full 20 pts", () => {
  expect(calculateDeployScore({ ...perfect, git: { ...perfect.git, behind_commits: null } }).items.branch_upstream.score).toBe(20);
});

// ── Docker ───────────────────────────────────────────────────────────────────

test("all containers running: full 20 pts", () => {
  expect(calculateDeployScore(perfect).items.docker.score).toBe(20);
});

test("container exited with non-zero: 0 pts", () => {
  const r = calculateDeployScore({
    ...perfect,
    docker: { available: true, containers: [{ name: "api", status: "running" }, { name: "worker", status: "exited", exit_code: 1 }] },
  });
  expect(r.items.docker.score).toBe(0);
});

test("container in restarting loop: hard block NO-GO", () => {
  const r = calculateDeployScore({ ...perfect, docker: { available: true, containers: [{ name: "api", status: "restarting" }] } });
  expect(r.hard_block).toBe("docker_restarting");
  expect(r.go_no_go).toBe("NO-GO");
});

test("docker unavailable: 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, docker: { available: false, containers: [] } });
  expect(r.items.docker.score).toBe(10);
  expect(r.items.docker.warning).toBe(true);
});

test("container exited cleanly (exit 0): partial pts", () => {
  const r = calculateDeployScore({
    ...perfect,
    docker: { available: true, containers: [{ name: "api", status: "running" }, { name: "migrator", status: "exited", exit_code: 0 }] },
  });
  expect(r.items.docker.score).toBe(10);
});

// ── Git ──────────────────────────────────────────────────────────────────────

test("clean + no unpushed: full 20 pts", () => {
  expect(calculateDeployScore(perfect).items.git.score).toBe(20);
});

test("not a git repo: full 20 pts (no penalty)", () => {
  const r = calculateDeployScore({ ...perfect, git: { is_git_repo: false } });
  expect(r.items.git.score).toBe(20);
  expect(r.items.git.label).toContain("not a git repo");
});

test("dirty files (non-lockfile): 10 pts", () => {
  const r = calculateDeployScore({ ...perfect, git: { ...perfect.git, dirty_files: 2, dirty_file_paths: ["src/app.ts"], unpushed_commits: 0 } });
  expect(r.items.git.score).toBe(10);
});

test("unpushed only: 10 pts", () => {
  const r = calculateDeployScore({ ...perfect, git: { ...perfect.git, dirty_files: 0, unpushed_commits: 3 } });
  expect(r.items.git.score).toBe(10);
});

test("both dirty and unpushed (non-lockfile): 0 pts", () => {
  const r = calculateDeployScore({ ...perfect, git: { ...perfect.git, dirty_files: 1, dirty_file_paths: ["src/x.ts"], unpushed_commits: 2 } });
  expect(r.items.git.score).toBe(0);
});

test("lockfile dirty: 0 pts with lockfile label", () => {
  const r = calculateDeployScore({ ...perfect, git: { ...perfect.git, dirty_files: 1, dirty_file_paths: ["bun.lock"], unpushed_commits: 0 } });
  expect(r.items.git.score).toBe(0);
  expect(r.items.git.label).toContain("lockfile");
});

test("unknown upstream (null): 10 pts warning", () => {
  const r = calculateDeployScore({ ...perfect, git: { ...perfect.git, dirty_files: 0, unpushed_commits: null } });
  expect(r.items.git.score).toBe(10);
});

// ── Overall verdict (140-point scale) ─────────────────────────────────────────

test("perfect system scores 140 and is GO", () => {
  const r = calculateDeployScore(perfect);
  expect(r.total).toBe(140);
  expect(r.go_no_go).toBe("GO");
});

test("score >= 112 (80%) is GO", () => {
  const r = calculateDeployScore({ ...perfect, cpu_percent: 75 }); // cpu=10, rest=20 → 130
  expect(r.total).toBe(130);
  expect(r.go_no_go).toBe("GO");
});

test("score 84–111 is CAUTION", () => {
  // cpu@90(0) + mem@95(0) + disk@90(10) + docker(20) + git(20) + inodes(20) + branch(20) = 90
  const r = calculateDeployScore({ ...perfect, cpu_percent: 90, mem_percent: 95, disk_percent: 90 });
  expect(r.total).toBe(90);
  expect(r.go_no_go).toBe("CAUTION");
});

test("score < 84 is NO-GO without hard block", () => {
  // cpu@90(0)+mem@95(0)+disk@90(10)+docker(20)+git.dirty+unpushed(0)+inodes(20)+branch(20)=70
  const r = calculateDeployScore({
    ...perfect,
    cpu_percent: 90, mem_percent: 95, disk_percent: 90,
    git: { dirty_files: 1, dirty_file_paths: ["src/x.ts"], unpushed_commits: 2 },
  });
  expect(r.total).toBeLessThan(84);
  expect(r.go_no_go).toBe("NO-GO");
});

test("custom policy changes thresholds", () => {
  const lenient = { ...DEFAULT_POLICY, go_threshold: 20 };
  const r = calculateDeployScore({ ...perfect, cpu_percent: 90 }, lenient);
  expect(r.go_no_go).toBe("GO");
});

test("custom disk_crit policy triggers hard_block at correct threshold", () => {
  const strict = { ...DEFAULT_POLICY, disk_crit: 80 };
  // disk at 85% exceeds strict threshold of 80
  const r = calculateDeployScore({ ...perfect, disk_percent: 85 }, strict);
  expect(r.hard_block).toBe("disk_full");
  expect(r.go_no_go).toBe("NO-GO");
});
