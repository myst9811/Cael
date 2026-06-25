import { collectAll } from "../collectors";
import { runAgentLoop } from "../agent";
import { collectorTools } from "../tools";
import type { LLMProvider } from "../providers/types";
import type { CollectedContext, SystemMetrics, DockerStatus, GitStatus, ProcessList, CollectorError } from "../collectors/types";

function isError(v: unknown): v is CollectorError {
  return typeof v === "object" && v !== null && "error" in v;
}

function formatContext(ctx: CollectedContext): string {
  const lines: string[] = [
    `Snapshot collected at ${ctx.timestamp}`,
    "",
  ];

  if (isError(ctx.system)) {
    lines.push(`SYSTEM METRICS: (unavailable: ${ctx.system.error})`);
  } else {
    const s = ctx.system as SystemMetrics;
    lines.push("SYSTEM METRICS:");
    lines.push(`  CPU ${s.cpu_percent.toFixed(1)}%  |  Load: ${s.load_avg.map(n => n.toFixed(2)).join(", ")}`);
    lines.push(`  Memory ${s.mem_used_gb.toFixed(1)} / ${s.mem_total_gb.toFixed(1)} GB (${s.mem_percent.toFixed(0)}%)`);
    lines.push(`  Disk   ${s.disk_used_gb.toFixed(0)} / ${s.disk_total_gb.toFixed(0)} GB (${s.disk_percent}%)`);
  }

  lines.push("");

  if (isError(ctx.docker)) {
    lines.push(`DOCKER: (unavailable: ${ctx.docker.error})`);
  } else {
    const d = ctx.docker as DockerStatus;
    if (!d.available) {
      lines.push(`DOCKER: ${d.error ?? "not running"}`);
    } else {
      lines.push("DOCKER CONTAINERS:");
      if (d.containers.length === 0) {
        lines.push("  (no containers)");
      } else {
        for (const c of d.containers) {
          const icon = c.status === "running" ? "●" : "✕";
          const exitInfo = c.exit_code !== undefined ? ` (exit ${c.exit_code})` : "";
          lines.push(`  ${icon} ${c.name.padEnd(20)} ${c.status.toUpperCase()}${exitInfo}  ${c.image}`);
        }
      }
    }
  }

  lines.push("");

  if (isError(ctx.git)) {
    lines.push(`GIT: (unavailable: ${ctx.git.error})`);
  } else {
    const g = ctx.git as GitStatus;
    if (!g.is_git_repo) {
      lines.push("GIT: not a git repository");
    } else {
      lines.push("GIT STATUS:");
      lines.push(`  Branch: ${g.branch ?? "unknown"}`);
      if ((g.dirty_files ?? 0) > 0) lines.push(`  Dirty files: ${g.dirty_files}`);
      if ((g.untracked_files ?? 0) > 0) lines.push(`  Untracked: ${g.untracked_files}`);
      if (g.unpushed_commits === null) lines.push("  Unpushed: unknown (no upstream)");
      else if ((g.unpushed_commits ?? 0) > 0) lines.push(`  Unpushed commits: ${g.unpushed_commits}`);
      if (g.last_commit_message) lines.push(`  Last commit: ${g.last_commit_message} (${g.last_commit_hash})`);
    }
  }

  lines.push("");

  if (isError(ctx.processes)) {
    lines.push(`PROCESSES: (unavailable: ${ctx.processes.error})`);
  } else {
    const pl = ctx.processes as ProcessList;
    lines.push("TOP PROCESSES (by CPU):");
    for (const p of pl.processes.slice(0, 5)) {
      lines.push(`  ${p.name.padEnd(30)} CPU: ${p.cpu_percent.toFixed(1).padStart(5)}%  MEM: ${p.mem_mb.toFixed(0)} MB`);
    }
  }

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are Cael, a local DevOps agent. You are given a live snapshot of this machine's system state. Use the provided tools to get more detail when needed — especially get_docker_logs for container issues. Never fabricate or estimate metrics — only report what you can observe.`;

function formatEvidenceBlock(ctx: CollectedContext, toolsUsed: string[], providerName: string): string {
  const snapshotTime = ctx.timestamp.replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const toolsSummary = toolsUsed.length > 0
    ? [...new Set(toolsUsed)].join(", ")
    : "none (answered from snapshot)";
  const lines = [
    "─".repeat(60),
    `Evidence  |  Snapshot: ${snapshotTime}  |  Provider: ${providerName}`,
    `Tools called: ${toolsSummary}`,
  ];
  if (!isError(ctx.system)) {
    const s = ctx.system as SystemMetrics;
    lines.push(
      `Key metrics: CPU ${s.cpu_percent.toFixed(1)}%  |  MEM ${s.mem_used_gb.toFixed(1)}/${s.mem_total_gb.toFixed(0)} GB  |  DISK ${s.disk_used_gb.toFixed(0)}/${s.disk_total_gb.toFixed(0)} GB`
    );
  }
  return lines.join("\n");
}

export async function runAsk(question: string, provider: LLMProvider): Promise<void> {
  process.stdout.write("Collecting system state...\n\n");
  const ctx = await collectAll();
  const contextBlock = formatContext(ctx);

  process.stdout.write(`[${provider.name}] analyzing...\n\n`);

  const toolsUsed: string[] = [];
  const result = await runAgentLoop(
    provider,
    [{ role: "user", content: `${contextBlock}\n\n---\n\n${question}` }],
    {
      system: SYSTEM_PROMPT,
      onToolCall: (name) => toolsUsed.push(name),
    },
  );

  console.log(result);
  console.log("");
  console.log(formatEvidenceBlock(ctx, toolsUsed, provider.name));
}
