import { collectAll } from "../../collectors";
import { runAgentLoop } from "../../agent";
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
    cpu_percent:        system?.cpu_percent        ?? 0,
    mem_percent:        system?.mem_percent        ?? 0,
    disk_percent:       system?.disk_percent       ?? 0,
    disk_inode_percent: system?.disk_inode_percent,
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
