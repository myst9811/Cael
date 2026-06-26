# M4: Operational Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship configurable deploy scoring with 2 new checks, a structured postmortem timeline engine, custom postmortem templates, SHA256-verified self-update, and a Homebrew tap.

**Architecture:** Four independent subsystems built in-order on top of main (M1+M2+M3). Tasks 1–4 are deploy scoring, 5–7 are postmortem, 8–9 are release/update hardening, 10 is CI workflow. Each group is independently testable and committable. Branch: `feat/m4-operational-workflows` from `origin/main`.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.$`, GitHub Actions, `sha256sum`, Homebrew Ruby formula.

---

## File Map

| Action  | Path | Responsibility |
|---------|------|----------------|
| Modify  | `src/collectors/types.ts` | Add `dirty_file_paths`, `behind_commits` to `GitStatus` |
| Modify  | `src/collectors/git.ts` | Populate new `GitStatus` fields; add `parseDirtyFilePaths`, `parseBehindCount` |
| Modify  | `src/collectors/git.test.ts` | Tests for new parse functions |
| Create  | `src/commands/deploy-check/policy.ts` | `DeployPolicy`, `DEFAULT_POLICY`, `loadDeployPolicy()` |
| Create  | `src/commands/deploy-check/policy.test.ts` | Policy resolution order tests |
| Modify  | `src/commands/deploy-check/scorer.ts` | Add `inodes`/`branch_upstream` checks, lockfile detection, `policy` param |
| Modify  | `src/commands/deploy-check/scorer.test.ts` | Update existing score totals; add new check tests |
| Modify  | `src/commands/deploy-check/formatter.ts` | Add `inodes`/`branch_upstream` rows |
| Modify  | `src/commands/deploy-check/index.ts` | Wire policy + new `DeployInput` fields |
| Create  | `src/commands/postmortem/timeline.ts` | `extractTimeline`, `formatTimeline` |
| Create  | `src/commands/postmortem/timeline.test.ts` | Timeline extraction/sort/format tests |
| Modify  | `src/commands/postmortem/context.ts` | Add `gitTimelineLog` field to `PostmortemContext` |
| Create  | `src/commands/postmortem/default-template.ts` | `DEFAULT_TEMPLATE` constant |
| Modify  | `src/commands/postmortem/flags.ts` | Add `template?: string` to `PostmortemFlags` |
| Modify  | `src/commands/postmortem/flags.test.ts` | Test `--template` flag parsing |
| Modify  | `src/commands/postmortem/index.ts` | Template resolution, timeline injection |
| Create  | `src/version.ts` | `VERSION` constant, `printVersion()` |
| Create  | `src/commands/update.ts` | `runUpdate()` with checksum verification and safe replace |
| Create  | `src/commands/update.test.ts` | Mock fetch tests for update logic |
| Modify  | `index.ts` | `--version`/`-V` flag; `update` subcommand before provider check |
| Modify  | `.github/workflows/release.yml` | `BUILD_VERSION` injection, checksums, Homebrew tap |

---

## Task 1: Git collector — `dirty_file_paths` and `behind_commits`

**Files:**
- Modify: `src/collectors/types.ts`
- Modify: `src/collectors/git.ts`
- Modify: `src/collectors/git.test.ts`

- [ ] **Step 1: Add new fields to `GitStatus` in `src/collectors/types.ts`**

Add two fields after `unpushed_commits`:

```ts
export interface GitStatus {
  is_git_repo: boolean;
  branch?: string;
  dirty_files?: number;
  dirty_file_paths?: string[];    // paths from git status --short (non-untracked lines)
  unpushed_commits?: number | null;
  behind_commits?: number | null; // commits on upstream not yet in HEAD; null = no upstream
  untracked_files?: number;
  stash_count?: number;
  last_commit_message?: string;
  last_commit_hash?: string;
}
```

- [ ] **Step 2: Write failing tests — append to `src/collectors/git.test.ts`**

```ts
import { parseDirtyFilePaths, parseBehindCount } from "./git";

test("parseDirtyFilePaths: returns paths for non-untracked dirty lines", () => {
  const output = " M src/foo.ts\nM  src/bar.ts\nA  src/new.ts\n?? untracked.ts\n";
  expect(parseDirtyFilePaths(output)).toEqual(["src/foo.ts", "src/bar.ts", "src/new.ts"]);
});

test("parseDirtyFilePaths: empty output returns empty array", () => {
  expect(parseDirtyFilePaths("")).toEqual([]);
});

