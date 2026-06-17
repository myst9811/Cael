import { getSystemMetrics } from "./system";
import { getDockerStatus } from "./docker";
import { getGitStatus } from "./git";
import { getProcessList } from "./process";
import type { CollectedContext, CollectorError } from "./types";

const TIMEOUT_MS = 5000;

async function withTimeout<T>(fn: () => Promise<T>): Promise<T | CollectorError> {
  return Promise.race([
    fn().catch((e: any): CollectorError => ({ error: e?.message ?? String(e) })),
    new Promise<CollectorError>(resolve =>
      setTimeout(() => resolve({ error: `timeout after ${TIMEOUT_MS}ms` }), TIMEOUT_MS)
    ),
  ]);
}

export async function collectAll(): Promise<CollectedContext> {
  const [system, docker, git, processes] = await Promise.all([
    withTimeout(getSystemMetrics),
    withTimeout(getDockerStatus),
    withTimeout(getGitStatus),
    withTimeout(() => getProcessList()),
  ]);
  return { timestamp: new Date().toISOString(), system, docker, git, processes };
}
