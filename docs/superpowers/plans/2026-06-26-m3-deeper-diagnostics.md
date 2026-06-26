# M3: Deeper Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four reactive LLM tools (listening ports, process tree, runtime services, docker log patterns) and fold disk inode data into the existing system metrics snapshot.

**Architecture:** All new collectors follow the existing pattern in `src/collectors/` — parse functions that take raw string output, plus an `async get*()` function that runs the system commands. Tools are registered in `src/tools.ts`'s `collectorTools` array and dispatched through the existing `executeTool()` switch. Built on top of M1 (main at `9b1010b`); `draw.ts` uses the pre-M2 single `alerts[]` array style.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.$` for shell commands, fixture-based tests, `redactSecrets` from `src/redact.ts` (already imported in `tools.ts` from M1).

---

## File Map

| Action  | Path | Responsibility |
|---------|------|----------------|
| Modify  | `src/collectors/types.ts` | Add 8 new interfaces + `disk_inode_percent` to `SystemMetrics` |
| Modify  | `src/collectors/system.ts` | Add `parseDiskInodes()`, extend `getSystemMetrics()` |
| Modify  | `src/collectors/system.test.ts` | Inode parsing tests |
| Create  | `src/collectors/__fixtures__/macos-df-inodes.txt` | macOS `df -k` output with inode column |
| Create  | `src/collectors/__fixtures__/linux-df-inodes.txt` | Linux `df -i` output |
| Create  | `src/collectors/network.ts` | `parseLsofOutput`, `parseSsOutput`, `getListeningPorts` |
| Create  | `src/collectors/network.test.ts` | Four fixture-based tests |
| Create  | `src/collectors/__fixtures__/lsof-tcp.txt` | macOS `lsof` TCP fixture |
| Create  | `src/collectors/__fixtures__/lsof-udp.txt` | macOS `lsof` UDP fixture |
| Create  | `src/collectors/__fixtures__/ss-tcp.txt` | Linux `ss` TCP fixture |
| Create  | `src/collectors/__fixtures__/ss-udp.txt` | Linux `ss` UDP fixture |
| Create  | `src/collectors/process-tree.ts` | `parsePsTree`, `buildTree`, `getProcessTree` |
| Create  | `src/collectors/process-tree.test.ts` | Tree building, depth limit, subtree lookup |
| Create  | `src/collectors/__fixtures__/ps-tree.txt` | `ps -eo pid,ppid,pcpu,rss,comm` output |
| Create  | `src/collectors/services.ts` | `parseLaunchctlList`, `parseSystemctlList`, `parseDockerComposePsJson`, `getRuntimeServices` |
| Create  | `src/collectors/services.test.ts` | Per-source parsing + unavailable_sources |
| Create  | `src/collectors/log-patterns.ts` | `analyzeLogLines`, `getDockerLogPatterns` |
| Create  | `src/collectors/log-patterns.test.ts` | Pattern frequency, truncation, level counts |
| Modify  | `src/tools.ts` | Register 4 new tools, 4 new `executeTool` cases with redaction |
| Modify  | `src/tui/draw.ts` | Inode alert in `generateAlerts()` |
| Modify  | `src/tui/draw.test.ts` | Inode alert test |
| Modify  | `src/commands/ask.ts` | Update `SYSTEM_PROMPT` |
| Modify  | `src/commands/watch.ts` | Update `formatSystemPrompt()` |

---

## Task 1: Types

**Files:**
- Modify: `src/collectors/types.ts`

- [ ] **Step 1: Add `disk_inode_percent` to `SystemMetrics` and 8 new interfaces**

Open `src/collectors/types.ts`. Add `disk_inode_percent?: number;` to `SystemMetrics` after `disk_percent`, then append all new interfaces at the end of the file:

```ts
// In SystemMetrics, add after disk_percent:
  disk_inode_percent?: number;

// Append at end of file:
export interface PortEntry {
  port: number;
  protocol: "tcp" | "udp";
  address: string;
  pid?: number;
  process_name?: string;
}

export interface NetworkPorts {
  ports: PortEntry[];
}

export interface ProcessNode {
  pid: number;
  ppid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
  children: ProcessNode[];
}

export interface ProcessTree {
  roots: ProcessNode[];
}

export interface ServiceEntry {
  name: string;
  source: "systemd" | "launchctl" | "docker-compose";
  status: "running" | "stopped" | "unknown";
  description?: string;
}

export interface RuntimeServices {
  services: ServiceEntry[];
  unavailable_sources: string[];
}

export interface LogPattern {
  pattern: string;
  count: number;
  first_seen?: string;
  last_seen?: string;
  level?: "error" | "warn" | "info" | "unknown";
}

export interface DockerLogPatterns {
  container: string;
  total_lines: number;
  lines_analyzed: number;
  truncated: boolean;
  error_count: number;
  warn_count: number;
  patterns: LogPattern[];
}
```

- [ ] **Step 2: Verify no compile errors**

```bash
bun test 2>&1 | tail -4
```

