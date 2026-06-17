import { $ } from "bun";
import { getSystemMetrics } from "../../collectors/system";
import { getDockerStatus, getDockerLogs } from "../../collectors/docker";
import { getGitStatus } from "../../collectors/git";
import { getProcessList } from "../../collectors/process";

export interface PostmortemContext {
  timestamp: string;
  since?: string;
  targetContainer?: string;
  systemMetrics: string;
  dockerStatus: string;
  containerLogs: Array<{ name: string; logs: string; truncated: boolean }>;
  gitLog: string;
  gitLastCommit: string;
  topProcesses: string;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function collectPostmortemContext(
  targetContainer?: string,
  since?: string
): Promise<PostmortemContext> {
  const timestamp = new Date().toISOString();

  const [metrics, dockerStatus, git, processes, gitLog, gitLastCommit] = await Promise.all([
    safe(() => getSystemMetrics(), null),
    safe(() => getDockerStatus(), { available: false, containers: [] }),
    safe(() => getGitStatus(), { is_git_repo: false }),
    safe(() => getProcessList("cpu", 10), { processes: [] }),
    safe(() => $`git log --oneline -20`.quiet().text(), "(git log unavailable)"),
    safe(() => $`git show --stat HEAD`.quiet().text(), "(git show unavailable)"),
  ]);

  // Collect logs: for the target container, or all exited/restarting containers
  const containerLogs: PostmortemContext["containerLogs"] = [];
  if (dockerStatus.available) {
    const targets = targetContainer
      ? dockerStatus.containers.filter(c => c.name === targetContainer)
      : dockerStatus.containers.filter(c => c.status !== "running");

    await Promise.all(
      targets.map(async c => {
        const result = await safe(
          () => getDockerLogs(c.name, 200, since),
          { logs: "(logs unavailable)", truncated: false }
        );
        containerLogs.push({ name: c.name, logs: result.logs, truncated: result.truncated });
      })
    );
  } else if (targetContainer) {
    // Docker unavailable but container was explicitly requested
    const result = await safe(
      () => getDockerLogs(targetContainer, 200, since),
      { logs: "(logs unavailable)", truncated: false }
    );
    containerLogs.push({ name: targetContainer, logs: result.logs, truncated: result.truncated });
  }

  return {
    timestamp,
    since,
    targetContainer,
    systemMetrics: metrics ? JSON.stringify(metrics, null, 2) : "(unavailable)",
    dockerStatus: JSON.stringify(dockerStatus, null, 2),
    containerLogs,
    gitLog: gitLog.trim() || "(no commits)",
    gitLastCommit: gitLastCommit.trim() || "(unavailable)",
    topProcesses: JSON.stringify(processes, null, 2),
  };
}

export function formatPostmortemContext(ctx: PostmortemContext): string {
  const sections: string[] = [
    `=== INCIDENT CONTEXT (collected ${ctx.timestamp}) ===`,
    ctx.since ? `Period: since ${ctx.since}` : "",
    "",
    "--- SYSTEM METRICS ---",
    ctx.systemMetrics,
    "",
    "--- DOCKER STATUS ---",
    ctx.dockerStatus,
    "",
  ];

  if (ctx.containerLogs.length > 0) {
    for (const { name, logs, truncated } of ctx.containerLogs) {
      sections.push(`--- LOGS: ${name}${truncated ? " (truncated)" : ""} ---`);
      sections.push(logs);
      sections.push("");
    }
  } else {
    sections.push("--- CONTAINER LOGS ---");
    sections.push("(no stopped containers or Docker unavailable)");
    sections.push("");
  }

  sections.push(
    "--- RECENT GIT HISTORY (last 20 commits) ---",
    ctx.gitLog,
    "",
    "--- LAST COMMIT DETAILS ---",
    ctx.gitLastCommit,
    "",
    "--- TOP PROCESSES ---",
    ctx.topProcesses,
  );

  return sections.join("\n");
}
