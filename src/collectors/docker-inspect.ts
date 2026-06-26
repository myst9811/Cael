import { $ } from "bun";
import type { ContainerInspect } from "./types";

interface DockerInspectRaw {
  Name?: string;
  RestartCount?: number;
  State?: {
    Status?: string;
    ExitCode?: number;
    StartedAt?: string;
    FinishedAt?: string;
  };
  Config?: { Image?: string };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
}

export function parseDockerInspect(raw: unknown): ContainerInspect {
  const c = raw as DockerInspectRaw;
  if (!c || typeof c !== "object") throw new Error("docker inspect returned unexpected shape");

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
  // docker inspect --format '{{json .}}' returns a single JSON object per container
  const out = await $`docker inspect --format ${"{{json .}}"} ${name}`.quiet().text();
  return parseDockerInspect(JSON.parse(out.trim()));
}