Expected: same pass count, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add src/collectors/types.ts
git commit -m "feat(types): add M3 diagnostic types and disk_inode_percent to SystemMetrics"
```

---

## Task 2: Disk inode metrics

**Files:**
- Create: `src/collectors/__fixtures__/macos-df-inodes.txt`
- Create: `src/collectors/__fixtures__/linux-df-inodes.txt`
- Modify: `src/collectors/system.ts`
- Modify: `src/collectors/system.test.ts`

- [ ] **Step 1: Create fixtures**

Write `src/collectors/__fixtures__/macos-df-inodes.txt` (macOS `df -k` already includes inode columns):

```
Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on
/dev/disk3s5   482797652 190240284 251174820    44% 2475655 2511748200   72%   /
```

Write `src/collectors/__fixtures__/linux-df-inodes.txt` (Linux `df -i` output):

```
Filesystem      Inodes  IUsed   IFree IUse% Mounted on
/dev/sda1      2621440  56789 2564651    3% /
```

- [ ] **Step 2: Write failing tests — append to `src/collectors/system.test.ts`**

```ts
import { parseDiskInodes } from "./system";

test("parseDiskInodes: macOS extracts %iused from df -k output", () => {
  const out = fixture("macos-df-inodes.txt");
  expect(parseDiskInodes(out, "darwin")).toBe(72);
});

test("parseDiskInodes: Linux extracts IUse% from df -i output", () => {
  const out = fixture("linux-df-inodes.txt");
  expect(parseDiskInodes(out, "linux")).toBe(3);
});

test("parseDiskInodes: returns undefined for empty input", () => {
  expect(parseDiskInodes("", "darwin")).toBeUndefined();
});

test("parseDiskInodes: returns undefined when header-only", () => {
  const headerOnly = "Filesystem   1024-blocks      Used Available Capacity iused ifree %iused Mounted on\n";
  expect(parseDiskInodes(headerOnly, "darwin")).toBeUndefined();
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test src/collectors/system.test.ts 2>&1 | tail -5
```

Expected: 4 new failures.

- [ ] **Step 4: Add `parseDiskInodes` to `src/collectors/system.ts` and extend `getSystemMetrics`**

After `parseDisk`, add:

```ts
export function parseDiskInodes(dfOutput: string, platform: string): number | undefined {
  const lines = dfOutput.trim().split("\n").filter(l => l.trim());
  const dataLine = lines.find(l => !l.trim().startsWith("Filesystem"));
  if (!dataLine) return undefined;
  const fields = dataLine.trim().split(/\s+/);

  if (platform === "darwin") {
    // macOS df -k: Filesystem 1K-blocks Used Avail Capacity iused ifree %iused Mounted
    // %iused is at index 7
    const pct = fields[7];
    if (!pct) return undefined;
    const val = parseInt(pct);
    return isNaN(val) ? undefined : val;
  } else {
    // Linux df -i: Filesystem Inodes IUsed IFree IUse% Mounted
    // IUse% is at index 4
    const pct = fields[4];
    if (!pct) return undefined;
    const val = parseInt(pct);
    return isNaN(val) ? undefined : val;
  }
}
```

In `getSystemMetrics`, add the inode call. On macOS, parse inodes from the existing `df -k` result. On Linux, run `df -i .` in parallel:

```ts
// In the macOS branch, after const diskOut = await diskPromise:
// Already have diskOut — parse inodes from it
const disk = parseDisk(diskOut);
const disk_inode_percent = parseDiskInodes(diskOut, platform);

// In the Linux branch, add df -i to the parallel calls:
const [stat2, meminfoOut, dfInodeOut] = await Promise.all([
  $`cat /proc/stat`.quiet().text(),
  $`cat /proc/meminfo`.quiet().text(),
  $`df -i .`.quiet().nothrow().text(),
]);
// Then:
const disk_inode_percent = parseDiskInodes(dfInodeOut, platform);

// Add disk_inode_percent to the return object:
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
```

- [ ] **Step 5: Run tests**

```bash
bun test src/collectors/system.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/collectors/system.ts src/collectors/system.test.ts src/collectors/__fixtures__/macos-df-inodes.txt src/collectors/__fixtures__/linux-df-inodes.txt
git commit -m "feat: add disk inode percent to system metrics"
```

---

## Task 3: Network collector

**Files:**
- Create: `src/collectors/__fixtures__/lsof-tcp.txt`
- Create: `src/collectors/__fixtures__/lsof-udp.txt`
- Create: `src/collectors/__fixtures__/ss-tcp.txt`
- Create: `src/collectors/__fixtures__/ss-udp.txt`
- Create: `src/collectors/network.ts`
- Create: `src/collectors/network.test.ts`

- [ ] **Step 1: Create fixtures**

Write `src/collectors/__fixtures__/lsof-tcp.txt`:
```
COMMAND   PID    USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node     1234  shannen   22u  IPv4 0x1234      0t0  TCP *:3000 (LISTEN)
postgres 5678  shannen   10u  IPv6 0x5678      0t0  TCP *:5432 (LISTEN)
nginx     999  www-data   6u  IPv4 0x9999      0t0  TCP 127.0.0.1:8080 (LISTEN)
```

Write `src/collectors/__fixtures__/lsof-udp.txt`:
```
COMMAND     PID    USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
mDNSRespo   789  shannen    8u  IPv4 0x9999      0t0  UDP *:5353
syslogd     101  _syslog    5u  IPv4 0xabcd      0t0  UDP 127.0.0.1:514
```

Write `src/collectors/__fixtures__/ss-tcp.txt`:
```
Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
tcp   LISTEN 0      128          0.0.0.0:22        0.0.0.0:* users:(("sshd",pid=1001,fd=3))
tcp   LISTEN 0      128          0.0.0.0:5432      0.0.0.0:* users:(("postgres",pid=5678,fd=5))
tcp   LISTEN 0      128             [::]:80            [::]:*
```

Write `src/collectors/__fixtures__/ss-udp.txt`:
```
Netid  State   Recv-Q Send-Q Local Address:Port Peer Address:Port Process
udp    UNCONN  0      0         127.0.0.1:514         0.0.0.0:* users:(("syslogd",pid=202,fd=3))
udp    UNCONN  0      0                 *:5353              *:*
```

- [ ] **Step 2: Write failing tests**

Create `src/collectors/network.test.ts`:

```ts
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLsofOutput, parseSsOutput } from "./network";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parseLsofOutput TCP: extracts port and process name", () => {
  const result = parseLsofOutput(fixture("lsof-tcp.txt"), "tcp");
  expect(result.length).toBe(3);
  const node = result.find(p => p.port === 3000)!;
  expect(node.protocol).toBe("tcp");
  expect(node.process_name).toBe("node");
  expect(node.pid).toBe(1234);
  expect(node.address).toBe("0.0.0.0");
});

