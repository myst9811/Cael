import { $ } from "bun";
import type { ProcessNode, ProcessTree } from "./types";

export function parsePsTree(output: string): ProcessNode[] {
  const lines = output.trim().split("\n").filter(l => l.trim());
  const dataLines = lines.filter(l => !/^\s*PID\s+PPID/i.test(l));
  return dataLines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5) return [];
    const pid = parseInt(fields[0] ?? "");
    const ppid = parseInt(fields[1] ?? "");
    const cpu_percent = parseFloat(fields[2] ?? "0");
    const rssKb = parseInt(fields[3] ?? "0");
    const name = fields.slice(4).join(" ");
    if (isNaN(pid) || isNaN(ppid)) return [];
    return [{
      pid,
      ppid,
      name,
      cpu_percent: isNaN(cpu_percent) ? 0 : cpu_percent,
      mem_mb: Math.round((rssKb / 1024) * 10) / 10,
      children: [],
    }];
  });
}

export function buildTree(
  nodes: ProcessNode[],
  rootPid?: number,
  maxDepth = 3,
  limit = 50,
): ProcessTree {
  const map = new Map<number, ProcessNode>();
  for (const n of nodes) map.set(n.pid, { ...n, children: [] });

  const roots: ProcessNode[] = [];
  for (const n of map.values()) {
    const parent = map.get(n.ppid);
    if (parent && n.ppid !== n.pid) {
      parent.children.push(n);
    } else {
      roots.push(n);
    }
  }

  function truncate(node: ProcessNode, depth: number): ProcessNode {
    if (depth >= maxDepth) return { ...node, children: [] };
    return { ...node, children: node.children.map(c => truncate(c, depth + 1)) };
  }

  if (rootPid !== undefined) {
    const root = map.get(rootPid);
    if (!root) return { roots: [] };
    return { roots: [truncate(root, 0)] };
  }

  return {
    roots: roots
      .sort((a, b) => b.cpu_percent - a.cpu_percent)
      .slice(0, limit)
      .map(r => truncate(r, 0)),
  };
}

export async function getProcessTree(rootPid?: number, maxDepth = 3, limit = 50): Promise<ProcessTree> {
  const out = await $`ps -eo pid,ppid,pcpu,rss,comm`.quiet().text();
  return buildTree(parsePsTree(out), rootPid, maxDepth, limit);
}
