import { $ } from "bun";
import type { DockerContainer, DockerStatus, DockerLogsResult } from "./types";

export function parseDockerPs(output: string): DockerContainer[] {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [name = "", state = "", status = "", image = "", ports = ""] = line.split("\t");
      const container: DockerContainer = {
        name: name.trim(),
        status: normalizeState(state.trim()),
        image: image.trim(),
        ports: ports.trim() ? ports.trim().split(",").map(p => p.trim()).filter(Boolean) : [],
      };

      if (container.status === "exited") {
        const exitMatch = status.match(/Exited \((\d+)\)/);
        if (exitMatch) container.exit_code = parseInt(exitMatch[1]);
      }

      if (status.includes("Up")) {
        container.uptime = status.trim();
      }

      return container;
    });
}

function normalizeState(state: string): DockerContainer["status"] {
  switch (state.toLowerCase()) {
    case "running": return "running";
    case "paused": return "paused";
    case "restarting": return "restarting";
    default: return "exited";
  }
}

export async function getDockerStatus(): Promise<DockerStatus> {
  const info = await $`docker info`.quiet().nothrow();
  if (info.exitCode !== 0) {
    const stderr = info.stderr.toString();
    const error = stderr.includes("permission denied")
      ? "Docker is installed but you don't have permission to access the socket. Try: sudo usermod -aG docker $USER"
      : "Docker daemon not running";
    return { available: false, error, containers: [] };
  }

  const psOut = await $`docker ps -a --format "{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"`.quiet().text();
  return { available: true, containers: parseDockerPs(psOut) };
}

export async function getDockerLogs(container: string, lines = 100, since?: string): Promise<DockerLogsResult> {
  const MAX_BYTES = 10 * 1024;
  const args = since
    ? $`docker logs ${container} --tail ${String(lines)} --since ${since}`
    : $`docker logs ${container} --tail ${String(lines)}`;

  const raw = await args.quiet().text();
  const buf = Buffer.from(raw, "utf8");
  const truncated = buf.byteLength > MAX_BYTES;
  const logs = truncated ? buf.slice(0, MAX_BYTES).toString("utf8") + "\n[truncated]" : raw;

  return { logs, truncated };
}
