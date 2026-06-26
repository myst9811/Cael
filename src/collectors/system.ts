import { $ } from "bun";
import { loadavg } from "os";
import type { SystemMetrics } from "./types";

export function parseMacOSMemory(vmstatOutput: string): { used_gb: number; total_gb: number; percent: number } {
  if (!vmstatOutput.trim()) return { used_gb: 0, total_gb: 0, percent: 0 };

  const pageSizeMatch = vmstatOutput.match(/page size of (\d+) bytes/);
  const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1] ?? "4096") : 4096;

  const extract = (label: string): number => {
    const match = vmstatOutput.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
    return match ? parseInt(match[1] ?? "0") : 0;
  };

  const free = extract("Pages free");
  const active = extract("Pages active");
  const inactive = extract("Pages inactive");
  const speculative = extract("Pages speculative");
  const wired = extract("Pages wired down");
  const compressor = extract("Pages occupied by compressor");

  const totalPages = free + active + inactive + speculative + wired + compressor;
  if (totalPages === 0) return { used_gb: 0, total_gb: 0, percent: 0 };

  const usedPages = totalPages - free;
  const GB = 1024 ** 3;
  const total_gb = (totalPages * pageSize) / GB;
  const used_gb = (usedPages * pageSize) / GB;
  const percent = (usedPages / totalPages) * 100;

  return { used_gb, total_gb, percent };
}

export function parseLinuxMemory(meminfoOutput: string): { used_gb: number; total_gb: number; percent: number } {
  const extract = (key: string): number => {
    const match = meminfoOutput.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"));
    return match ? parseInt(match[1] ?? "0") : 0;
  };

  const totalKb = extract("MemTotal");
  const availableKb = extract("MemAvailable");
  if (totalKb === 0) return { used_gb: 0, total_gb: 0, percent: 0 };

  const usedKb = totalKb - availableKb;
  const GB = 1024 ** 3;
  const total_gb = (totalKb * 1024) / GB;
  const used_gb = (usedKb * 1024) / GB;
  const percent = (usedKb / totalKb) * 100;

  return { used_gb, total_gb, percent };
}

export function parseMacOSCpu(topOutput: string): number {
  const matches = [...topOutput.matchAll(/CPU usage:\s+([\d.]+)%\s+user,\s+([\d.]+)%\s+sys,\s+([\d.]+)%\s+idle/g)];
  if (matches.length === 0) return 0;
  const last = matches[matches.length - 1]!;
  const idle = parseFloat(last[3] ?? "0");
  return Math.round((100 - idle) * 10) / 10;
}

export function parseLinuxCpu(stat1: string, stat2: string): number {
  const parse = (s: string): { idle: number; total: number } => {
    const match = s.match(/^cpu\s+([\d ]+)/m);
    if (!match) return { idle: 0, total: 0 };
    const fields = (match[1] ?? "").trim().split(/\s+/).map(Number);
    const total = fields.reduce((a, b) => a + b, 0);
    const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
    return { idle, total };
  };

  const s1 = parse(stat1);
  const s2 = parse(stat2);
  const deltaTotal = s2.total - s1.total;
  const deltaIdle = s2.idle - s1.idle;
  if (deltaTotal === 0) return 0;
  return Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 1000) / 10;
}

export function parseDisk(dfOutput: string): { used_gb: number; total_gb: number; percent: number } {
  const lines = dfOutput.trim().split("\n").filter(l => l.trim());
  const dataLine = lines.find(l => !l.trim().startsWith("Filesystem"));
  if (!dataLine) return { used_gb: 0, total_gb: 0, percent: 0 };

  const fields = dataLine.trim().split(/\s+/);
  const totalKb = parseInt(fields[1] ?? "0") || 0;
  const usedKb = parseInt(fields[2] ?? "0") || 0;
  const percentStr = fields[4] ?? "0%";
  const percent = parseInt(percentStr) || 0;
  const GB = 1024 * 1024;

  return { total_gb: totalKb / GB, used_gb: usedKb / GB, percent };
}

export function parseDiskInodes(dfOutput: string, platform: string): number | undefined {
  const lines = dfOutput.trim().split("\n").filter(l => l.trim());
  const dataLine = lines.find(l => !l.trim().startsWith("Filesystem"));
  if (!dataLine) return undefined;
  const fields = dataLine.trim().split(/\s+/);
  if (platform === "darwin") {
    // macOS df -k: Filesystem 1K-blocks Used Avail Capacity iused ifree %iused Mounted
    const pct = fields[7];
    if (!pct) return undefined;
    const val = parseInt(pct);
    return isNaN(val) ? undefined : val;
  } else {
    // Linux df -i: Filesystem Inodes IUsed IFree IUse% Mounted
    const pct = fields[4];
    if (!pct) return undefined;
    const val = parseInt(pct);
    return isNaN(val) ? undefined : val;
  }
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const platform = process.platform;
  const diskPromise = $`df -k .`.quiet().text();

  let cpu_percent: number;
  let mem_used_gb: number;
  let mem_total_gb: number;
  let mem_percent: number;

  if (platform === "darwin") {
    const [topOut, vmstatOut] = await Promise.all([
      $`top -l 2 -n 0`.quiet().text(),
      $`vm_stat`.quiet().text(),
    ]);
    cpu_percent = parseMacOSCpu(topOut);
    const mem = parseMacOSMemory(vmstatOut);
    mem_used_gb = mem.used_gb;
    mem_total_gb = mem.total_gb;
    mem_percent = mem.percent;
  } else {
    const stat1 = await $`cat /proc/stat`.quiet().text();
    await new Promise(r => setTimeout(r, 500));
    const [stat2, meminfoOut] = await Promise.all([
      $`cat /proc/stat`.quiet().text(),
      $`cat /proc/meminfo`.quiet().text(),
    ]);
    cpu_percent = parseLinuxCpu(stat1, stat2);
    const mem = parseLinuxMemory(meminfoOut);
    mem_used_gb = mem.used_gb;
    mem_total_gb = mem.total_gb;
    mem_percent = mem.percent;
  }

  const diskOut = await diskPromise;
  const disk = parseDisk(diskOut);
  const la = loadavg();

  // Inodes: macOS inode % is already in df -k output; Linux needs a separate df -i call
  let disk_inode_percent: number | undefined;
  if (platform === "darwin") {
    disk_inode_percent = parseDiskInodes(diskOut, platform);
  } else {
    try {
      const dfInodeOut = await $`df -i .`.quiet().nothrow().text();
      disk_inode_percent = parseDiskInodes(dfInodeOut, platform);
    } catch { /* non-fatal */ }
  }

  return {
    cpu_percent,
    mem_used_gb,
    mem_total_gb,
    mem_percent,
    disk_used_gb: disk.used_gb,
    disk_total_gb: disk.total_gb,
    disk_percent: disk.percent,
    disk_inode_percent,
    load_avg: [la[0] ?? 0, la[1] ?? 0, la[2] ?? 0],
  };
}
