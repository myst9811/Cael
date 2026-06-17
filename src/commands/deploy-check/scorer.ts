export interface DeployInput {
  cpu_percent: number;
  mem_percent: number;
  disk_percent: number;
  docker: {
    available: boolean;
    containers: Array<{ name: string; status: "running" | "exited" | "paused" | "restarting"; exit_code?: number }>;
  };
  git: { dirty_files?: number; unpushed_commits?: number | null };
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
  hard_block?: "disk_full" | "docker_restarting";
  items: {
    cpu: CheckItem;
    memory: CheckItem;
    disk: CheckItem;
    docker: CheckItem;
    git: CheckItem;
  };
}

export function calculateDeployScore(input: DeployInput): ScoreResult {
  const cpu = scoreCpu(input.cpu_percent);
  const memory = scoreMemory(input.mem_percent);
  const disk = scoreDisk(input.disk_percent);
  const docker = scoreDocker(input.docker);
  const git = scoreGit(input.git);

  const total = cpu.score + memory.score + disk.score + docker.score + git.score;

  let hard_block: ScoreResult["hard_block"];
  if (disk.score === 0 && input.disk_percent > 95) hard_block = "disk_full";
  else if (input.docker.containers.some(c => c.status === "restarting")) hard_block = "docker_restarting";

  let go_no_go: ScoreResult["go_no_go"];
  if (hard_block) go_no_go = "NO-GO";
  else if (total >= 80) go_no_go = "GO";
  else if (total >= 60) go_no_go = "CAUTION";
  else go_no_go = "NO-GO";

  return { total, go_no_go, hard_block, items: { cpu, memory, disk, docker, git } };
}

function scoreCpu(pct: number): CheckItem {
  if (pct < 70) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= 85) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "critical" };
}

function scoreMemory(pct: number): CheckItem {
  if (pct < 80) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= 90) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "critical" };
}

function scoreDisk(pct: number): CheckItem {
  if (pct < 85) return { score: 20, max: 20, label: `${pct.toFixed(0)}%` };
  if (pct <= 95) return { score: 10, max: 20, label: `${pct.toFixed(0)}%`, warning: true, details: "high" };
  return { score: 0, max: 20, label: `${pct.toFixed(0)}%`, details: "FULL — hard block", warning: true };
}

function scoreDocker(docker: DeployInput["docker"]): CheckItem {
  if (!docker.available) {
    return { score: 10, max: 20, label: "unavailable", details: "cannot verify", warning: true };
  }

  const restarting = docker.containers.filter(c => c.status === "restarting");
  if (restarting.length > 0) {
    return {
      score: 0, max: 20,
      label: `${restarting.length} restarting`,
      details: restarting.map(c => c.name).join(", "),
      warning: true,
    };
  }

  const badExits = docker.containers.filter(c => c.status === "exited" && (c.exit_code ?? 0) !== 0);
  const cleanExits = docker.containers.filter(c => c.status === "exited" && (c.exit_code ?? 0) === 0);
  const running = docker.containers.filter(c => c.status === "running").length;
  const total = docker.containers.length;

  if (badExits.length > 0) {
    return {
      score: 0, max: 20,
      label: `${running}/${total} UP`,
      details: badExits.map(c => `${c.name}: Exited (${c.exit_code})`).join(", "),
      warning: true,
    };
  }

  if (cleanExits.length > 0) {
    return {
      score: 10, max: 20,
      label: `${running}/${total} UP`,
      details: cleanExits.map(c => c.name).join(", ") + " stopped cleanly",
      warning: true,
    };
  }

  return { score: 20, max: 20, label: `${running}/${total} UP` };
}

function scoreGit(git: DeployInput["git"]): CheckItem {
  const dirty = git.dirty_files ?? 0;
  const unpushed = git.unpushed_commits;

  const hasDirty = dirty > 0;
  const hasUnpushed = unpushed === null ? true : unpushed > 0;

  if (!hasDirty && !hasUnpushed) {
    return { score: 20, max: 20, label: "clean" };
  }
  if (hasDirty && hasUnpushed) {
    const parts = [];
    if (dirty > 0) parts.push(`${dirty} dirty`);
    if (unpushed === null) parts.push("upstream unknown");
    else if (unpushed > 0) parts.push(`${unpushed} unpushed`);
    return { score: 0, max: 20, label: parts.join(", "), warning: true };
  }
  const label = hasDirty
    ? `${dirty} dirty file${dirty > 1 ? "s" : ""}`
    : unpushed === null ? "upstream unknown" : `${unpushed} unpushed`;
  return { score: 10, max: 20, label, warning: true };
}
