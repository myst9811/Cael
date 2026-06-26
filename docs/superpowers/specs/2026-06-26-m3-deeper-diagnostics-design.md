# M3: Deeper Diagnostics — Design Spec

## Goal

Give Cael's AI agent four new reactive tools for deep incident investigation (listening ports with process ownership, process tree, runtime services, docker log pattern analysis) and one proactive addition (disk inode usage folded into existing system metrics). The agent can now answer "what is listening on port 5432?", "which process spawned this runaway worker?", "what services are running?", and "what error patterns is this container repeating?" without reaching for raw shell commands.

## Approach

Approach A — pure collector expansion. New tools are regular `ToolDefinition` entries added to `collectorTools` and dispatched through the existing `executeTool` path. Cheap proactive data (disk inodes) is folded into the existing `getSystemMetrics()` call; everything else is reactive. No new architecture concepts.

---

## Types (`src/collectors/types.ts`)

Add to the existing file:

```ts
export interface PortEntry {
  port: number;
  protocol: "tcp" | "udp";
  address: string;        // e.g. "0.0.0.0", "127.0.0.1", "::"
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
  error_count: number;
  warn_count: number;
  patterns: LogPattern[];
}
```

`SystemMetrics` gains one optional field:

```ts
disk_inode_percent?: number;  // highest inode usage across non-tmpfs mounts
```

`CollectedContext` is unchanged — inodes live inside `SystemMetrics`.

---

## New Files

### `src/collectors/network.ts`

**`getListeningPorts(): Promise<NetworkPorts>`**

Platform dispatch:
- **macOS** (`process.platform === "darwin"`): `lsof -i -P -n -sTCP:LISTEN`
- **Linux**: `ss -tlnp`

Parse each output line into `PortEntry`. PID and process name may be absent if the process is owned by another user (not an error — return `PortEntry` with undefined `pid`/`process_name`). Timeout: 10s.

Fixture-based tests in `src/collectors/network.test.ts` with a macOS `lsof` fixture and a Linux `ss` fixture.

### `src/collectors/process-tree.ts`

**`getProcessTree(rootPid?: number): Promise<ProcessTree>`**

Runs `ps -eo pid,ppid,pcpu,rss,comm` (compatible with macOS and Linux with minor format differences). Builds a `pid → ProcessNode` map in TypeScript, links children to parents, identifies roots (ppid === 0 or ppid === 1 or ppid not in the map). If `rootPid` is provided, returns only the subtree rooted at that PID; if not found, returns `{ roots: [] }`.

`mem_mb` is derived from RSS (in KB from ps, divided by 1024).

Fixture-based tests in `src/collectors/process-tree.test.ts`.

### `src/collectors/services.ts`

**`getRuntimeServices(source?: "systemd" | "launchctl" | "docker-compose" | "all"): Promise<RuntimeServices>`**

Runs up to three commands in parallel, each wrapped in try/catch (missing binary = empty result, not an error):

1. **launchctl** (`darwin`): `launchctl list` — parse PID + label columns; status is "running" if PID column is a number, "stopped" if `-`.
2. **systemd** (`linux`): `systemctl list-units --type=service --state=running --no-pager --plain` — parse unit name + description.
3. **docker-compose**: searches CWD for `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`. If found, runs `docker compose ps --format json` (or `docker-compose ps` as fallback). Parses service name + status.

If `source` is specified, runs only that source. Default is `"all"`.

Tests in `src/collectors/services.test.ts` with mocked `Bun.spawn` output.

### `src/collectors/log-patterns.ts`

**`getDockerLogPatterns(container: string, lines?: number, since?: string): Promise<DockerLogPatterns>`**

1. Calls the existing `getDockerLogs(container, lines ?? 200, since)` — reuses the existing Docker log fetch with its 10KB cap.
2. Splits into individual log lines.
3. **Normalisation pass** (pure TypeScript, no external deps): strips leading timestamps (`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`) and PIDs (`\[\d+\]`), then truncates each line to 120 chars.
4. **Frequency pass**: counts exact-match occurrences of each normalised line. Groups lines that share the first 60 characters (prefix bucketing) for near-duplicate detection. Returns top 10 patterns by count.
5. **Level detection**: scans each original line for keywords `ERROR`, `WARN`, `FATAL`, `CRITICAL` (case-insensitive) to populate `error_count`, `warn_count`, and `LogPattern.level`.
6. **Timestamps**: `first_seen` / `last_seen` extracted from the original line if a leading ISO timestamp is present.

