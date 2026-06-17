import { $ } from "bun";
import type { ProcessEntry, ProcessList } from "./types";

export function parsePsOutput(output: string): ProcessEntry[] {
  const lines = output.trim().split("\n");
  return lines
    .slice(1)
    .filter(Boolean)
    .flatMap(line => {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 11) return [];

      const pid = parseInt(fields[1] ?? "");
      if (isNaN(pid)) return [];

      const user = fields[0] ?? "";
      const cpuRaw = parseFloat(fields[2] ?? "0");
      const cpu_percent = isNaN(cpuRaw) ? 0 : cpuRaw;
      const rssRaw = parseInt(fields[5] ?? "0");
      const rss_kb = isNaN(rssRaw) ? 0 : rssRaw;
      const mem_mb = Math.round((rss_kb / 1024) * 10) / 10;
      const command = fields.slice(10).join(" ");
      const name = (command.split(" ")[0] ?? command).split("/").pop() ?? command;

      return [{ pid, user, cpu_percent, mem_mb, name, command }];
    });
}

export async function getProcessList(sortBy: "cpu" | "mem" = "cpu", limit = 15): Promise<ProcessList> {
  const platform = process.platform;
  const raw = platform === "darwin"
    ? await $`ps aux -r`.quiet().text()
    : await $`ps aux --sort=-%cpu`.quiet().text();

  let processes = parsePsOutput(raw);

  if (sortBy === "mem") {
    processes = processes.sort((a, b) => b.mem_mb - a.mem_mb);
  }

  return { processes: processes.slice(0, limit) };
}