test("parseLsofOutput TCP: IPv6 wildcard maps to correct address", () => {
  const result = parseLsofOutput(fixture("lsof-tcp.txt"), "tcp");
  const pg = result.find(p => p.port === 5432)!;
  expect(pg.pid).toBe(5678);
});

test("parseLsofOutput UDP: extracts UDP entries with correct protocol", () => {
  const result = parseLsofOutput(fixture("lsof-udp.txt"), "udp");
  expect(result.length).toBe(2);
  for (const e of result) {
    expect(e.protocol).toBe("udp");
  }
  expect(result.find(p => p.port === 5353)?.address).toBe("0.0.0.0");
});

test("parseSsOutput: extracts TCP entries", () => {
  const result = parseSsOutput(fixture("ss-tcp.txt"));
  const tcp = result.filter(p => p.protocol === "tcp");
  expect(tcp.length).toBeGreaterThanOrEqual(2);
  const ssh = tcp.find(p => p.port === 22)!;
  expect(ssh.process_name).toBe("sshd");
  expect(ssh.pid).toBe(1001);
});

test("parseSsOutput: extracts UDP entries", () => {
  const result = parseSsOutput(fixture("ss-udp.txt"));
  const udp = result.filter(p => p.protocol === "udp");
  expect(udp.length).toBeGreaterThanOrEqual(1);
  const syslog = udp.find(p => p.port === 514)!;
  expect(syslog.process_name).toBe("syslogd");
});

test("parseSsOutput: line without process info produces undefined pid", () => {
  const result = parseSsOutput(fixture("ss-tcp.txt"));
  const noProc = result.find(p => p.port === 80);
  expect(noProc?.pid).toBeUndefined();
  expect(noProc?.process_name).toBeUndefined();
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test src/collectors/network.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './network'`

- [ ] **Step 4: Implement `src/collectors/network.ts`**

```ts
import { $ } from "bun";
import type { NetworkPorts, PortEntry } from "./types";

export function parseLsofOutput(output: string, protocol: "tcp" | "udp"): PortEntry[] {
  const lines = output.trim().split("\n").filter(l => l.trim() && !l.trim().startsWith("COMMAND"));
  return lines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 9) return [];
    const pid = parseInt(fields[1] ?? "");
    const process_name = fields[0];
    // NAME field is at index 8; strip trailing "(LISTEN)" token if present
    const nameRaw = fields[8] ?? "";
    const lastColon = nameRaw.lastIndexOf(":");
    if (lastColon === -1) return [];
    const rawAddr = nameRaw.slice(0, lastColon);
    const port = parseInt(nameRaw.slice(lastColon + 1));
    if (isNaN(port)) return [];
    const address = rawAddr === "*" ? "0.0.0.0" : rawAddr.replace(/^\[/, "").replace(/\]$/, "");
    return [{
      port,
      protocol,
      address,
      pid: !isNaN(pid) ? pid : undefined,
      process_name: process_name || undefined,
    }];
  });
}

export function parseSsOutput(output: string): PortEntry[] {
  const lines = output.trim().split("\n").filter(l => l.trim() && !l.startsWith("Netid"));
  return lines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    const netid = fields[0]?.toLowerCase();
    if (netid !== "tcp" && netid !== "udp") return [];
    const protocol = netid as "tcp" | "udp";

    const localAddr = fields[4] ?? "";
    const lastColon = localAddr.lastIndexOf(":");
    if (lastColon === -1) return [];
    const rawAddr = localAddr.slice(0, lastColon);
    const port = parseInt(localAddr.slice(lastColon + 1));
    if (isNaN(port)) return [];
    const address = rawAddr === "*" ? "0.0.0.0" : rawAddr.replace(/^\[/, "").replace(/\]$/, "");

    // Process info: users:(("sshd",pid=1001,fd=3))
    const processField = fields.slice(6).join(" ");
    const pidMatch = processField.match(/pid=(\d+)/);
    const nameMatch = processField.match(/"([^"]+)"/);
    const pid = pidMatch ? parseInt(pidMatch[1] ?? "") : undefined;
    const process_name = nameMatch ? nameMatch[1] : undefined;

    return [{ port, protocol, address, pid: pid && !isNaN(pid) ? pid : undefined, process_name }];
  });
}