Tests in `src/collectors/log-patterns.test.ts` with inline fixture strings (no fixture files needed — log content is short and varied).

---

## Modified Files

### `src/collectors/system.ts`

Add a `df -i` call inside `getSystemMetrics()` (runs in parallel with existing calls, failure is non-fatal — field stays `undefined`):

```ts
// macOS: df -i / Linux: df -i
// Parse: find the row with highest Use% in the Inodes column, excluding tmpfs/devtmpfs
```

### `src/tools.ts`

Add 4 tool definitions to `collectorTools`:

```ts
{ name: "get_listening_ports",     description: "List all TCP/UDP ports currently listening, with owning process name and PID", input_schema: { type: "object", properties: {}, required: [] } }
{ name: "get_process_tree",        description: "Get the full process tree showing parent/child relationships. Pass pid to get a subtree.", input_schema: { type: "object", properties: { pid: { type: "number", description: "Root PID for subtree (omit for full tree)" } }, required: [] } }
{ name: "get_runtime_services",    description: "List running services from systemd, launchctl, and docker-compose", input_schema: { type: "object", properties: { source: { type: "string", enum: ["systemd", "launchctl", "docker-compose", "all"], description: "Filter by service source (default: all)" } }, required: [] } }
{ name: "get_docker_log_patterns", description: "Analyse a container's recent logs for recurring error patterns and frequency", input_schema: { type: "object", properties: { container: { type: "string", description: "Container name or ID" }, lines: { type: "number", description: "Lines to analyse (default 200)" }, since: { type: "string", description: "Only logs since this duration (e.g. 30m, 2h) or ISO timestamp" } }, required: ["container"] } }
```

Add dispatch cases for all 4 in `executeTool`.

### `src/commands/ask.ts` and `src/commands/watch.ts`

Update the system prompt string in both files. Change:

> "especially `get_docker_logs` for container issues"

to:

> "especially `get_docker_logs` and `get_docker_log_patterns` for container issues, `get_listening_ports` and `get_process_tree` for network and process attribution, and `get_runtime_services` to discover what is running"

### `src/tui/draw.ts`

Add two new alert conditions to `generateAlerts()`:

```ts
if (m.disk_inode_percent !== undefined) {
  if (m.disk_inode_percent > 95) critical.push(`✕ INODES CRITICAL ${m.disk_inode_percent.toFixed(0)}%`);
  else if (m.disk_inode_percent > 85) warnings.push(`⚠ Inodes ${m.disk_inode_percent.toFixed(0)}% used`);
}
```

---

## Testing Strategy

| File | Test approach |
|------|---------------|
| `src/collectors/network.test.ts` | Fixture-based: macOS `lsof` output and Linux `ss` output; verify `PortEntry` fields; test lines without PID |
| `src/collectors/process-tree.test.ts` | Fixture-based: 15-line `ps` output covering parent/child/orphan; verify tree depth and subtree lookup |
| `src/collectors/services.test.ts` | Mock `Bun.spawn` via a test helper; verify each source parses correctly; verify missing binary returns empty not an error |
| `src/collectors/log-patterns.test.ts` | Inline fixture strings; verify error/warn counts; verify top pattern is the most frequent; verify timestamp extraction |
| `src/collectors/system.test.ts` | Extend existing fixture tests: add a macOS `df -i` fixture line; verify `disk_inode_percent` is parsed correctly |
| `src/tui/draw.test.ts` | Extend existing: verify inode critical alert is sorted before warnings |

---

## What is NOT in M3

- Network topology / service dependency graph (M4+)
- Log streaming / tail (M4+)
- Port scan or external connectivity checks
- Process kill or management actions
- Service restart / control
