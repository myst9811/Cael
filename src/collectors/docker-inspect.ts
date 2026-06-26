import { $ } from "bun";
import type { ContainerInspect } from "./types";

export function parseDockerInspect(data: any[]): ContainerInspect {
  const c = data[0];
  if (!c) throw new Error("docker inspect returned empty array");

  const rawPorts: Record<string, Array<{ HostIp: string; HostPort: string }> | null> =
    c.NetworkSettings?.Ports ?? {};
  const ports: string[] = [];
  for (const [proto, bindings] of Object.entries(rawPorts)) {
    if (!bindings) continue;
    for (const b of bindings) {
      ports.push(`${b.HostIp}:${b.HostPort}->${proto}`);
    }
  }

  return {
    name: (c.Name ?? "").replace(/^\//, ""),
    status: c.State?.Status ?? "unknown",
    startedAt: c.State?.StartedAt ?? "",
    finishedAt: c.State?.FinishedAt ?? "",
    restartCount: c.RestartCount ?? 0,
    exitCode: c.State?.ExitCode ?? 0,
    image: c.Config?.Image ?? "",
    ports,
  };
}

export async function getDockerInspect(name: string): Promise<ContainerInspect> {
  const out = await $`docker inspect ${name}`.quiet().text();
  return parseDockerInspect(JSON.parse(out) as any[]);
}