export async function getListeningPorts(): Promise<NetworkPorts> {
  if (process.platform === "darwin") {
    const [tcpRes, udpRes] = await Promise.allSettled([
      $`lsof -i TCP -P -n -sTCP:LISTEN`.quiet().text(),
      $`lsof -i UDP -P -n`.quiet().text(),
    ]);
    const tcp = tcpRes.status === "fulfilled" ? parseLsofOutput(tcpRes.value, "tcp") : [];
    const udp = udpRes.status === "fulfilled" ? parseLsofOutput(udpRes.value, "udp") : [];
    return { ports: [...tcp, ...udp] };
  } else {
    const out = await $`ss -tulnp`.quiet().text();
    return { ports: parseSsOutput(out) };
  }
}
```

- [ ] **Step 5: Run tests**

```bash
bun test src/collectors/network.test.ts 2>&1 | tail -5
```

Expected: 6 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/network.ts src/collectors/network.test.ts src/collectors/__fixtures__/lsof-tcp.txt src/collectors/__fixtures__/lsof-udp.txt src/collectors/__fixtures__/ss-tcp.txt src/collectors/__fixtures__/ss-udp.txt
git commit -m "feat: add listening ports collector (TCP+UDP, macOS+Linux)"
```

---

## Task 4: Process tree collector

**Files:**
- Create: `src/collectors/__fixtures__/ps-tree.txt`
- Create: `src/collectors/process-tree.ts`
- Create: `src/collectors/process-tree.test.ts`

- [ ] **Step 1: Create fixture**

Write `src/collectors/__fixtures__/ps-tree.txt` (output of `ps -eo pid,ppid,pcpu,rss,comm`):

```
  PID  PPID %CPU   RSS COMM
    1     0  0.0  4096 init
 1001     1  0.5 51200 sshd
 1002     1  2.3 102400 postgres
 1003  1002  1.1  20480 postgres
 1004  1002  0.9  18432 postgres
 1005     1  0.0  8192 cron
 1006  1001  0.1  10240 bash
```

- [ ] **Step 2: Write failing tests**

Create `src/collectors/process-tree.test.ts`:

```ts
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parsePsTree, buildTree } from "./process-tree";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parsePsTree: parses all data rows skipping header", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  expect(nodes.length).toBe(7);
});

test("parsePsTree: extracts pid, ppid, cpu, mem, name", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const postgres = nodes.find(n => n.pid === 1002)!;
  expect(postgres.ppid).toBe(1);
  expect(postgres.cpu_percent).toBeCloseTo(2.3);
  expect(postgres.mem_mb).toBeCloseTo(100, 0);
  expect(postgres.name).toBe("postgres");
});

test("buildTree: roots are processes whose parent is not in the set", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes);
  // pid=1 (init) is a root; its ppid=0 which is not in the map
  expect(tree.roots.some(r => r.pid === 1)).toBe(true);
});

test("buildTree: children are attached to their parents", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes);
  const init = tree.roots.find(r => r.pid === 1)!;
  const childPids = init.children.map(c => c.pid);
  expect(childPids).toContain(1001);
  expect(childPids).toContain(1002);
});

test("buildTree with rootPid: returns only subtree", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes, 1002);
  expect(tree.roots.length).toBe(1);
  expect(tree.roots[0]!.pid).toBe(1002);
  expect(tree.roots[0]!.children.length).toBe(2);
});

test("buildTree with unknown rootPid: returns empty roots", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  expect(buildTree(nodes, 99999).roots).toHaveLength(0);
});

test("buildTree: default limit=50 is respected on large input", () => {
  // Build 60 root processes (ppid=0) to test the limit
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    pid: i + 1, ppid: 0, name: `proc${i}`, cpu_percent: i * 0.1, mem_mb: 10, children: [],
  }));
  const tree = buildTree(nodes, undefined, 3, 50);
  expect(tree.roots.length).toBeLessThanOrEqual(50);
});

test("buildTree: maxDepth is respected", () => {
  const nodes = parsePsTree(fixture("ps-tree.txt"));
  const tree = buildTree(nodes, 1, 1); // depth 1 = only direct children
  const init = tree.roots.find(r => r.pid === 1)!;
  // bash (pid=1006) is a child of sshd (1001) which is child of init
  // At depth 1, sshd's children should be empty
  const sshd = init.children.find(c => c.pid === 1001)!;
  expect(sshd.children).toHaveLength(0);
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test src/collectors/process-tree.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './process-tree'`

- [ ] **Step 4: Implement `src/collectors/process-tree.ts`**

```ts
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
```

- [ ] **Step 5: Run tests**

```bash
bun test src/collectors/process-tree.test.ts 2>&1 | tail -5
```

