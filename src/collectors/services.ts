import { $ } from "bun";
import type { RuntimeServices, ServiceEntry } from "./types";

export function parseLaunchctlList(output: string): ServiceEntry[] {
  const lines = output.trim().split("\n").filter(l => l.trim() && !l.startsWith("PID"));
  return lines.flatMap(line => {
    const fields = line.trim().split(/\t|\s{2,}/);
    if (fields.length < 3) return [];
    const pidField = fields[0]?.trim() ?? "-";
    const label = fields[2]?.trim() ?? "";
    if (!label) return [];
    const status: ServiceEntry["status"] = (pidField !== "-" && !isNaN(parseInt(pidField))) ? "running" : "stopped";
    return [{ name: label, source: "launchctl" as const, status }];
  });
}

export function parseSystemctlList(output: string): ServiceEntry[] {
  const lines = output.trim().split("\n").filter(l => {
    const t = l.trim();
    return t && !t.startsWith("UNIT") && !t.includes("loaded units") && t.length > 1;
  });
  return lines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    const unit = fields[0] ?? "";
    if (!unit.endsWith(".service")) return [];
    // fields[2] = ACTIVE (active/inactive/failed), fields[3] = SUB (running/dead/failed/...)
    const active = fields[2] ?? "";
    const sub = fields[3] ?? "";
    const status: ServiceEntry["status"] =
      active === "active" && sub === "running" ? "running" :
      active === "active" ? "running" :
      active === "inactive" || sub === "dead" ? "stopped" : "unknown";
    const description = fields.slice(4).join(" ");
    return [{ name: unit, source: "systemd" as const, status, description: description || undefined }];
  });
}

export function parseDockerComposePsJson(output: string): ServiceEntry[] {
  const lines = output.trim().split("\n").filter(Boolean);
  return lines.flatMap(line => {
    try {
      const obj = JSON.parse(line) as { Name?: string; Service?: string; State?: string; Status?: string };
      const name = obj.Service ?? obj.Name ?? "";
      if (!name) return [];
      const state = (obj.State ?? obj.Status ?? "").toLowerCase();
      const status: ServiceEntry["status"] = state.includes("running") ? "running" : state.includes("exit") ? "stopped" : "unknown";
      return [{ name, source: "docker-compose" as const, status }];
    } catch { return []; }
  });
}

export async function getRuntimeServices(
  source: "systemd" | "launchctl" | "docker-compose" | "all" = "all",
): Promise<RuntimeServices> {
  const services: ServiceEntry[] = [];
  const unavailable_sources: string[] = [];
  const platform = process.platform;

  async function run(label: "systemd" | "launchctl" | "docker-compose", fn: () => Promise<ServiceEntry[]>) {
    if (source !== "all" && source !== label) return;
    try {
      services.push(...(await fn()));
    } catch {
      unavailable_sources.push(label);
    }
  }

  await Promise.all([
    run("launchctl", async () => {
      if (platform !== "darwin") return [];
      const out = await $`launchctl list`.quiet().text();
      return parseLaunchctlList(out);
    }),
    run("systemd", async () => {
      if (platform === "darwin") return [];
      const out = await $`systemctl list-units --type=service --state=running --no-pager --plain`.quiet().text();
      return parseSystemctlList(out);
    }),
    run("docker-compose", async () => {
      const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];
      const found = await Promise.any(
        composeFiles.map(async f => { if (await Bun.file(f).exists()) return f; throw new Error(); }),
      ).catch(() => null);
      if (!found) return [];
      const out = await $`docker compose ps --format json`.quiet().nothrow().text();
      return parseDockerComposePsJson(out);
    }),
  ]);

  return { services, unavailable_sources };
}
