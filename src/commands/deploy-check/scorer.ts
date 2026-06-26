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
    return { score: 20, max: 20, label: "no upstream" };
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
    const parts: string[] = [];
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