Expected: 8 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/process-tree.ts src/collectors/process-tree.test.ts src/collectors/__fixtures__/ps-tree.txt
git commit -m "feat: add process tree collector with depth and limit controls"
```

---

## Task 5: Runtime services collector

**Files:**
- Create: `src/collectors/services.ts`
- Create: `src/collectors/services.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/collectors/services.test.ts`:

```ts
import { test, expect } from "bun:test";
import { parseLaunchctlList, parseSystemctlList, parseDockerComposePsJson } from "./services";

const LAUNCHCTL_OUTPUT = `PID\tStatus\tLabel
1234\t0\tcom.apple.Finder
-\t0\tcom.apple.gamed
789\t0\tcom.docker.helper`;

const SYSTEMCTL_OUTPUT = `UNIT                    LOAD   ACTIVE SUB     DESCRIPTION
nginx.service           loaded active running A high performance web server
docker.service          loaded active running Docker Application Container Engine
 `;

const COMPOSE_JSON = `{"Service":"web","State":"running","Status":"Up 2 hours"}
{"Service":"db","State":"running","Status":"Up 2 hours"}
{"Service":"cache","State":"exited","Status":"Exited (1) 5 minutes ago"}`;

test("parseLaunchctlList: running entries have pid (numeric first column)", () => {
  const result = parseLaunchctlList(LAUNCHCTL_OUTPUT);
  const finder = result.find(s => s.name === "com.apple.Finder")!;
  expect(finder.status).toBe("running");
  expect(finder.source).toBe("launchctl");
});

test("parseLaunchctlList: entries with dash pid are stopped", () => {
  const result = parseLaunchctlList(LAUNCHCTL_OUTPUT);
  const gamed = result.find(s => s.name === "com.apple.gamed")!;
  expect(gamed.status).toBe("stopped");
});

test("parseSystemctlList: extracts service name and description", () => {
  const result = parseSystemctlList(SYSTEMCTL_OUTPUT);
  expect(result.length).toBe(2);
  const nginx = result.find(s => s.name === "nginx.service")!;
  expect(nginx.status).toBe("running");
  expect(nginx.source).toBe("systemd");
  expect(nginx.description).toContain("web server");
});

test("parseDockerComposePsJson: parses JSON lines into ServiceEntry array", () => {
  const result = parseDockerComposePsJson(COMPOSE_JSON);
  expect(result.length).toBe(3);
  expect(result.find(s => s.name === "web")?.status).toBe("running");
  expect(result.find(s => s.name === "cache")?.status).toBe("stopped");
});

test("parseDockerComposePsJson: handles invalid JSON lines gracefully", () => {
  const bad = `{"Service":"ok","State":"running","Status":"Up"}\nnot json at all`;
  const result = parseDockerComposePsJson(bad);
  expect(result.length).toBe(1);
  expect(result[0]!.name).toBe("ok");
});