test("parseDirtyFilePaths: excludes untracked files", () => {
  const output = "?? foo.ts\n?? bar.ts\n";
  expect(parseDirtyFilePaths(output)).toEqual([]);
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
```

- [ ] **Step 3: Run tests to confirm failure**

```bash
bun test ./src/collectors/git.test.ts 2>&1 | tail -5
```

Expected: FAIL — `parseDirtyFilePaths` and `parseBehindCount` not exported.

- [ ] **Step 4: Add `parseDirtyFilePaths`, `parseBehindCount`, and update `getGitStatus` in `src/collectors/git.ts`**

```ts
export function parseDirtyFilePaths(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter(l => !l.startsWith("??"))
    .map(l => l.slice(3).trim());
}

export function parseBehindCount(output: string): number | null {
  const trimmed = output.trim();
  if (!trimmed || trimmed === "no-upstream") return null;
  const n = parseInt(trimmed);
  return isNaN(n) ? null : n;
}
```

In `getGitStatus`, add `behindOut` to the parallel calls:

```ts
const [branch, statusOut, unpushedOut, behindOut, stashOut, logOut] = await Promise.all([
  $`git branch --show-current`.quiet().nothrow().then(r => r.stdout.toString().trim()),
  $`git status --short`.quiet().nothrow().then(r => r.stdout.toString()),
  $`git rev-list "@{u}.." --count`.quiet().nothrow().then(r =>
    r.exitCode === 0 ? r.stdout.toString().trim() : "no-upstream"
  ),
  $`git rev-list "..@{u}" --count`.quiet().nothrow().then(r =>
    r.exitCode === 0 ? r.stdout.toString().trim() : "no-upstream"
  ),
  $`git stash list`.quiet().nothrow().then(r =>
    r.stdout.toString().trim().split("\n").filter(Boolean).length
  ),
  $`git log -1 --format=%s|%h`.quiet().nothrow().then(r => r.stdout.toString().trim()),
]);

const { dirty, untracked } = parseGitShortStatus(statusOut);
const dirty_file_paths = parseDirtyFilePaths(statusOut);
const unpushed = parseUnpushedCount(unpushedOut);
const behind = parseBehindCount(behindOut);
```

And add to the return object:
```ts
return {
  is_git_repo: true,
  branch: branch || undefined,
  dirty_files: dirty,
  dirty_file_paths,
  untracked_files: untracked,
  unpushed_commits: unpushed,
  behind_commits: behind,
  stash_count: stashOut,
  last_commit_message: lastMsg || undefined,
  last_commit_hash: lastHash || undefined,
};
```

- [ ] **Step 5: Run tests**

```bash
bun test ./src/collectors/git.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/collectors/types.ts src/collectors/git.ts src/collectors/git.test.ts
git commit -m "feat: add dirty_file_paths and behind_commits to GitStatus"
```

---

## Task 2: Deploy policy loader

**Files:**
- Create: `src/commands/deploy-check/policy.ts`
- Create: `src/commands/deploy-check/policy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/commands/deploy-check/policy.test.ts`:

```ts
import { test, expect } from "bun:test";
import { loadDeployPolicy, DEFAULT_POLICY } from "./policy";

test("DEFAULT_POLICY has correct 140-point scale thresholds", () => {
  expect(DEFAULT_POLICY.go_threshold).toBe(112);
  expect(DEFAULT_POLICY.caution_threshold).toBe(84);
  expect(DEFAULT_POLICY.cpu_warn).toBe(70);
  expect(DEFAULT_POLICY.disk_crit).toBe(95);
});

test("loadDeployPolicy returns defaults when no config files exist", async () => {
  const policy = await loadDeployPolicy("/tmp/nonexistent-m4-project", "/tmp/nonexistent-m4-user.json");
  expect(policy).toEqual(DEFAULT_POLICY);
});

test("loadDeployPolicy: project-level overrides user-level", async () => {
  const projectPath = "/tmp/m4-policy-project.json";
  const userPath = "/tmp/m4-policy-user.json";
  await Bun.write(userPath, JSON.stringify({ deploy: { cpu_warn: 65, go_threshold: 100 } }));
  await Bun.write(projectPath, JSON.stringify({ deploy: { cpu_warn: 55 } }));
  const policy = await loadDeployPolicy(projectPath, userPath);
  expect(policy.cpu_warn).toBe(55);          // project wins
  expect(policy.go_threshold).toBe(100);      // user fills in
  expect(policy.caution_threshold).toBe(84); // default fills in
});

test("loadDeployPolicy: user-level overrides defaults", async () => {
  const userPath = "/tmp/m4-policy-user-only.json";
  await Bun.write(userPath, JSON.stringify({ deploy: { disk_crit: 90 } }));
  const policy = await loadDeployPolicy("/tmp/nonexistent-m4-project.json", userPath);
  expect(policy.disk_crit).toBe(90);
  expect(policy.cpu_warn).toBe(70); // default
});

test("loadDeployPolicy: malformed JSON falls back gracefully", async () => {
  const bad = "/tmp/m4-policy-bad.json";
  await Bun.write(bad, "not json {{{");
  const policy = await loadDeployPolicy(bad, "/tmp/nonexistent.json");
  expect(policy).toEqual(DEFAULT_POLICY);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test ./src/commands/deploy-check/policy.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/deploy-check/policy.ts`**

```ts
import { readConfig } from "../../config";
import { join } from "node:path";

export interface DeployPolicy {
  cpu_warn: number;
  cpu_crit: number;
  mem_warn: number;
  mem_crit: number;
  disk_warn: number;
  disk_crit: number;
  go_threshold: number;       // raw score ≥ this → GO  (out of 140)
  caution_threshold: number;  // raw score ≥ this → CAUTION (out of 140)
}

// 7 checks × 20pts = 140 max. go=80%, caution=60%.
export const DEFAULT_POLICY: DeployPolicy = {
  cpu_warn: 70, cpu_crit: 85,
  mem_warn: 80, mem_crit: 90,
  disk_warn: 85, disk_crit: 95,
  go_threshold: 112, caution_threshold: 84,
};

async function readDeploy(path: string): Promise<Partial<DeployPolicy>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    const raw = await file.json() as { deploy?: Partial<DeployPolicy> };
    return raw.deploy ?? {};
  } catch {
    return {};
  }
}

export async function loadDeployPolicy(
  projectPolicyPath = join(process.cwd(), ".cael", "policy.json"),
  userConfigPath?: string,
): Promise<DeployPolicy> {
  const userCfgPath = userConfigPath ?? join(
    process.env.HOME ?? process.env.USERPROFILE ?? ".",
    ".cael", "config.json"
  );
  const [project, user] = await Promise.all([
    readDeploy(projectPolicyPath),
    readDeploy(userCfgPath),
  ]);
  return { ...DEFAULT_POLICY, ...user, ...project };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test ./src/commands/deploy-check/policy.test.ts 2>&1 | tail -5
```

Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/commands/deploy-check/policy.ts src/commands/deploy-check/policy.test.ts
git commit -m "feat: add deploy policy loader with project/user/default resolution"
```

---

## Task 3: Deploy scorer — new checks, lockfile detection, policy param

**Files:**
- Modify: `src/commands/deploy-check/scorer.ts`
- Modify: `src/commands/deploy-check/scorer.test.ts`

- [ ] **Step 1: Update `scorer.ts` — extend types and add new scoring functions**

Replace the entire `src/commands/deploy-check/scorer.ts` with:

```ts
import type { DeployPolicy } from "./policy";
import { DEFAULT_POLICY } from "./policy";

const LOCKFILES = new Set(["bun.lock", "package-lock.json", "yarn.lock", "Cargo.lock"]);

export interface DeployInput {
  cpu_percent: number;
  mem_percent: number;
  disk_percent: number;
  disk_inode_percent?: number;
  docker: {
    available: boolean;
    containers: Array<{ name: string; status: "running" | "exited" | "paused" | "restarting"; exit_code?: number }>;
  };
  git: {
    dirty_files?: number;
    dirty_file_paths?: string[];
    unpushed_commits?: number | null;
    behind_commits?: number | null;
  };
}

export interface CheckItem {
  score: number;
  max: number;
  label: string;
  details?: string;
  warning?: boolean;
}

export interface ScoreResult {
  total: number;
  go_no_go: "GO" | "CAUTION" | "NO-GO";
  hard_block?: "disk_full" | "docker_restarting" | "inode_critical";
  items: {
    cpu: CheckItem;
    memory: CheckItem;
    disk: CheckItem;
    docker: CheckItem;
    git: CheckItem;
    inodes: CheckItem;
    branch_upstream: CheckItem;
  };
}

export function calculateDeployScore(input: DeployInput, policy: DeployPolicy = DEFAULT_POLICY): ScoreResult {
  const cpu = scoreCpu(input.cpu_percent, policy);
  const memory = scoreMemory(input.mem_percent, policy);
  const disk = scoreDisk(input.disk_percent, policy);
  const docker = scoreDocker(input.docker);
  const git = scoreGit(input.git);
  const inodes = scoreInodes(input.disk_inode_percent, policy);
  const branch_upstream = scoreBranchUpstream(input.git.behind_commits);

  const total = cpu.score + memory.score + disk.score + docker.score + git.score + inodes.score + branch_upstream.score;

  let hard_block: ScoreResult["hard_block"];
  if (input.disk_percent > 95) hard_block = "disk_full";
  else if (input.docker.containers.some(c => c.status === "restarting")) hard_block = "docker_restarting";
  else if (input.disk_inode_percent !== undefined && input.disk_inode_percent > 95) hard_block = "inode_critical";

  let go_no_go: ScoreResult["go_no_go"];
  if (hard_block) go_no_go = "NO-GO";
  else if (total >= policy.go_threshold) go_no_go = "GO";
  else if (total >= policy.caution_threshold) go_no_go = "CAUTION";
  else go_no_go = "NO-GO";

  return { total, go_no_go, hard_block, items: { cpu, memory, disk, docker, git, inodes, branch_upstream } };
}

function scoreCpu(pct: number, p: DeployPolicy): CheckItem {
  if (pct < p.cpu_warn) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= p.cpu_crit) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "critical" };
}

function scoreMemory(pct: number, p: DeployPolicy): CheckItem {
  if (pct < p.mem_warn) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= p.mem_crit) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "critical" };
}

function scoreDisk(pct: number, p: DeployPolicy): CheckItem {
  if (pct < p.disk_warn) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= p.disk_crit) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "FULL — hard block", warning: true };
}

function scoreInodes(pct: number | undefined, p: DeployPolicy): CheckItem {
  if (pct === undefined) return { score: 20, max: 20, label: "unknown" };
  if (pct < p.disk_warn) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= p.disk_crit) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "CRITICAL — hard block", warning: true };
}

function scoreBranchUpstream(behind: number | null | undefined): CheckItem {
  if (behind === undefined || behind === null) {
    return { score: 20, max: 20, label: "no upstream", warning: false };
  }
  if (behind === 0) return { score: 20, max: 20, label: "up to date" };
  if (behind <= 5) return { score: 10, max: 20, label: `${behind} behind`, warning: true, details: "pull before deploy" };
  return { score: 0, max: 20, label: `${behind} behind`, warning: true, details: "significantly behind upstream" };
}

function scoreDocker(docker: DeployInput["docker"]): CheckItem {
  if (!docker.available) {
    return { score: 10, max: 20, label: "unavailable", details: "cannot verify", warning: true };
  }
  const restarting = docker.containers.filter(c => c.status === "restarting");
  if (restarting.length > 0) {
    return { score: 0, max: 20, label: `${restarting.length} restarting`, details: restarting.map(c => c.name).join(", "), warning: true };
  }
  const badExits = docker.containers.filter(c => c.status === "exited" && (c.exit_code ?? 0) !== 0);
  const cleanExits = docker.containers.filter(c => c.status === "exited" && (c.exit_code ?? 0) === 0);
  const running = docker.containers.filter(c => c.status === "running").length;
  const total = docker.containers.length;
  if (badExits.length > 0) {
    return { score: 0, max: 20, label: `${running}/${total} UP`, details: badExits.map(c => `${c.name}: Exited (${c.exit_code})`).join(", "), warning: true };
  }
  if (cleanExits.length > 0) {
    return { score: 10, max: 20, label: `${running}/${total} UP`, details: cleanExits.map(c => c.name).join(", ") + " stopped cleanly", warning: true };
  }
  return { score: 20, max: 20, label: `${running}/${total} UP` };
}

function scoreGit(git: DeployInput["git"]): CheckItem {
  const dirty = git.dirty_files ?? 0;
  const paths = git.dirty_file_paths ?? [];
  const hasLockfile = paths.some(p => LOCKFILES.has(p.split("/").pop() ?? ""));
  const unpushed = git.unpushed_commits;
  const hasDirty = dirty > 0;
  const hasUnpushed = unpushed == null ? true : unpushed > 0;

  if (hasLockfile) {
    const lockName = paths.find(p => LOCKFILES.has(p.split("/").pop() ?? ""))!;
    const extra = hasUnpushed ? " + unpushed" : "";
    return { score: 0, max: 20, label: `lockfile dirty${extra}`, details: lockName, warning: true };
  }
  if (!hasDirty && !hasUnpushed) return { score: 20, max: 20, label: "clean" };
  if (hasDirty && hasUnpushed) {
    const parts = [];
    if (dirty > 0) parts.push(`${dirty} dirty`);
    if (unpushed == null) parts.push("upstream unknown");
    else if (unpushed > 0) parts.push(`${unpushed} unpushed`);
    return { score: 0, max: 20, label: parts.join(", "), warning: true };
  }
  const label = hasDirty
    ? `${dirty} dirty file${dirty > 1 ? "s" : ""}`
    : unpushed == null ? "upstream unknown" : `${unpushed} unpushed`;
  return { score: 10, max: 20, label, warning: true };
}
```

- [ ] **Step 2: Update `src/commands/deploy-check/scorer.test.ts`**

The existing tests need score total updates (max is now 140). Replace the file:

```ts
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

test("inodes undefined: full 20 pts (unknown = benefit of the doubt)", () => {
  const r = calculateDeployScore({ ...perfect, disk_inode_percent: undefined });
  expect(r.items.inodes.score).toBe(20);
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
  // Lose 10pts on cpu (75%): total = 130
  const r = calculateDeployScore({ ...perfect, cpu_percent: 75 });
  expect(r.total).toBe(130);
  expect(r.go_no_go).toBe("GO");
});

test("score 84–111 (60–79%) is CAUTION", () => {
  // cpu@90(0) + mem@95(0) + disk@90(10) + rest perfect = 0+0+10+20+20+20+20 = 90
  const r = calculateDeployScore({ ...perfect, cpu_percent: 90, mem_percent: 95, disk_percent: 90 });
  expect(r.total).toBe(90);
  expect(r.go_no_go).toBe("CAUTION");
});

test("score < 84 (60%) is NO-GO without hard block", () => {
  // cpu@90(0) + mem@95(0) + disk@90(10) + git dirty+unpushed(0) = 0+0+10+20+0+20+20 = 70
  const r = calculateDeployScore({
    ...perfect,
    cpu_percent: 90,
    mem_percent: 95,
    disk_percent: 90,
    git: { dirty_files: 1, dirty_file_paths: ["src/x.ts"], unpushed_commits: 2 },
  });
  expect(r.total).toBeLessThan(84);
  expect(r.go_no_go).toBe("NO-GO");
});

test("custom policy changes thresholds", () => {
  const lenientPolicy = { ...DEFAULT_POLICY, cpu_crit: 99, go_threshold: 20 };
  const r = calculateDeployScore({ ...perfect, cpu_percent: 95 }, lenientPolicy);
  // cpu@95 with crit=99: still scores 0 pts (> 85 default warn, but warn=70, crit=99 in lenient)
  // Actually with lenient: cpu_warn=70 (unchanged), cpu_crit=99: cpu@95 scores 10pts
  expect(r.items.cpu.score).toBe(10);
  expect(r.go_no_go).toBe("GO"); // go_threshold=20, easy to hit
});
```

- [ ] **Step 3: Run tests to confirm failures first**

```bash
bun test ./src/commands/deploy-check/scorer.test.ts 2>&1 | tail -5
```

Expected: failures (old scorer.ts doesn't export lockfile detection, doesn't accept policy).

- [ ] **Step 4: Run tests after replacing scorer.ts**

```bash
bun test ./src/commands/deploy-check/scorer.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 5: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/commands/deploy-check/scorer.ts src/commands/deploy-check/scorer.test.ts
git commit -m "feat: add inode/branch_upstream checks, lockfile detection, policy param to deploy scorer"
```

---

## Task 4: Deploy formatter + index.ts wiring

**Files:**
- Modify: `src/commands/deploy-check/formatter.ts`
- Modify: `src/commands/deploy-check/index.ts`

- [ ] **Step 1: Update `src/commands/deploy-check/formatter.ts`**

In `formatScoreTable`, add the two new rows and update the hard-block label map:

```ts
import type { ScoreResult, CheckItem } from "./scorer";

const COL_WIDTH = 50;

function dotLeader(label: string, right: string): string {
  const dots = ".".repeat(Math.max(2, COL_WIDTH - label.length - right.length));
  return `${label} ${dots} ${right}`;
}

function itemLine(name: string, item: CheckItem): string {
  const check = item.score === item.max ? "✓" : item.score > 0 ? "~" : "✗";
  const scoreTag = `(${item.score}/${item.max})`;
  const right = `${item.label} ${check} ${scoreTag}${item.details ? "  " + item.details : ""}`;
  return dotLeader(name, right);
}

export function formatVerdict(result: ScoreResult): string {
  const icon = result.go_no_go === "GO" ? "✓" : result.go_no_go === "CAUTION" ? "⚠" : "✗";
  let line = `Score: ${result.total}/140 — ${icon} ${result.go_no_go}`;
  if (result.hard_block) {
    const labels: Record<string, string> = {
      disk_full: "disk > 95%",
      docker_restarting: "container restarting loop",
      inode_critical: "inodes > 95%",
    };
    line += `  [HARD BLOCK: ${labels[result.hard_block] ?? result.hard_block}]`;
  }
  return line;
}

export function formatScoreTable(result: ScoreResult): string {
  const rows = [
    itemLine("CPU",            result.items.cpu),
    itemLine("Memory",         result.items.memory),
    itemLine("Disk",           result.items.disk),
    itemLine("Inodes",         result.items.inodes),
    itemLine("Docker",         result.items.docker),
    itemLine("Git",            result.items.git),
    itemLine("Branch",         result.items.branch_upstream),
  ];
  return rows.join("\n");
}

export function formatDeployCheck(result: ScoreResult, timestamp: string, narrative: string): string {
  const sep = "─".repeat(50);
  return [
    `Deploy Check — ${timestamp}`,
    sep,
    formatVerdict(result),
    "",
    formatScoreTable(result),
    "",
    "Assessment:",
    narrative,
  ].join("\n");
}
```

- [ ] **Step 2: Update `src/commands/deploy-check/index.ts`**

Replace the entire file:

```ts
import { collectAll } from "../../collectors";
import { runAgentLoop } from "../../agent";
import { tools } from "../../tools";
import { calculateDeployScore } from "./scorer";
import { formatDeployCheck, formatScoreTable } from "./formatter";
import { loadDeployPolicy } from "./policy";
import type { LLMProvider } from "../../providers/types";
import type { SystemMetrics, DockerStatus, GitStatus, CollectorError } from "../../collectors/types";

function isError(v: unknown): v is CollectorError {
  return typeof v === "object" && v !== null && "error" in v;
}

const NARRATIVE_PROMPT = (table: string) =>
  `You are a DevOps assistant. Given this deploy-readiness score table (out of 140), write a single concise paragraph (3-5 sentences) assessing whether this system is safe to deploy to. Focus on the most significant risks. Be direct and specific — do not repeat the table numbers.

${table}`;

export async function runDeployCheck(provider: LLMProvider): Promise<void> {
  process.stdout.write("Running deploy check...\n\n");
  const [ctx, policy] = await Promise.all([collectAll(), loadDeployPolicy()]);

  const system = isError(ctx.system) ? null : ctx.system as SystemMetrics;
  const docker = isError(ctx.docker) ? { available: false, containers: [] } : ctx.docker as DockerStatus;
  const git = isError(ctx.git) ? null : ctx.git as GitStatus;

  const input = {
    cpu_percent:         system?.cpu_percent         ?? 0,
    mem_percent:         system?.mem_percent         ?? 0,
    disk_percent:        system?.disk_percent        ?? 0,
    disk_inode_percent:  system?.disk_inode_percent,
    docker: { available: docker.available, containers: docker.containers },
    git: {
      dirty_files:      git?.dirty_files,
      dirty_file_paths: git?.dirty_file_paths,
      unpushed_commits: git?.unpushed_commits,
      behind_commits:   git?.behind_commits,
    },
  };

  const result = calculateDeployScore(input, policy);
  const scoreTable = formatScoreTable(result);

  process.stdout.write(`[${provider.name}] generating assessment...\n\n`);
  const narrative = await runAgentLoop(
    provider,
    [{ role: "user", content: NARRATIVE_PROMPT(scoreTable) }],
    { maxIterations: 1 },
  );

  const timestamp = new Date().toLocaleString("en-GB", { hour12: false }).replace(",", "");
  console.log(formatDeployCheck(result, timestamp, narrative));
}
```

- [ ] **Step 3: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: all pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/commands/deploy-check/formatter.ts src/commands/deploy-check/index.ts
git commit -m "feat: wire deploy policy and new checks into deploy-check command"
```

---

## Task 5: Postmortem timeline engine

**Files:**
- Create: `src/commands/postmortem/timeline.ts`
- Create: `src/commands/postmortem/timeline.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/commands/postmortem/timeline.test.ts`:

```ts
import { test, expect } from "bun:test";
import { extractTimeline, formatTimeline } from "./timeline";
import type { PostmortemContext } from "./context";

function makeCtx(gitTimelineLog: string, containerLogs: PostmortemContext["containerLogs"]): PostmortemContext {
  return {
    timestamp: "2026-06-26T12:00:00Z",
    systemMetrics: "",
    dockerStatus: "",
    containerLogs,
    gitLog: "",
    gitTimelineLog,
    gitLastCommit: "",
    topProcesses: "",
  };
}

const GIT_LOG = `abc1234 2026-06-26T10:00:01+00:00 fix: bump connection pool size
def5678 2026-06-26T10:05:00+00:00 chore: update deps`;

const CONTAINER_LOGS = [
  {
    name: "api",
    truncated: false,
    logs: [
      "2026-06-26T10:00:03Z ERROR [123] Database connection failed",
      "2026-06-26T10:00:04Z ERROR [124] Database connection failed",
      "2026-06-26T10:00:05Z INFO  Request started",
    ].join("\n"),
  },
];

test("extractTimeline: parses git commits into events", () => {
  const events = extractTimeline(makeCtx(GIT_LOG, []));
  const gitEvents = events.filter(e => e.source === "git");
  expect(gitEvents.length).toBe(2);
  expect(gitEvents[0]!.timestamp).toBe("2026-06-26T10:00:01+00:00");
  expect(gitEvents[0]!.message).toContain("fix: bump connection pool");
});

test("extractTimeline: parses container log timestamps", () => {
  const events = extractTimeline(makeCtx("", CONTAINER_LOGS));
  const logEvents = events.filter(e => e.source === "log");
  expect(logEvents.length).toBeGreaterThan(0);
  expect(logEvents[0]!.container).toBe("api");
});

test("extractTimeline: sorts events by timestamp ascending", () => {
  const events = extractTimeline(makeCtx(GIT_LOG, CONTAINER_LOGS));
  const timed = events.filter(e => e.timestamp !== "");
  for (let i = 1; i < timed.length; i++) {
    expect(timed[i]!.timestamp >= timed[i - 1]!.timestamp).toBe(true);
  }
});

test("extractTimeline: deduplicates repeated log lines", () => {
  const repeatedLogs = [
    {
      name: "api", truncated: false,
      logs: [
        "2026-06-26T10:00:01Z ERROR Database connection failed",
        "2026-06-26T10:00:02Z ERROR Database connection failed",
        "2026-06-26T10:00:03Z ERROR Database connection failed",
      ].join("\n"),
    },
  ];
  const events = extractTimeline(makeCtx("", repeatedLogs));
  const logEvents = events.filter(e => e.source === "log");
  expect(logEvents.length).toBe(1);
  expect(logEvents[0]!.message).toContain("×3");
});

test("extractTimeline: untimed events do not appear before timestamped ones", () => {
  const mixedLogs = [
    {
      name: "api", truncated: false,
      logs: ["no timestamp here (server starting)", "2026-06-26T10:00:01Z INFO ready"].join("\n"),
    },
  ];
  const events = extractTimeline(makeCtx("", mixedLogs));
  const firstTimed = events.findIndex(e => e.timestamp !== "");
  const lastUntimed = events.map((e, i) => e.timestamp === "" ? i : -1).filter(i => i >= 0).pop() ?? -1;
  // all untimed events must come after all timed events
  if (firstTimed >= 0 && lastUntimed >= 0) {
    expect(lastUntimed).toBeGreaterThan(firstTimed - 1);
  }
});

test("formatTimeline: returns a markdown table", () => {
  const events = extractTimeline(makeCtx(GIT_LOG, CONTAINER_LOGS));
  const table = formatTimeline(events);
  expect(table).toContain("| Time |");
  expect(table).toContain("| Source |");
  expect(table).toContain("| Message |");
  expect(table).toContain("|---");
});

test("formatTimeline: empty events returns empty string", () => {
  expect(formatTimeline([])).toBe("");
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test ./src/commands/postmortem/timeline.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/postmortem/timeline.ts`**

```ts
import type { PostmortemContext } from "./context";

export interface TimelineEvent {
  timestamp: string;    // ISO 8601, or "" for untimed
  source: "git" | "log";
  container?: string;
  message: string;
  level?: "error" | "warn" | "info";
}

const GIT_LINE_RE = /^([0-9a-f]{7,40})\s+(\S+)\s+(.+)$/;
const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
const ERROR_RE = /\b(error|fatal|critical)\b/i;
const WARN_RE = /\b(warn(?:ing)?)\b/i;

function normalizeLogLine(line: string): string {
  return line.replace(LOG_TS_RE, "").replace(/\[\d+\]\s*/g, "").trim().slice(0, 100);
}

function classifyLevel(line: string): TimelineEvent["level"] {
  if (ERROR_RE.test(line)) return "error";
  if (WARN_RE.test(line)) return "warn";
  return "info";
}

export function extractTimeline(ctx: PostmortemContext): TimelineEvent[] {
  const timed: TimelineEvent[] = [];
  const untimed: TimelineEvent[] = [];

  // Git pass
  for (const line of ctx.gitTimelineLog.split("\n").filter(Boolean)) {
    const m = line.match(GIT_LINE_RE);
    if (!m) continue;
    const [, hash, ts, msg] = m;
    timed.push({ timestamp: ts!, source: "git", message: `${msg} (${hash!.slice(0, 7)})` });
  }

  // Log pass (with deduplication per container)
  for (const { name, logs } of ctx.containerLogs) {
    const buckets = new Map<string, { count: number; ts: string; first_ts: string; level: TimelineEvent["level"] }>();
    for (const line of logs.split("\n").filter(Boolean)) {
      const tsMatch = line.match(LOG_TS_RE);
      const ts = tsMatch ? tsMatch[1]! : "";
      const normalized = normalizeLogLine(line);
      const prefix = normalized.slice(0, 60);
      const level = classifyLevel(line);
      const existing = buckets.get(prefix);
      if (existing) {
        existing.count++;
        if (ts) existing.ts = ts;
        if (level === "error") existing.level = "error";
      } else {
        buckets.set(prefix, { count: 1, ts, first_ts: ts, level });
      }
    }
    for (const [prefix, { count, ts, level }] of buckets) {
      const msg = count > 1 ? `${prefix} ×${count}` : prefix;
      const event: TimelineEvent = { timestamp: ts, source: "log", container: name, message: msg, level };
      if (ts) timed.push(event); else untimed.push(event);
    }
  }

  timed.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return [...timed, ...untimed];
}

export function formatTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) return "";
  const timed = events.filter(e => e.timestamp !== "");
  const untimed = events.filter(e => e.timestamp === "");

  const rows: string[] = ["| Time | Source | Message |", "|------|--------|---------|"];

  for (const e of timed) {
    const time = e.timestamp.replace(/T/, " ").slice(0, 19);
    const src = e.source === "git" ? "git" : `${e.container ?? "log"}${e.level === "error" ? " ⚠" : ""}`;
    rows.push(`| ${time} | ${src} | ${e.message.replace(/\|/g, "\\|")} |`);
  }

  if (untimed.length > 0) {
    rows.push("", "**Untimed Evidence**", "");
    for (const e of untimed) {
      rows.push(`- [${e.container ?? "log"}] ${e.message}`);
    }
  }

  return rows.join("\n");
}
```

- [ ] **Step 4: Run tests**

```bash
bun test ./src/commands/postmortem/timeline.test.ts 2>&1 | tail -5
```

Expected: 7 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/commands/postmortem/timeline.ts src/commands/postmortem/timeline.test.ts
git commit -m "feat: add postmortem timeline engine (git + log event extraction and sorting)"
```

---

## Task 6: Postmortem context — `gitTimelineLog` field

**Files:**
- Modify: `src/commands/postmortem/context.ts`

- [ ] **Step 1: Update `src/commands/postmortem/context.ts`**

Add `gitTimelineLog` to `PostmortemContext` and populate it:

```ts
export interface PostmortemContext {
  timestamp: string;
  since?: string;
  targetContainer?: string;
  systemMetrics: string;
  dockerStatus: string;
  containerLogs: Array<{ name: string; logs: string; truncated: boolean }>;
  gitLog: string;          // oneline format for human-readable display
  gitTimelineLog: string;  // hash + ISO date + subject for timeline engine
  gitLastCommit: string;
  topProcesses: string;
}
```

In `collectPostmortemContext`, add `gitTimelineLog` to the parallel calls:

```ts
const [metrics, dockerStatus, git, processes, gitLog, gitTimelineLog, gitLastCommit] = await Promise.all([
  safe(() => getSystemMetrics(), null),
  safe(() => getDockerStatus(), { available: false, containers: [] }),
  safe(() => getGitStatus(), { is_git_repo: false }),
  safe(() => getProcessList("cpu", 10), { processes: [] }),
  safe(() => $`git log --oneline -20`.quiet().text(), "(git log unavailable)"),
  safe(() => $`git log --format="%H %aI %s" -20`.quiet().text(), ""),
  safe(() => $`git show --stat HEAD`.quiet().text(), "(git show unavailable)"),
]);
```

Add `gitTimelineLog: gitTimelineLog.trim()` to the return object.

In `formatPostmortemContext`, pass through `gitLog` (oneline, unchanged for display).

- [ ] **Step 2: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: all pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add src/commands/postmortem/context.ts
git commit -m "feat: add gitTimelineLog field to PostmortemContext for timeline engine"
```

---

## Task 7: Default template + `--template` flag + index.ts wiring

**Files:**
- Create: `src/commands/postmortem/default-template.ts`
- Modify: `src/commands/postmortem/flags.ts`
- Modify: `src/commands/postmortem/flags.test.ts`
- Modify: `src/commands/postmortem/index.ts`

- [ ] **Step 1: Create `src/commands/postmortem/default-template.ts`**

```ts
export const DEFAULT_TEMPLATE = `## What Happened
<!-- Describe the user-visible impact and when it started -->

## Likely Root Cause
<!-- The single most proximate technical cause -->

## Contributing Factors
<!-- Secondary conditions that made the incident worse or harder to catch -->

## Timeline
<!-- Events in chronological order — use the timeline table provided -->

## Recommended Action Items
- [ ] <!-- Add specific, ownable follow-up tasks -->
`;
```

- [ ] **Step 2: Update `src/commands/postmortem/flags.ts`**

```ts
export interface PostmortemFlags {
  container?: string;
  since?: string;
  output?: string;
  template?: string;
}

export function parsePostmortemFlags(args: string[]): PostmortemFlags {
  const result: PostmortemFlags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--container" && args[i + 1]) result.container = args[++i];
    else if (args[i] === "--since" && args[i + 1]) result.since = args[++i];
    else if (args[i] === "--output" && args[i + 1]) result.output = args[++i];
    else if (args[i] === "--template" && args[i + 1]) result.template = args[++i];
  }
  return result;
}
```

- [ ] **Step 3: Append tests to `src/commands/postmortem/flags.test.ts`**

```ts
test("parsePostmortemFlags: parses --template flag", () => {
  const result = parsePostmortemFlags(["--template", "/path/to/template.md"]);
  expect(result.template).toBe("/path/to/template.md");
});

test("parsePostmortemFlags: --template does not affect other flags", () => {
  const result = parsePostmortemFlags(["--since", "2h", "--template", "tmpl.md", "--container", "api"]);
  expect(result.since).toBe("2h");
  expect(result.template).toBe("tmpl.md");
  expect(result.container).toBe("api");
});
```

- [ ] **Step 4: Update `src/commands/postmortem/index.ts`**

Replace the entire file:

```ts
import { resolve } from "path";
import { runAgentLoop } from "../../agent";
import { parseTimeSince } from "./time-parser";
import { parsePostmortemFlags } from "./flags";
import { collectPostmortemContext, formatPostmortemContext } from "./context";
import { extractTimeline, formatTimeline } from "./timeline";
import { DEFAULT_TEMPLATE } from "./default-template";
import type { LLMProvider } from "../../providers/types";

const MAX_TEMPLATE_BYTES = 50 * 1024; // 50KB

async function resolveTemplate(flagPath?: string): Promise<string> {
  // 1. --template flag
  if (flagPath) {
    const file = Bun.file(flagPath);
    try {
      if (file.size > MAX_TEMPLATE_BYTES) {
        process.stderr.write(`Warning: --template file exceeds 50KB; using default template.\n`);
        return DEFAULT_TEMPLATE;
      }
      return await file.text();
    } catch {
      process.stderr.write(`Warning: could not read --template file; using default template.\n`);
      return DEFAULT_TEMPLATE;
    }
  }

  // 2. .cael/postmortem-template.md in CWD
  const projectTemplate = Bun.file(".cael/postmortem-template.md");
  if (await projectTemplate.exists()) {
    try {
      if (projectTemplate.size <= MAX_TEMPLATE_BYTES) return await projectTemplate.text();
    } catch {}
  }

  // 3. Built-in default
  return DEFAULT_TEMPLATE;
}

const POSTMORTEM_PROMPT = (template: string, timeline: string, context: string) =>
  `You are a senior site reliability engineer. Using only the data provided below, draft a concise incident postmortem in markdown. Fill in each section defined in the template below — preserve the section headers exactly as written.

${timeline ? `## Pre-sorted Incident Timeline\n\n${timeline}\n\n---\n\n` : ""}TEMPLATE TO FILL IN:
${template}

---
INCIDENT DATA:
${context}`;

export async function runPostmortem(rawArgs: string, provider: LLMProvider): Promise<void> {
  const args = rawArgs.trim() ? rawArgs.trim().split(/\s+/) : [];
  const flags = parsePostmortemFlags(args);

  let since: string | undefined;
  if (flags.since) {
    const parsed = parseTimeSince(flags.since);
    if (!parsed) {
      throw new Error(`Invalid --since value "${flags.since}". Use formats like 30m, 2h, 1d, or an ISO timestamp.`);
    }
    since = parsed;
  }

  const target = flags.container;
  const outputFile = flags.output;

  process.stdout.write(
    `Collecting incident context${target ? ` for container: ${target}` : ""}${since ? ` since ${since}` : ""}...\n\n`
  );

  const [ctx, template] = await Promise.all([
    collectPostmortemContext(target, since),
    resolveTemplate(flags.template),
  ]);

  const events = extractTimeline(ctx);
  const timelineTable = formatTimeline(events);
  const contextBlock = formatPostmortemContext(ctx);

  process.stdout.write(`[${provider.name}] drafting postmortem...\n\n`);

  const postmortem = await runAgentLoop(
    provider,
    [{ role: "user", content: POSTMORTEM_PROMPT(template, timelineTable, contextBlock) }],
    {
      system: "You are a senior SRE. Draft postmortems that are blameless, factual, and actionable.",
      maxIterations: 1,
    }
  );

  const header = `# Incident Postmortem\n_Generated by Cael at ${ctx.timestamp}_\n\n`;
  const output = header + postmortem;

  if (outputFile) {
    const resolvedOutput = resolve(outputFile);
    const cwd = process.cwd();
    if (resolvedOutput !== cwd && !resolvedOutput.startsWith(cwd + "/")) {
      throw new Error(`Output path must be within the working directory`);
    }
    await Bun.write(resolvedOutput, output);
    console.log(postmortem);
    console.log(`\n---\nSaved to ${outputFile}`);
  } else {
    console.log(output);
  }
}
```

- [ ] **Step 5: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/commands/postmortem/default-template.ts src/commands/postmortem/flags.ts src/commands/postmortem/flags.test.ts src/commands/postmortem/index.ts
git commit -m "feat: postmortem custom templates, timeline injection, --template flag"
```

---

## Task 8: `src/version.ts` + `cael --version`

**Files:**
- Create: `src/version.ts`
- Modify: `index.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `src/version.ts`**

```ts
// BUILD_VERSION is injected at compile time via --define BUILD_VERSION='"v1.2.3"'.
// Falls back to "dev" when running via `bun run index.ts`.
declare const BUILD_VERSION: string;
export const VERSION: string = typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "dev";

export function printVersion(): void {
  console.log(`cael ${VERSION}`);
}
```

- [ ] **Step 2: Add `--version` routing to `index.ts` before all subcommand routing**

In the `if (import.meta.main)` block, add immediately after `const rawArgs = process.argv.slice(2);`:

```ts
if (rawArgs.includes("--version") || rawArgs.includes("-V")) {
  const { printVersion } = await import("./src/version");
  printVersion();
  process.exit(0);
}
```

- [ ] **Step 3: Add `"update"` to `SUBCOMMANDS` and help text in `index.ts`**

In `SUBCOMMANDS`:
```ts
const SUBCOMMANDS = ["ask", "config", "deploy-check", "doctor", "postmortem", "update", "watch"] as const;
```

In `HELP_TEXT`, add:
```
  update                      Check for and install the latest cael release
```

- [ ] **Step 4: Update `package.json` to inject BUILD_VERSION**

Replace the `build` and `build:all` scripts:

```json
"build": "bun build --compile --define 'BUILD_VERSION=\"$(git describe --tags --exact-match 2>/dev/null || echo dev)\"' index.ts --outfile cael",
"build:all": "bun build --compile --target=bun-darwin-arm64 --define 'BUILD_VERSION=\"$(git describe --tags --exact-match 2>/dev/null || echo dev)\"' index.ts --outfile cael-darwin-arm64 && bun build --compile --target=bun-darwin-x64 --define 'BUILD_VERSION=\"$(git describe --tags --exact-match 2>/dev/null || echo dev)\"' index.ts --outfile cael-darwin-x64 && bun build --compile --target=bun-linux-x64 --define 'BUILD_VERSION=\"$(git describe --tags --exact-match 2>/dev/null || echo dev)\"' index.ts --outfile cael-linux-x64 && bun build --compile --target=bun-linux-arm64 --define 'BUILD_VERSION=\"$(git describe --tags --exact-match 2>/dev/null || echo dev)\"' index.ts --outfile cael-linux-arm64"
```

- [ ] **Step 5: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Smoke test `--version`**

```bash
bun run index.ts --version
```

Expected: `cael dev`

- [ ] **Step 7: Commit**

```bash
git add src/version.ts index.ts package.json
git commit -m "feat: add VERSION constant, cael --version flag, update to SUBCOMMANDS"
```

---

## Task 9: `cael update` command

**Files:**
- Create: `src/commands/update.ts`
- Create: `src/commands/update.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Write failing tests**

Create `src/commands/update.test.ts`:

```ts
import { test, expect, mock, afterEach } from "bun:test";
import {
  compareVersions,
  getAssetName,
  parseChecksum,
} from "./update";

test("compareVersions: same version returns false (no update needed)", () => {
  expect(compareVersions("v0.2.0", "v0.2.0")).toBe(false);
});

test("compareVersions: newer remote returns true", () => {
  expect(compareVersions("v0.1.0", "v0.2.0")).toBe(true);
});

test("compareVersions: dev build returns false (cannot update dev)", () => {
  expect(compareVersions("dev", "v0.2.0")).toBe(false);
});

test("getAssetName: returns correct name for darwin arm64", () => {
  expect(getAssetName("darwin", "arm64")).toBe("cael-darwin-arm64");
});

test("getAssetName: returns correct name for linux x64", () => {
  expect(getAssetName("linux", "x64")).toBe("cael-linux-x64");
});

test("getAssetName: returns null for unsupported platform", () => {
  expect(getAssetName("win32", "x64")).toBeNull();
});

test("parseChecksum: finds SHA256 for a given filename", () => {
  const checksums = `abc123  cael-darwin-arm64\ndef456  cael-linux-x64\n`;
  expect(parseChecksum(checksums, "cael-darwin-arm64")).toBe("abc123");
});

test("parseChecksum: returns null when filename not found", () => {
  expect(parseChecksum("abc123  cael-linux-x64\n", "cael-darwin-arm64")).toBeNull();
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test ./src/commands/update.test.ts 2>&1 | tail -5
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/commands/update.ts`**

```ts
import { VERSION } from "../version";

const REPO = "myst9811/Cael";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 10_000;

// Returns true if a newer version is available and current is not dev.
export function compareVersions(current: string, latest: string): boolean {
  if (current === "dev") return false;
  return current !== latest;
}

export function getAssetName(platform: string, arch: string): string | null {
  if (platform === "darwin" && arch === "arm64") return "cael-darwin-arm64";
  if (platform === "darwin" && arch === "x64")  return "cael-darwin-x64";
  if (platform === "linux"  && arch === "x64")  return "cael-linux-x64";
  if (platform === "linux"  && arch === "arm64") return "cael-linux-arm64";
  return null;
}

export function parseChecksum(content: string, filename: string): string | null {
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[1] === filename) return parts[0] ?? null;
  }
  return null;
}

export async function runUpdate(): Promise<void> {
  // Pre-flight: dev build
  if (VERSION === "dev") {
    console.error("Cannot update a dev build. Use `bun run index.ts`.");
    process.exit(1);
  }

  // Pre-flight: not running as compiled cael binary
  const execPath = process.execPath;
  if (execPath.endsWith("/bun") || (!execPath.endsWith("/cael") && !execPath.includes("/cael-"))) {
    console.log("Not running as a compiled cael binary. Skipping self-update.");
    process.exit(0);
  }

  // Pre-flight: Homebrew install
  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/")) {
    console.error("Installed via Homebrew — run `brew upgrade cael` instead.");
    process.exit(0);
  }

  process.stdout.write("Checking for updates...\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let releaseData: { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
  try {
    const res = await fetch(API_URL, {
      headers: { "User-Agent": `cael/${VERSION}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    releaseData = await res.json() as typeof releaseData;
  } finally {
    clearTimeout(timer);
  }

  const { tag_name, assets } = releaseData;

  if (!compareVersions(VERSION, tag_name)) {
    console.log(`Already at ${tag_name}.`);
    return;
  }

  const assetName = getAssetName(process.platform, process.arch);
  if (!assetName) {
    console.error(`Unsupported platform: ${process.platform}/${process.arch}. Download manually from https://github.com/${REPO}/releases.`);
    process.exit(1);
  }

  const binaryAsset = assets.find(a => a.name === assetName);
  const checksumAsset = assets.find(a => a.name === "checksums.sha256");

  if (!binaryAsset) {
    console.error(`No binary asset found for ${assetName} in release ${tag_name}.`);
    process.exit(1);
  }

  process.stdout.write(`Downloading ${assetName} (${tag_name})...\n`);

  // Download binary to temp file
  const tmpPath = `${execPath}.tmp`;
  const binRes = await fetch(binaryAsset.browser_download_url);
  if (!binRes.ok) throw new Error(`Download failed: ${binRes.status}`);
  await Bun.write(tmpPath, binRes);

  // Verify checksum if available
  if (checksumAsset) {
    const csRes = await fetch(checksumAsset.browser_download_url);
    if (csRes.ok) {
      const csContent = await csRes.text();
      const expected = parseChecksum(csContent, assetName);
      if (expected) {
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(await Bun.file(tmpPath).arrayBuffer());
        const actual = hasher.digest("hex");
        if (actual !== expected) {
          await Bun.file(tmpPath).unlink?.() ?? import("node:fs").then(fs => fs.unlinkSync(tmpPath));
          console.error("Checksum mismatch — aborting update. The downloaded file has been deleted.");
          process.exit(1);
        }
      }
    }
  }

  // Atomic replace
  try {
    const proc = Bun.spawn(["mv", tmpPath, execPath], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) throw new Error("mv failed");
    await Bun.spawn(["chmod", "0755", execPath], { stdout: "pipe", stderr: "pipe" }).exited;
  } catch {
    console.error(`Permission denied updating ${execPath}. Try: sudo cael update`);
    process.exit(1);
  }

  console.log(`Updated to ${tag_name}.`);
}
```

- [ ] **Step 4: Add `update` routing to `index.ts` before the provider check**

After the `doctor` block and before `if (!providerSpec)`, add:

```ts
if (subcommand === "update") {
  const { runUpdate } = await import("./src/commands/update");
  await runUpdate().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  process.exit(0);
}
```

- [ ] **Step 5: Run tests**

```bash
bun test ./src/commands/update.test.ts 2>&1 | tail -5
```

Expected: 8 pass, 0 fail.

- [ ] **Step 6: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: all pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/commands/update.ts src/commands/update.test.ts index.ts
git commit -m "feat: add cael update command with checksum verification and safe atomic replace"
```

