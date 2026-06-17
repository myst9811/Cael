import type { SystemMetrics, DockerStatus, GitStatus, CollectorError } from "../collectors/types";

const G = "\x1b[32m";   // green
const Y = "\x1b[33m";   // yellow
const R = "\x1b[31m";   // red
const Z = "\x1b[0m";    // reset

function cpuColor(pct: number): string {
  return pct > 85 ? R : pct > 70 ? Y : G;
}

function memColor(pct: number): string {
  return pct > 90 ? R : pct > 80 ? Y : G;
}

function diskColor(pct: number): string {
  return pct > 95 ? R : pct > 85 ? Y : G;
}

export function renderSystemPanel(data: SystemMetrics | CollectorError): string[] {
  if ("error" in data) {
    return ["SYSTEM", `  ⚠ ${(data as CollectorError).error.slice(0, 28)}`];
  }
  const m = data as SystemMetrics;
  return [
    "SYSTEM",
    `  CPU   ${cpuColor(m.cpu_percent)}${m.cpu_percent.toFixed(0).padStart(3)}%${Z}`,
    `  MEM   ${memColor(m.mem_percent)}${m.mem_used_gb.toFixed(1)}/${m.mem_total_gb.toFixed(0)}GB${Z}`,
    `  DISK  ${diskColor(m.disk_percent)}${m.disk_percent.toFixed(0).padStart(3)}%${Z}`,
    `  LOAD  ${m.load_avg[0].toFixed(2)}`,
  ];
}

export function renderDockerPanel(data: DockerStatus | CollectorError): string[] {
  if ("error" in data) {
    return ["DOCKER", `  ⚠ ${(data as CollectorError).error.slice(0, 28)}`];
  }
  const d = data as DockerStatus;
  if (!d.available) {
    return ["DOCKER", "  ○ daemon unavailable"];
  }
  if (d.containers.length === 0) {
    return ["DOCKER", "  no containers"];
  }
  const lines: string[] = ["DOCKER"];
  for (const c of d.containers.slice(0, 6)) {
    const icon =
      c.status === "running"    ? `${G}●${Z}` :
      c.status === "restarting" ? `${Y}↻${Z}` : `${R}✕${Z}`;
    const name = c.name.slice(0, 10).padEnd(10);
    const statusStr =
      c.status === "running"    ? `${G}UP  ${Z}` :
      c.status === "paused"     ? `${Y}PAUS${Z}` :
      c.status === "restarting" ? `${Y}RSTR${Z}` : `${R}DOWN${Z}`;
    lines.push(`  ${icon} ${name} ${statusStr}`);
  }
  return lines;
}

export function renderGitPanel(data: GitStatus | CollectorError): string[] {
  if ("error" in data) {
    return ["GIT", `  ⚠ ${(data as CollectorError).error.slice(0, 28)}`];
  }
  const g = data as GitStatus;
  if (!g.is_git_repo) {
    return ["GIT", "  not a git repo"];
  }
  const lines: string[] = ["GIT"];
  if (g.branch) lines.push(`  ${G}${g.branch}${Z}`);
  if (g.unpushed_commits) lines.push(`  ${Y}↑${g.unpushed_commits} unpushed${Z}`);
  if (g.dirty_files) lines.push(`  ${Y}${g.dirty_files} dirty${Z}`);
  if (g.untracked_files) lines.push(`  ${Y}${g.untracked_files} untracked${Z}`);
  if (g.stash_count) lines.push(`  ${G}${g.stash_count} stashed${Z}`);
  return lines;
}
