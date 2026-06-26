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
    itemLine("CPU",    result.items.cpu),
    itemLine("Memory", result.items.memory),
    itemLine("Disk",   result.items.disk),
    itemLine("Inodes", result.items.inodes),
    itemLine("Docker", result.items.docker),
    itemLine("Git",    result.items.git),
    itemLine("Branch", result.items.branch_upstream),
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