---

## Task 10: Release workflow — checksums, `BUILD_VERSION`, Homebrew

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Read current release.yml**

```bash
cat .github/workflows/release.yml
```

- [ ] **Step 2: Replace `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Build all targets
        run: |
          VERSION=${GITHUB_REF_NAME}
          bun build --compile --target=bun-darwin-arm64 --define "BUILD_VERSION=\"${VERSION}\"" index.ts --outfile cael-darwin-arm64
          bun build --compile --target=bun-darwin-x64   --define "BUILD_VERSION=\"${VERSION}\"" index.ts --outfile cael-darwin-x64
          bun build --compile --target=bun-linux-x64    --define "BUILD_VERSION=\"${VERSION}\"" index.ts --outfile cael-linux-x64
          bun build --compile --target=bun-linux-arm64  --define "BUILD_VERSION=\"${VERSION}\"" index.ts --outfile cael-linux-arm64

      - name: Generate checksums
        run: sha256sum cael-darwin-arm64 cael-darwin-x64 cael-linux-x64 cael-linux-arm64 > checksums.sha256

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            cael-darwin-arm64
            cael-darwin-x64
            cael-linux-x64
            cael-linux-arm64
            checksums.sha256

      - name: Update Homebrew tap
        if: ${{ secrets.HOMEBREW_TAP_TOKEN != '' }}
        env:
          HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
        run: |
          ARM64_SHA=$(grep cael-darwin-arm64 checksums.sha256 | cut -d' ' -f1)
          VERSION=${GITHUB_REF_NAME}
          git clone https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/myst9811/homebrew-cael.git tap
          mkdir -p tap/Formula
          cat > tap/Formula/cael.rb << EOF
          class Cael < Formula
            desc "Local DevOps AI agent for incident investigation"
            homepage "https://github.com/myst9811/Cael"
            version "${VERSION}"
            on_macos do
              on_arm do
                url "https://github.com/myst9811/Cael/releases/download/${VERSION}/cael-darwin-arm64"
                sha256 "${ARM64_SHA}"
                def install
                  bin.install "cael-darwin-arm64" => "cael"
                end
              end
              on_intel do
                odie "cael does not provide a macOS x86_64 binary."
              end
            end
          end
          EOF
          cd tap
          git config user.email "ci@cael"
          git config user.name "Cael CI"
          git add Formula/cael.rb
          git diff --cached --quiet || git commit -m "cael ${VERSION}" && git push
```