test("getRuntimeServices result has unavailable_sources field", async () => {
  const { getRuntimeServices } = await import("./services");
  const result = await getRuntimeServices("all");
  expect(Array.isArray(result.services)).toBe(true);
  expect(Array.isArray(result.unavailable_sources)).toBe(true);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/collectors/services.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './services'`

- [ ] **Step 3: Implement `src/collectors/services.ts`**

```ts
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
  const lines = output.trim().split("\n").filter(l => l.trim() && !l.includes("UNIT") && !l.includes("loaded units") && !l.startsWith(" "));
  return lines.flatMap(line => {
    const fields = line.trim().split(/\s+/);
    const unit = fields[0] ?? "";
    if (!unit.endsWith(".service")) return [];
    const description = fields.slice(4).join(" ");
    return [{ name: unit, source: "systemd" as const, status: "running" as const, description: description || undefined }];
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
```

- [ ] **Step 4: Run tests**

```bash
bun test src/collectors/services.test.ts 2>&1 | tail -5
```

Expected: 6 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/services.ts src/collectors/services.test.ts
git commit -m "feat: add runtime services collector (launchctl, systemd, docker-compose)"
```

---

## Task 6: Docker log patterns collector

**Files:**
- Create: `src/collectors/log-patterns.ts`
- Create: `src/collectors/log-patterns.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/collectors/log-patterns.test.ts`:

```ts
import { test, expect } from "bun:test";
import { analyzeLogLines } from "./log-patterns";

const SAMPLE_LOGS = [
  "2026-06-26T10:00:01Z ERROR [123] Database connection failed",
  "2026-06-26T10:00:02Z ERROR [124] Database connection failed",
  "2026-06-26T10:00:03Z ERROR [125] Database connection failed",
  "2026-06-26T10:00:04Z WARN  [126] Retrying in 5s",
  "2026-06-26T10:00:05Z INFO  [127] Starting worker",
  "2026-06-26T10:00:06Z ERROR [128] Database connection failed",
  "2026-06-26T10:00:07Z INFO  [129] Request processed successfully",
];

test("analyzeLogLines: top pattern is the most frequent message", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  expect(result.patterns[0]!.count).toBe(4);
  expect(result.patterns[0]!.pattern).toContain("Database connection failed");
});

test("analyzeLogLines: error_count counts ERROR lines", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  expect(result.error_count).toBe(4);
});

test("analyzeLogLines: warn_count counts WARN lines", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  expect(result.warn_count).toBe(1);
});

test("analyzeLogLines: lines_analyzed equals actual input size", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  expect(result.lines_analyzed).toBe(7);
});

test("analyzeLogLines: top pattern has first_seen and last_seen timestamps", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  const top = result.patterns[0]!;
  expect(top.first_seen).toBe("2026-06-26T10:00:01");
  expect(top.last_seen).toBe("2026-06-26T10:00:06");
});

test("analyzeLogLines: top pattern level is error", () => {
  const result = analyzeLogLines(SAMPLE_LOGS);
  expect(result.patterns[0]!.level).toBe("error");
});

test("analyzeLogLines: empty input returns zero counts", () => {
  const result = analyzeLogLines([]);
  expect(result.error_count).toBe(0);
  expect(result.warn_count).toBe(0);
  expect(result.patterns).toHaveLength(0);
  expect(result.lines_analyzed).toBe(0);
});

test("analyzeLogLines: returns at most 10 patterns", () => {
  const many = Array.from({ length: 30 }, (_, i) => `2026-06-26T10:00:00Z INFO unique message number ${i}`);
  const result = analyzeLogLines(many);
  expect(result.patterns.length).toBeLessThanOrEqual(10);
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/collectors/log-patterns.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './log-patterns'`

- [ ] **Step 3: Implement `src/collectors/log-patterns.ts`**

```ts
import { getDockerLogs } from "./docker";
import type { DockerLogPatterns, LogPattern } from "./types";

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\s*/;
const PID_RE = /\[\d+\]\s*/g;
const ERROR_RE = /\b(error|fatal|critical)\b/i;
const WARN_RE = /\b(warn(?:ing)?)\b/i;

function extractTimestamp(line: string): string | undefined {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : undefined;
}

function normalizeLine(line: string): string {
  return line.replace(TIMESTAMP_RE, "").replace(PID_RE, "").trim().slice(0, 120);
}

export function analyzeLogLines(
  lines: string[],
): Omit<DockerLogPatterns, "container" | "total_lines" | "truncated"> {
  const buckets = new Map<string, {
    count: number; first_seen?: string; last_seen?: string;
    level: LogPattern["level"]; raw: string;
  }>();
  let error_count = 0;
  let warn_count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const normalized = normalizeLine(line);
    const prefix = normalized.slice(0, 60);
    const ts = extractTimestamp(line);
    const isError = ERROR_RE.test(line);
    const isWarn = !isError && WARN_RE.test(line);
    if (isError) error_count++;
    if (isWarn) warn_count++;
    const level: LogPattern["level"] = isError ? "error" : isWarn ? "warn" : "unknown";

    const existing = buckets.get(prefix);
    if (existing) {
      existing.count++;
      if (ts) existing.last_seen = ts;
      if (level === "error") existing.level = "error";
      else if (level === "warn" && existing.level !== "error") existing.level = "warn";
    } else {
      buckets.set(prefix, { count: 1, first_seen: ts, last_seen: ts, level, raw: normalized });
    }
  }

  const patterns: LogPattern[] = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([, v]) => ({
      pattern: v.raw,
      count: v.count,
      first_seen: v.first_seen,
      last_seen: v.last_seen,
      level: v.level,
    }));

  return { lines_analyzed: lines.length, error_count, warn_count, patterns };
}

export async function getDockerLogPatterns(
  container: string,
  lines = 200,
  since?: string,
): Promise<DockerLogPatterns> {
  const result = await getDockerLogs(container, lines, since);
  const logLines = result.logs.split("\n").filter(l => l.trim());
  const analysis = analyzeLogLines(logLines);
  return {
    container,
    total_lines: logLines.length,
    truncated: result.truncated,
    ...analysis,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/collectors/log-patterns.test.ts 2>&1 | tail -5
```

Expected: 8 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/log-patterns.ts src/collectors/log-patterns.test.ts
git commit -m "feat: add docker log pattern analysis collector"
```

---

## Task 7: Register tools + redaction

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/tools.test.ts`

- [ ] **Step 1: Write failing tests — append to `src/tools.test.ts`**

```ts
test("collectorTools includes the 4 new M3 tools", () => {
  const names = collectorTools.map(t => t.name);
  for (const n of ["get_listening_ports", "get_process_tree", "get_runtime_services", "get_docker_log_patterns"]) {
    expect(names).toContain(n);
  }
});

test("executeToolWithTimeout: get_listening_ports returns JSON string", async () => {
  const result = await executeToolWithTimeout("get_listening_ports", {}, 10_000);
  const parsed = JSON.parse(result) as { ports: unknown[] };
  expect(Array.isArray(parsed.ports)).toBe(true);
}, 15_000);

test("executeToolWithTimeout: get_process_tree returns JSON with roots array", async () => {
  const result = await executeToolWithTimeout("get_process_tree", {}, 10_000);
  const parsed = JSON.parse(result) as { roots: unknown[] };
  expect(Array.isArray(parsed.roots)).toBe(true);
  expect(parsed.roots.length).toBeGreaterThan(0);
}, 15_000);

test("executeToolWithTimeout: get_runtime_services returns services + unavailable_sources", async () => {
  const result = await executeToolWithTimeout("get_runtime_services", {}, 10_000);
  const parsed = JSON.parse(result) as { services: unknown[]; unavailable_sources: unknown[] };
  expect(Array.isArray(parsed.services)).toBe(true);
  expect(Array.isArray(parsed.unavailable_sources)).toBe(true);
}, 15_000);
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun test src/tools.test.ts --test-name-pattern "M3|get_listening|get_process|get_runtime" 2>&1 | tail -5
```

Expected: failures — tools not registered yet.

- [ ] **Step 3: Add imports and tool definitions to `src/tools.ts`**

After the existing collector imports at the top of `src/tools.ts`, add:

```ts
import { getListeningPorts } from "./collectors/network";
import { getProcessTree } from "./collectors/process-tree";
import { getRuntimeServices } from "./collectors/services";
import { getDockerLogPatterns } from "./collectors/log-patterns";
```

Append 4 entries to `collectorTools` (after `get_process_list`):

```ts
  {
    name: "get_listening_ports",
    description: "List all TCP and UDP ports currently listening, with owning process name and PID",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_process_tree",
    description: "Get the process tree showing parent/child relationships. Without pid returns top 50 roots to depth 3. Pass pid to get a specific subtree.",
    input_schema: {
      type: "object",
      properties: {
        pid: { type: "number", description: "Root PID for subtree (omit for top-level tree)" },
        max_depth: { type: "number", description: "Maximum depth to expand (default 3)" },
        limit: { type: "number", description: "Max root processes when pid is omitted (default 50)" },
      },
      required: [],
    },
  },
  {
    name: "get_runtime_services",
    description: "List running services from systemd, launchctl, and docker-compose",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: ["systemd", "launchctl", "docker-compose", "all"], description: "Filter by source (default: all)" },
      },
      required: [],
    },
  },
  {
    name: "get_docker_log_patterns",
    description: "Analyse a container's recent logs for recurring error patterns and frequency",
    input_schema: {
      type: "object",
      properties: {
        container: { type: "string", description: "Container name or ID" },
        lines: { type: "number", description: "Lines to analyse (default 200)" },
        since: { type: "string", description: "Only logs since this duration (e.g. 30m, 2h) or ISO timestamp" },
      },
      required: ["container"],
    },
  },
```

- [ ] **Step 4: Add 4 dispatch cases to `executeTool`**

After the `get_process_list` case, add:

```ts
    case "get_listening_ports": {
      const result = await getListeningPorts();
      return redactSecrets(JSON.stringify(result, null, 2));
    }

    case "get_process_tree": {
      const pid = input.pid !== undefined ? Number(input.pid) : undefined;
      const maxDepth = input.max_depth !== undefined ? Number(input.max_depth) : 3;
      const limit = input.limit !== undefined ? Number(input.limit) : 50;
      const result = await getProcessTree(
        pid !== undefined && Number.isFinite(pid) ? pid : undefined,
        Number.isFinite(maxDepth) ? maxDepth : 3,
        Number.isFinite(limit) ? limit : 50,
      );
      return redactSecrets(JSON.stringify(result, null, 2));
    }

    case "get_runtime_services": {
      const source = input.source as "systemd" | "launchctl" | "docker-compose" | "all" | undefined;
      const validSources = new Set(["systemd", "launchctl", "docker-compose", "all"]);
      const result = await getRuntimeServices(validSources.has(source ?? "") ? source : "all");
      return redactSecrets(JSON.stringify(result, null, 2));
    }

    case "get_docker_log_patterns": {
      if (!input.container) return "Error: container is required";
      const linesRaw = input.lines !== undefined ? Number(input.lines) : undefined;
      const result = await getDockerLogPatterns(
        String(input.container),
        linesRaw !== undefined && Number.isFinite(linesRaw) ? linesRaw : undefined,
        input.since !== undefined ? String(input.since) : undefined,
      );
      return redactSecrets(JSON.stringify(result, null, 2));
    }
```

- [ ] **Step 5: Run tests**

```bash
bun test src/tools.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/tools.ts src/tools.test.ts
git commit -m "feat: register M3 diagnostic tools in executeTool with redaction"
```

---

## Task 8: Inode alert + system prompt updates

**Files:**
- Modify: `src/tui/draw.ts`
- Modify: `src/tui/draw.test.ts`
- Modify: `src/commands/ask.ts`
- Modify: `src/commands/watch.ts`

- [ ] **Step 1: Write failing test — append to `src/tui/draw.test.ts`**

```ts
test("generateAlerts: inode critical alert appears when disk_inode_percent > 95", () => {
  const system = {
    cpu_percent: 10, mem_percent: 20,
    mem_used_gb: 3, mem_total_gb: 16,
    disk_used_gb: 100, disk_total_gb: 200, disk_percent: 50,
    disk_inode_percent: 97,
    load_avg: [0.5, 0.5, 0.5] as [number, number, number],
  };
  const docker = { available: false, containers: [] };
  const alerts = generateAlerts(system, docker);
  const stripped = alerts.map(a => a.replace(/\x1b\[[0-9;]*m/g, ""));
  expect(stripped.some(a => a.includes("INODES CRITICAL"))).toBe(true);
});

test("generateAlerts: inode warning alert when disk_inode_percent is 87", () => {
  const system = {
    cpu_percent: 10, mem_percent: 20,
    mem_used_gb: 3, mem_total_gb: 16,
    disk_used_gb: 100, disk_total_gb: 200, disk_percent: 50,
    disk_inode_percent: 87,
    load_avg: [0.5, 0.5, 0.5] as [number, number, number],
  };
  const docker = { available: false, containers: [] };
  const alerts = generateAlerts(system, docker);
  const stripped = alerts.map(a => a.replace(/\x1b\[[0-9;]*m/g, ""));
  expect(stripped.some(a => a.includes("Inodes") && a.includes("87%"))).toBe(true);
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun test src/tui/draw.test.ts --test-name-pattern "inode" 2>&1 | tail -5
```

Expected: 2 new failures.

- [ ] **Step 3: Add inode alerts to `generateAlerts()` in `src/tui/draw.ts`**

In `generateAlerts()`, after the memory alert line, add before the closing `}` of the system metrics block:

```ts
    if (m.disk_inode_percent !== undefined) {
      if (m.disk_inode_percent > 95) alerts.push(`${"\x1b[31m"}✕ INODES CRITICAL ${m.disk_inode_percent.toFixed(0)}%${A.reset}`);
      else if (m.disk_inode_percent > 85) alerts.push(`${"\x1b[33m"}⚠ Inodes ${m.disk_inode_percent.toFixed(0)}% used${A.reset}`);
    }
```

- [ ] **Step 4: Run draw tests**

```bash
bun test src/tui/draw.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 5: Update system prompt in `src/commands/ask.ts`**

Change:

```ts
const SYSTEM_PROMPT = `You are Cael, a local DevOps agent. You are given a live snapshot of this machine's system state. Use the provided tools to get more detail when needed — especially get_docker_logs for container issues. Never fabricate or estimate metrics — only report what you can observe.`;
```

To:

```ts
const SYSTEM_PROMPT = `You are Cael, a local DevOps agent. You are given a live snapshot of this machine's system state. Use the provided tools to get more detail when needed — especially get_docker_logs and get_docker_log_patterns for container issues, get_listening_ports and get_process_tree for network and process attribution, and get_runtime_services to discover what is running. Never fabricate or estimate metrics — only report what you can observe.`;
```

- [ ] **Step 6: Update system prompt in `src/commands/watch.ts`**

In `formatSystemPrompt()`, change the return template literal's second line from:

```ts
Never fabricate — use the provided data.
```

To:

```ts
Never fabricate — use the provided data. For deeper investigation use: get_docker_log_patterns, get_listening_ports, get_process_tree, get_runtime_services.
```

- [ ] **Step 7: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: all pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add src/tui/draw.ts src/tui/draw.test.ts src/commands/ask.ts src/commands/watch.ts
git commit -m "feat: add inode alerts to watch dashboard and update agent system prompts with M3 tools"
```

---

## Final Validation

- [ ] **Full suite**

```bash
bun test
```

Expected: all pass, 0 fail (≥50 new tests added).

- [ ] **Smoke test new tools via run_shell to verify executeTool dispatch**

```bash
bun run index.ts --provider anthropic:claude-sonnet-4-6 ask "what ports are listening on this machine?" 2>&1 | head -5
```

Expected: output without errors (actual LLM response depends on API key).

---

## Self-Review

**Spec coverage:**

| Requirement | Task(s) | Status |
|-------------|---------|--------|
| `disk_inode_percent` in SystemMetrics | Task 1, 2 | ✓ |
| Inode alert in watch | Task 8 | ✓ |
| `get_listening_ports` — TCP + UDP, macOS + Linux | Task 3, 7 | ✓ |
| `get_process_tree` — depth + limit defaults | Task 4, 7 | ✓ |
| `get_runtime_services` — launchctl/systemd/docker-compose + unavailable_sources | Task 5, 7 | ✓ |
| `get_docker_log_patterns` — truncated flag, lines_analyzed = actual | Task 6, 7 | ✓ |
| `redactSecrets` applied to new tool outputs | Task 7 | ✓ |
| System prompt updated in ask.ts + watch.ts | Task 8 | ✓ |
| M1 prerequisite (redactSecrets import in tools.ts) | Already on main | ✓ |

**Placeholder scan:** All code blocks are complete. No TBDs.

**Type consistency:**
- `NetworkPorts.ports: PortEntry[]` — defined Task 1, returned by `getListeningPorts()` Task 3, dispatched Task 7. ✓
- `ProcessTree.roots: ProcessNode[]` — defined Task 1, returned by `buildTree()` Task 4, dispatched Task 7. ✓
- `RuntimeServices.unavailable_sources: string[]` — defined Task 1, populated Task 5, dispatched Task 7. ✓
- `DockerLogPatterns.truncated: boolean` — defined Task 1, set in `getDockerLogPatterns()` Task 6, dispatched Task 7. ✓
- `analyzeLogLines` returns `Omit<DockerLogPatterns, "container" | "total_lines" | "truncated">` — matches spread in `getDockerLogPatterns`. ✓
