import type { ContainerInspect } from "../collectors/types";

const ZERO_TIME = "0001-01-01T00:00:00Z";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatUptime(
  startedAt: string,
  finishedAt: string,
  status: string,
  now = Date.now()
): string {
  if (status === "running") {
    const t = new Date(startedAt).getTime();
    if (isNaN(t)) return "unknown";
    return `started ${formatDuration(now - t)} ago`;
  }
  if (finishedAt && finishedAt !== ZERO_TIME) {
    const t = new Date(finishedAt).getTime();
    if (isNaN(t)) return "stopped";
    return `stopped ${formatDuration(now - t)} ago`;
  }
  return "stopped";
}

export function renderContainerDetail(inspect: ContainerInspect, compact: boolean): string[] {
  const uptime = formatUptime(inspect.startedAt, inspect.finishedAt, inspect.status);
  const status = inspect.status.toUpperCase();
  const portStr = inspect.ports.length > 0
    ? inspect.ports.slice(0, 3).join(", ")
    : "no ports";
  const exitStr = inspect.status !== "running" ? `  exit: ${inspect.exitCode}` : "";

  if (compact) {
    return [
      `  ${inspect.name}  ${status}  ${uptime}  restarts: ${inspect.restartCount}${exitStr}  ${inspect.image}  ${portStr}`,
    ];
  }
  return [
    `  ${inspect.name}   ${status}  ${uptime}   restarts: ${inspect.restartCount}${exitStr}`,
    `  image: ${inspect.image}   ports: ${portStr}`,
  ];
}