- [ ] **Step 3: Run full suite one final time**

```bash
bun test 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: add checksums, BUILD_VERSION injection, and Homebrew tap to release workflow"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task(s) | Status |
|-------------|---------|--------|
| `dirty_file_paths` + `behind_commits` in `GitStatus` | Task 1 | ✓ |
| `DeployPolicy` + `loadDeployPolicy` (project→user→default) | Task 2 | ✓ |
| Inode check (20pts) | Task 3 | ✓ |
| Branch upstream check (20pts) | Task 3 | ✓ |
| Lockfile detection in git check | Task 3 | ✓ |
| `go_threshold: 112`, `caution_threshold: 84` (out of 140) | Task 3 | ✓ |
| `formatScoreTable` with new rows | Task 4 | ✓ |
| `inode_critical` in hard-block label map | Task 4 | ✓ |
| `extractTimeline` + `formatTimeline` | Task 5 | ✓ |
| Deduplication of repeated log lines | Task 5 | ✓ |
| Untimed events after sorted timeline | Task 5 | ✓ |
| `gitTimelineLog` in `PostmortemContext` | Task 6 | ✓ |
| `DEFAULT_TEMPLATE` constant | Task 7 | ✓ |
| `--template` flag + resolution order | Task 7 | ✓ |
| 50KB cap + graceful fallback for templates | Task 7 | ✓ |
| Timeline injected into postmortem prompt | Task 7 | ✓ |
| `src/version.ts` + `BUILD_VERSION` | Task 8 | ✓ |
| `cael --version` flag | Task 8 | ✓ |
| `cael update` dev/Homebrew detection | Task 9 | ✓ |
| `cael update` checksum verification + abort on mismatch | Task 9 | ✓ |
| `cael update` atomic rename + permission error message | Task 9 | ✓ |
| `update` routed before provider check | Task 9 | ✓ |
| SHA256 checksums in release workflow | Task 10 | ✓ |
| `BUILD_VERSION` injected in all build targets | Task 10 | ✓ |
| Homebrew formula (arm64 only, `odie` on intel) | Task 10 | ✓ |
| `if: ${{ secrets.HOMEBREW_TAP_TOKEN != '' }}` | Task 10 | ✓ |

**Placeholder scan:** No TBDs. `LOCKFILES` set is defined in scorer.ts Task 3 and used there. `parseChecksum` is exported and tested in Task 9. All type references resolve to definitions in the same task or earlier tasks.

**Type consistency:**
- `DeployInput.disk_inode_percent?: number` — defined Task 3, populated Task 4. ✓
- `DeployInput.git.dirty_file_paths?: string[]` — defined Task 3, populated Task 4 from `git?.dirty_file_paths`. ✓
- `DeployInput.git.behind_commits?: number | null` — defined Task 3, populated Task 4. ✓
- `PostmortemContext.gitTimelineLog` — added Task 6, consumed by `extractTimeline` in Task 5 (defined before use but `extractTimeline` is called at runtime). ✓
- `DEFAULT_POLICY` exported from `policy.ts` Task 2, imported in `scorer.ts` Task 3. ✓
