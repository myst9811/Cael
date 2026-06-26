# M3: Deeper Diagnostics — Design Spec

## Goal

Give Cael's AI agent four new reactive tools for deep incident investigation (listening ports with process ownership, process tree, runtime services, docker log pattern analysis) and one proactive addition (disk inode usage folded into existing system metrics). The agent can now answer "what is listening on port 5432?", "which process spawned this runaway worker?", "what services are running?", and "what error patterns is this container repeating?" without reaching for raw shell commands.

## Approach

Approach A — pure collector expansion. New tools are regular `ToolDefinition` entries added to `collectorTools` and dispatched through the existing `executeTool` path. Cheap proactive data (disk inodes) is folded into the existing `getSystemMetrics()` call; everything else is reactive. No new architecture concepts.

## Prerequisites

M3 must be built on top of both M1 and M2:

- **M1** — `redactSecrets()` from `src/redact.ts` must be applied to new collector outputs in `executeTool` before they are returned to the LLM (the same way M1 applied it to `run_shell` and `get_docker_logs`). New collectors (ports, process tree, services, log patterns) can surface env vars, tokens, and connection strings from process cmdlines and service configs.
- **M2** — The `generateAlerts()` inode snippet in this spec uses M2's `critical[]` / `warnings[]` severity-bucket structure. If M3 is implemented on a branch where M2 is not yet merged, use the pre-M2 single-array style and add a TODO to convert once M2 lands.
- **watchTools** — Because new tools are added to `collectorTools`, they are automatically included in `watchTools` (via `[...collectorTools]`). `get_process_tree` and `get_runtime_services` can be slow (several hundred ms). This is acceptable since watch's AI chat is already async; no changes to the watch allowlist are needed because these collectors use `Bun.spawn` directly rather than `run_shell`.

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
  unavailable_sources: string[];  // sources where binary was not found (e.g. ["systemd", "docker-compose"])
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
  total_lines: number;       // lines in the raw fetch (may be less than requested if 10KB cap hit)
  lines_analyzed: number;    // actual lines passed to pattern analysis (= total_lines, not the requested count)
  truncated: boolean;        // true when getDockerLogs hit its 10KB cap before reaching requested line count
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

Platform dispatch — two commands run in parallel and results are merged:

- **macOS** (`process.platform === "darwin"`):
  - TCP: `lsof -i TCP -P -n -sTCP:LISTEN`
  - UDP: `lsof -i UDP -P -n`
  - Both commands output the same column format; `protocol` is derived from the `TYPE` column (`IPv4`/`IPv6`) and the `NAME` field suffix (`TCP`/`UDP`).
- **Linux**:
  - TCP + UDP: `ss -tulnp` (`-t` TCP, `-u` UDP, `-l` listening, `-n` no DNS, `-p` process)
  - `protocol` is read from the `Netid` column (`tcp`/`udp`).

Parse each output line into `PortEntry`. PID and process name may be absent if the process is owned by another user (not an error — return `PortEntry` with undefined `pid`/`process_name`). Timeout: 10s.

Fixture-based tests in `src/collectors/network.test.ts` with four fixtures: macOS TCP (`lsof` TCP output), macOS UDP (`lsof` UDP output), Linux TCP (`ss` TCP rows), Linux UDP (`ss` UDP rows). Verify `protocol` field is set correctly for each, and that a line without process info produces a `PortEntry` with undefined `pid`.

### `src/collectors/process-tree.ts`

**`getProcessTree(rootPid?: number, maxDepth = 3, limit = 50): Promise<ProcessTree>`**

Runs `ps -eo pid,ppid,pcpu,rss,comm` (compatible with macOS and Linux with minor format differences). Builds a `pid → ProcessNode` map in TypeScript, links children to parents, identifies roots (ppid === 0 or ppid === 1 or ppid not in the map).

- If `rootPid` is provided: returns only the subtree rooted at that PID, up to `maxDepth` levels. If not found, returns `{ roots: [] }`.
- If `rootPid` is omitted: returns the first `limit` root processes (sorted by CPU descending), each expanded up to `maxDepth` levels.

Defaults (`maxDepth = 3`, `limit = 50`) keep JSON output within `MAX_TOOL_RESULT_CHARS` on typical hosts. The LLM should pass a specific `pid` when it needs full subtree depth.

`mem_mb` is derived from RSS (in KB from ps, divided by 1024).

Fixture-based tests in `src/collectors/process-tree.test.ts`. Include a test asserting that calling with defaults on a 200-process fixture returns no more than 50 roots and no node deeper than depth 3.

### `src/collectors/services.ts`

**`getRuntimeServices(source?: "systemd" | "launchctl" | "docker-compose" | "all"): Promise<RuntimeServices>`**

Runs up to three commands in parallel, each wrapped in try/catch (missing binary = empty result, not an error):

1. **launchctl** (`darwin`): `launchctl list` — parse PID + label columns; status is "running" if PID column is a number, "stopped" if `-`.
2. **systemd** (`linux`): `systemctl list-units --type=service --state=running --no-pager --plain` — parse unit name + description.
3. **docker-compose**: searches CWD for `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`. If found, runs `docker compose ps --format json` (or `docker-compose ps` as fallback). Parses service name + status.

If `source` is specified, runs only that source. Default is `"all"`.

Tests in `src/collectors/services.test.ts` with mocked `Bun.spawn` output. Include a test verifying that a missing binary (spawn throws) populates `unavailable_sources` rather than silently returning an empty `services` array, and a test verifying "no units found" (spawn succeeds but output is empty) returns an empty `services` array with an empty `unavailable_sources`.

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
{ name: "get_process_tree",        description: "Get the process tree showing parent/child relationships. Without pid, returns top 50 roots to depth 3. Pass pid to get a specific subtree.", input_schema: { type: "object", properties: { pid: { type: "number", description: "Root PID for subtree (omit for top-level tree)" }, max_depth: { type: "number", description: "Maximum depth to expand (default 3)" }, limit: { type: "number", description: "Max root processes when pid is omitted (default 50)" } }, required: [] } }
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
| `src/collectors/network.test.ts` | Four fixtures (macOS TCP, macOS UDP, Linux TCP, Linux UDP); verify `protocol` field; test line without PID produces undefined `pid`/`process_name` |
| `src/collectors/process-tree.test.ts` | Fixture-based: 200-process `ps` output; verify default call returns ≤50 roots at depth ≤3; verify subtree lookup by PID |
| `src/collectors/services.test.ts` | Mock `Bun.spawn`; verify each source parses correctly; verify missing binary sets `unavailable_sources`; verify empty output gives empty `services` with empty `unavailable_sources` |
| `src/collectors/log-patterns.test.ts` | Inline fixture strings; verify `truncated: true` when fetch hits 10KB cap; verify `lines_analyzed` = actual lines (not requested); verify error/warn counts; verify top pattern by frequency |
| `src/collectors/system.test.ts` | Extend: add macOS `df -i` fixture line; verify `disk_inode_percent` is parsed correctly |
| `src/tui/draw.test.ts` | Extend: verify inode critical alert sorts before disk/CPU warnings |

---

## What is NOT in M3

- Network topology / service dependency graph (M4+)
- Log streaming / tail (M4+)
- Port scan or external connectivity checks
- Process kill or management actions
- Service restart / control
