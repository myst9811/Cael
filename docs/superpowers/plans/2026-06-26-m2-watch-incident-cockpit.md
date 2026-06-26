# M2: Watch — Incident Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `cael watch` with container selection + detail row, severity-sorted alerts, freshness badges, compact layout toggle, and a Docker health column.

**Architecture:** All changes extend the existing state machine (WatchState), frame builder (FrameOptions), and panel renderers in-place. Two new files are added (`docker-inspect.ts`, `detail.ts`). The worktree is `feat/m2-watch-cockpit` branched from `main`.

**Tech Stack:** Bun, TypeScript, `bun:test`, `Bun.$` shell (docker commands), ANSI escape codes.

---

## File Map

| Action  | Path | Responsibility |
|---------|------|----------------|
| Modify  | `src/collectors/types.ts` | Add `"none"` to health union; add `ContainerInspect` type |
| Modify  | `src/collectors/docker.ts` | Parse health from status string in `parseDockerPs` |
| Create  | `src/collectors/__fixtures__/docker-ps-health.txt` | Fixture for health parsing tests |
| Modify  | `src/collectors/docker.test.ts` | Health parsing tests |
| Create  | `src/collectors/docker-inspect.ts` | `getDockerInspect(name)` — runs `docker inspect`, returns `ContainerInspect` |
| Create  | `src/collectors/__fixtures__/docker-inspect-running.json` | Fixture for running container inspect |
| Create  | `src/collectors/__fixtures__/docker-inspect-exited.json` | Fixture for exited container inspect |
| Create  | `src/collectors/docker-inspect.test.ts` | Unit tests for `parseDockerInspect` |
| Create  | `src/tui/detail.ts` | `formatUptime`, `renderContainerDetail` |
| Create  | `src/tui/detail.test.ts` | Unit tests for both functions |
| Modify  | `src/tui/state.ts` | New `WatchState` fields; extended `handleKey(state, key, containerNames?)` |
| Modify  | `src/tui/state.test.ts` | New key binding tests |
| Modify  | `src/tui/panels.ts` | `renderDockerPanel(data, cursor?)` — cursor highlight + health column |
| Modify  | `src/tui/panels.test.ts` | Cursor highlight + health column tests |
| Modify  | `src/tui/draw.ts` | New `FrameOptions` fields; compact rows; detail row section; freshness badges; severity-sorted alerts |
| Modify  | `src/tui/draw.test.ts` | Compact, detail row, freshness, alert sort tests |
| Modify  | `src/commands/watch.ts` | Wire `lastRefreshAt`, `inspectCache`, cursor clamping, container names into `handleKey` |

---

## Task 1: Types — add `ContainerInspect` and health `"none"` variant

**Files:**
- Modify: `src/collectors/types.ts`

- [ ] **Step 1: Edit `src/collectors/types.ts`**

Replace the existing `health?` line and add `ContainerInspect` at the end of the file:

```ts
// src/collectors/types.ts
export interface SystemMetrics {
  cpu_percent: number;
  mem_used_gb: number;
  mem_total_gb: number;
  mem_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_percent: number;
  load_avg: [number, number, number];
}

export interface DockerContainer {
  name: string;
  status: "running" | "exited" | "paused" | "restarting";
  health?: "healthy" | "unhealthy" | "starting" | "none";
  image: string;
  uptime?: string;
  exit_code?: number;
  ports: string[];
}

export interface DockerStatus {
  available: boolean;
  error?: string;
  containers: DockerContainer[];
}

export interface DockerLogsResult {
  logs: string;
  truncated: boolean;
}

export interface ContainerInspect {
  name: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  restartCount: number;
  exitCode: number;
  image: string;
  ports: string[];
}

export interface GitStatus {
  is_git_repo: boolean;
  branch?: string;
  dirty_files?: number;
  unpushed_commits?: number | null;
  untracked_files?: number;
  stash_count?: number;
  last_commit_message?: string;
  last_commit_hash?: string;
}

export interface ProcessEntry {
  pid: number;
  name: string;
  cpu_percent: number;
  mem_mb: number;
  user: string;
  command: string;
}

export interface ProcessList {
  processes: ProcessEntry[];
}

export type CollectorError = { error: string };

export interface CollectedContext {
  timestamp: string;
  system: SystemMetrics | CollectorError;
  docker: DockerStatus | CollectorError;
  git: GitStatus | CollectorError;
  processes: ProcessList | CollectorError;
}
```

- [ ] **Step 2: Verify no type errors**

```bash
bun test 2>&1 | tail -4
```

Expected: same pass count, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add src/collectors/types.ts
git commit -m "feat(types): add ContainerInspect type and health 'none' variant"
```

---

## Task 2: Health parsing in docker collector

**Files:**
- Create: `src/collectors/__fixtures__/docker-ps-health.txt`
- Modify: `src/collectors/docker.ts`
- Modify: `src/collectors/docker.test.ts`

- [ ] **Step 1: Create fixture**

Write `src/collectors/__fixtures__/docker-ps-health.txt`:

```
api	running	Up 3 days (healthy)	nginx:latest	0.0.0.0:80->80/tcp
db	running	Up 1 hour (unhealthy)	postgres:15	5432/tcp
cache	running	Up 5 minutes (health: starting)	redis:7	
worker	exited	Exited (1) 4 minutes ago	myapp:latest	
```

- [ ] **Step 2: Write failing tests — append to `src/collectors/docker.test.ts`**

```ts
test("parseDockerPs: parses healthy container", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "api")!.health).toBe("healthy");
});

test("parseDockerPs: parses unhealthy container", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "db")!.health).toBe("unhealthy");
});

test("parseDockerPs: parses health:starting container", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "cache")!.health).toBe("starting");
});

test("parseDockerPs: exited container with no health has none", () => {
  const result = parseDockerPs(fixture("docker-ps-health.txt"));
  expect(result.find(c => c.name === "worker")!.health).toBe("none");
});

test("parseDockerPs: existing fixture containers have none health (no parens in status)", () => {
  const result = parseDockerPs(fixture("docker-ps-running.txt"));
  for (const c of result) {
    expect(c.health).toBe("none");
  }
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test src/collectors/docker.test.ts 2>&1 | tail -5
```

Expected: 5 new failures.

- [ ] **Step 4: Add `parseHealth` and wire into `parseDockerPs` in `src/collectors/docker.ts`**

Add after `normalizeState`:

```ts
function parseHealth(status: string): DockerContainer["health"] {
  if (status.includes("(healthy)")) return "healthy";
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(health: starting)")) return "starting";
  return "none";
}
```

Inside `parseDockerPs`, after building `container`, add:

```ts
container.health = parseHealth(status.trim());
```

- [ ] **Step 5: Run tests**

```bash
bun test src/collectors/docker.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/docker.ts src/collectors/docker.test.ts src/collectors/__fixtures__/docker-ps-health.txt
git commit -m "feat: parse Docker health status from docker ps output"
```

---

## Task 3: Docker inspect collector

**Files:**
- Create: `src/collectors/docker-inspect.ts`
- Create: `src/collectors/__fixtures__/docker-inspect-running.json`
- Create: `src/collectors/__fixtures__/docker-inspect-exited.json`
- Create: `src/collectors/docker-inspect.test.ts`

- [ ] **Step 1: Create fixtures**

Write `src/collectors/__fixtures__/docker-inspect-running.json`:

```json
[{
  "Name": "/api",
  "RestartCount": 0,
  "State": {
    "Status": "running",
    "ExitCode": 0,
    "StartedAt": "2026-06-25T10:00:00Z",
    "FinishedAt": "0001-01-01T00:00:00Z"
  },
  "Config": { "Image": "nginx:latest" },
  "NetworkSettings": {
    "Ports": {
      "80/tcp": [{ "HostIp": "0.0.0.0", "HostPort": "80" }],
      "443/tcp": [{ "HostIp": "0.0.0.0", "HostPort": "443" }]
    }
  }
}]
```

Write `src/collectors/__fixtures__/docker-inspect-exited.json`:

```json
[{
  "Name": "/worker",
  "RestartCount": 3,
  "State": {
    "Status": "exited",
    "ExitCode": 1,
    "StartedAt": "2026-06-25T08:00:00Z",
    "FinishedAt": "2026-06-25T08:05:00Z"
  },
  "Config": { "Image": "myapp:latest" },
  "NetworkSettings": { "Ports": {} }
}]
```

- [ ] **Step 2: Write failing tests**

Create `src/collectors/docker-inspect.test.ts`:

```ts
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDockerInspect } from "./docker-inspect";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8"));

test("parseDockerInspect: extracts name (strips leading slash)", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.name).toBe("api");
});

test("parseDockerInspect: running container status", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.status).toBe("running");
  expect(result.exitCode).toBe(0);
  expect(result.restartCount).toBe(0);
});

test("parseDockerInspect: extracts startedAt and finishedAt", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.startedAt).toBe("2026-06-25T10:00:00Z");
  expect(result.finishedAt).toBe("0001-01-01T00:00:00Z");
});

test("parseDockerInspect: extracts image", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.image).toBe("nginx:latest");
});

test("parseDockerInspect: maps ports to host:container format", () => {
  const result = parseDockerInspect(fixture("docker-inspect-running.json"));
  expect(result.ports).toContain("0.0.0.0:80->80/tcp");
  expect(result.ports).toContain("0.0.0.0:443->443/tcp");
});

test("parseDockerInspect: exited container with restart count and exit code", () => {
  const result = parseDockerInspect(fixture("docker-inspect-exited.json"));
  expect(result.name).toBe("worker");
  expect(result.status).toBe("exited");
  expect(result.exitCode).toBe(1);
  expect(result.restartCount).toBe(3);
  expect(result.ports).toHaveLength(0);
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
bun test src/collectors/docker-inspect.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './docker-inspect'`

- [ ] **Step 4: Implement `src/collectors/docker-inspect.ts`**

```ts
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
```

- [ ] **Step 5: Run tests**

```bash
bun test src/collectors/docker-inspect.test.ts 2>&1 | tail -5
```

Expected: 6 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/docker-inspect.ts src/collectors/docker-inspect.test.ts src/collectors/__fixtures__/docker-inspect-running.json src/collectors/__fixtures__/docker-inspect-exited.json
git commit -m "feat: add docker inspect collector"
```

---

## Task 4: Container detail renderer

**Files:**
- Create: `src/tui/detail.ts`
- Create: `src/tui/detail.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/tui/detail.test.ts`:

```ts
import { test, expect } from "bun:test";
import { formatUptime, renderContainerDetail } from "./detail";
import type { ContainerInspect } from "../collectors/types";

const FIXED_NOW = new Date("2026-06-26T12:00:00Z").getTime();

const running: ContainerInspect = {
  name: "nginx",
  status: "running",
  startedAt: "2026-06-26T09:46:00Z",
  finishedAt: "0001-01-01T00:00:00Z",
  restartCount: 0,
  exitCode: 0,
  image: "nginx:1.25",
  ports: ["0.0.0.0:443->443/tcp", "0.0.0.0:80->80/tcp"],
};

const exited: ContainerInspect = {
  name: "worker",
  status: "exited",
  startedAt: "2026-06-26T08:00:00Z",
  finishedAt: "2026-06-26T11:55:00Z",
  restartCount: 3,
  exitCode: 1,
  image: "myapp:latest",
  ports: [],
};

test("formatUptime: running container shows started X ago", () => {
  // startedAt is 2h14m before FIXED_NOW
  const result = formatUptime("2026-06-26T09:46:00Z", "0001-01-01T00:00:00Z", "running", FIXED_NOW);
  expect(result).toContain("2h");
  expect(result).toContain("14m");
  expect(result).toContain("ago");
});

test("formatUptime: exited container shows stopped X ago", () => {
  // finishedAt is 5 minutes before FIXED_NOW
  const result = formatUptime("", "2026-06-26T11:55:00Z", "exited", FIXED_NOW);
  expect(result).toContain("5m");
  expect(result).toContain("ago");
});

test("formatUptime: less than 60 seconds shows seconds", () => {
  const start = new Date(FIXED_NOW - 30_000).toISOString();
  const result = formatUptime(start, "0001-01-01T00:00:00Z", "running", FIXED_NOW);
  expect(result).toContain("30s");
});

test("renderContainerDetail: expanded produces 2 lines", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines).toHaveLength(2);
});

test("renderContainerDetail: compact produces 1 line", () => {
  const lines = renderContainerDetail(running, true);
  expect(lines).toHaveLength(1);
});

test("renderContainerDetail: shows container name", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines.join("\n")).toContain("nginx");
});

test("renderContainerDetail: shows RUNNING status", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines.join("\n").toUpperCase()).toContain("RUNNING");
});

test("renderContainerDetail: shows image on second line in expanded", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines[1]).toContain("nginx:1.25");
});

test("renderContainerDetail: shows restart count", () => {
  const lines = renderContainerDetail(running, false);
  expect(lines.join("\n")).toContain("0");
});

test("renderContainerDetail: exited container shows exit code", () => {
  const lines = renderContainerDetail(exited, false);
  expect(lines.join("\n")).toContain("1");
});

test("renderContainerDetail: no ports shows 'no ports'", () => {
  const lines = renderContainerDetail(exited, false);
  expect(lines.join("\n")).toContain("no ports");
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test src/tui/detail.test.ts 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './detail'`

- [ ] **Step 3: Implement `src/tui/detail.ts`**

```ts
import type { ContainerInspect } from "../collectors/types";

const ZERO_TIME = "0001-01-01T00:00:00Z";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatUptime(
  startedAt: string,
  finishedAt: string,
  status: string,
  now = Date.now()
): string {
  if (status === "running") {
    const t = new Date(startedAt).getTime();
    if (isNaN(t)) return "unknown";
    return `started ${formatDuration(now - t)} ago`;
  }
  if (finishedAt && finishedAt !== ZERO_TIME) {
    const t = new Date(finishedAt).getTime();
    if (isNaN(t)) return "stopped";
    return `stopped ${formatDuration(now - t)} ago`;
  }
  return "stopped";
}

export function renderContainerDetail(inspect: ContainerInspect, compact: boolean): string[] {
  const uptime = formatUptime(inspect.startedAt, inspect.finishedAt, inspect.status);
  const status = inspect.status.toUpperCase();
  const portStr = inspect.ports.length > 0
    ? inspect.ports.slice(0, 3).join(", ")
    : "no ports";
  const exitStr = inspect.status !== "running" ? `  exit: ${inspect.exitCode}` : "";

  if (compact) {
    return [
      `  ${inspect.name}  ${status}  ${uptime}  restarts: ${inspect.restartCount}${exitStr}  ${inspect.image}  ${portStr}`,
    ];
  }
  return [
    `  ${inspect.name}   ${status}  ${uptime}   restarts: ${inspect.restartCount}${exitStr}`,
    `  image: ${inspect.image}   ports: ${portStr}`,
  ];
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/tui/detail.test.ts 2>&1 | tail -5
```

Expected: 12 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/tui/detail.ts src/tui/detail.test.ts
git commit -m "feat: add container detail renderer with uptime formatting"
```

---

## Task 5: State machine — new fields and key bindings

**Files:**
- Modify: `src/tui/state.ts`
- Modify: `src/tui/state.test.ts`

- [ ] **Step 1: Write failing tests — append to `src/tui/state.test.ts`**

```ts
// ── M2 additions ────────────────────────────────────────────────────────────

test("createWatchState: new M2 fields initialise correctly", () => {
  const s = createWatchState();
  expect(s.dockerCursor).toBe(-1);
  expect(s.panelFocus).toBeNull();
  expect(s.selectedContainer).toBeNull();
  expect(s.compactMode).toBe(false);
});

test("down arrow in IDLE with containers activates docker focus and moves cursor to 0", () => {
  const s = createWatchState();
  const { state } = handleKey(s, "\x1b[B", ["api", "db"]);
  expect(state.dockerCursor).toBe(0);
  expect(state.panelFocus).toBe("docker");
});

test("up arrow in IDLE with containers wraps to last container", () => {
  const s = createWatchState();
  const { state } = handleKey(s, "\x1b[A", ["api", "db"]);
  expect(state.dockerCursor).toBe(1);
});

test("down arrow wraps from last container back to 0", () => {
  const s = { ...createWatchState(), dockerCursor: 1, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\x1b[B", ["api", "db"]);
  expect(state.dockerCursor).toBe(0);
});

test("up arrow decrements cursor", () => {
  const s = { ...createWatchState(), dockerCursor: 1, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\x1b[A", ["api", "db"]);
  expect(state.dockerCursor).toBe(0);
});

test("arrow keys are no-ops in IDLE with no containers", () => {
  const s = createWatchState();
  const { state } = handleKey(s, "\x1b[B", []);
  expect(state.dockerCursor).toBe(-1);
  expect(state.panelFocus).toBeNull();
});

test("Enter in IDLE with docker focused sets selectedContainer", () => {
  const s = { ...createWatchState(), dockerCursor: 0, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\r", ["api", "db"]);
  expect(state.selectedContainer).toBe("api");
});

test("Enter in IDLE toggles off selectedContainer when already selected", () => {
  const s = { ...createWatchState(), dockerCursor: 0, panelFocus: "docker" as const, selectedContainer: "api" };
  const { state } = handleKey(s, "\r", ["api", "db"]);
  expect(state.selectedContainer).toBeNull();
});

test("ESC in IDLE with selectedContainer closes detail only (keeps cursor)", () => {
  const s = { ...createWatchState(), dockerCursor: 0, panelFocus: "docker" as const, selectedContainer: "api" };
  const { state } = handleKey(s, "\x1b", ["api"]);
  expect(state.selectedContainer).toBeNull();
  expect(state.dockerCursor).toBe(0);
});

test("ESC in IDLE with cursor but no selectedContainer clears cursor", () => {
  const s = { ...createWatchState(), dockerCursor: 1, panelFocus: "docker" as const };
  const { state } = handleKey(s, "\x1b", ["api", "db"]);
  expect(state.dockerCursor).toBe(-1);
  expect(state.panelFocus).toBeNull();
});

test("z in IDLE toggles compactMode", () => {
  const s = createWatchState();
  const { state } = handleKey(s, "z");
  expect(state.compactMode).toBe(true);
  const { state: s2 } = handleKey(state, "z");
  expect(s2.compactMode).toBe(false);
});

test("z in SHOWING_RESULT toggles compactMode", () => {
  const s = { ...createWatchState(), mode: "SHOWING_RESULT" as const };
  const { state } = handleKey(s, "z");
  expect(state.compactMode).toBe(true);
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun test src/tui/state.test.ts 2>&1 | tail -6
```

Expected: 13 new failures.

- [ ] **Step 3: Replace `src/tui/state.ts`**

```ts
export type WatchMode = "IDLE" | "QUERYING" | "SHOWING_RESULT";
export type WatchAction = "none" | "quit" | "submit";

export interface WatchState {
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
  agentActivity: string;
  scrollOffset: number;
  dockerCursor: number;
  panelFocus: "docker" | null;
  selectedContainer: string | null;
  compactMode: boolean;
}

export function createWatchState(): WatchState {
  return {
    mode: "IDLE",
    queryInput: "",
    aiResponse: "",
    agentActivity: "",
    scrollOffset: 0,
    dockerCursor: -1,
    panelFocus: null,
    selectedContainer: null,
    compactMode: false,
  };
}

export function handleKey(
  state: WatchState,
  key: string,
  containerNames: string[] = []
): { state: WatchState; action: WatchAction } {
  switch (state.mode) {
    case "IDLE": {
      if (key === "/") return { state: { ...state, mode: "QUERYING", queryInput: "" }, action: "none" };
      if (key === "q" || key === "Q" || key === "\x03") return { state, action: "quit" };
      if (key === "z" || key === "Z") return { state: { ...state, compactMode: !state.compactMode }, action: "none" };

      if (key === "\x1b") {
        if (state.selectedContainer !== null) return { state: { ...state, selectedContainer: null }, action: "none" };
        if (state.dockerCursor >= 0) return { state: { ...state, dockerCursor: -1, panelFocus: null }, action: "none" };
        return { state, action: "none" };
      }

      if (key === "\r" && state.panelFocus === "docker" && state.dockerCursor >= 0) {
        const name = containerNames[state.dockerCursor];
        if (!name) return { state, action: "none" };
        const isSame = state.selectedContainer === name;
        return { state: { ...state, selectedContainer: isSame ? null : name }, action: "none" };
      }

      if (containerNames.length > 0) {
        if (key === "\x1b[B") {
          const next = state.dockerCursor < 0 ? 0 : (state.dockerCursor + 1) % containerNames.length;
          return { state: { ...state, dockerCursor: next, panelFocus: "docker" }, action: "none" };
        }
        if (key === "\x1b[A") {
          const next = state.dockerCursor <= 0 ? containerNames.length - 1 : state.dockerCursor - 1;
          return { state: { ...state, dockerCursor: next, panelFocus: "docker" }, action: "none" };
        }
      }

      return { state, action: "none" };
    }

    case "QUERYING": {
      if (key === "\x1b") return { state: { ...state, mode: "IDLE", queryInput: "" }, action: "none" };
      if (key === "\x03") return { state, action: "quit" };
      if (key === "\r" || key === "\n") {
        if (!state.queryInput.trim()) return { state, action: "none" };
        return { state, action: "submit" };
      }
      if (key === "\x7f" || key === "\b") {
        return { state: { ...state, queryInput: state.queryInput.slice(0, -1) }, action: "none" };
      }
      if (key.length === 1 && key >= " ") {
        return { state: { ...state, queryInput: state.queryInput + key }, action: "none" };
      }
      return { state, action: "none" };
    }

    case "SHOWING_RESULT": {
      if (key === "q" || key === "Q" || key === "\x03") return { state, action: "quit" };
      if (key === "z" || key === "Z") return { state: { ...state, compactMode: !state.compactMode }, action: "none" };
      if (key === "\x1b[A") return { state: { ...state, scrollOffset: state.scrollOffset + 1 }, action: "none" };
      if (key === "\x1b[B") return { state: { ...state, scrollOffset: Math.max(0, state.scrollOffset - 1) }, action: "none" };
      if (key === "\x1b") return { state: { ...state, mode: "IDLE", aiResponse: "", scrollOffset: 0 }, action: "none" };
      if (key === "/") return { state: { ...state, mode: "QUERYING", queryInput: "", scrollOffset: 0 }, action: "none" };
      return { state, action: "none" };
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/tui/state.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/tui/state.ts src/tui/state.test.ts
git commit -m "feat: add container selection, compact toggle, and docker navigation to watch state"
```

---

## Task 6: Docker panel — cursor highlight and health column

**Files:**
- Modify: `src/tui/panels.ts`
- Modify: `src/tui/panels.test.ts`

- [ ] **Step 1: Write failing tests — append to `src/tui/panels.test.ts`**

```ts
const dockerWithHealth: DockerStatus = {
  available: true,
  containers: [
    { name: "api", status: "running", health: "healthy", image: "nginx:latest", ports: [] },
    { name: "db", status: "running", health: "unhealthy", image: "postgres:15", ports: [] },
    { name: "cache", status: "running", health: "none", image: "redis:7", ports: [] },
  ],
};

test("renderDockerPanel: highlights cursor row with reverse video", () => {
  const lines = renderDockerPanel(dockerWithHealth, 0);
  // The first container row (index 1 in lines, since [0] is "DOCKER" title) has cursor
  const row = lines[1] ?? "";
  expect(row).toContain("\x1b[7m");
});

test("renderDockerPanel: non-cursor rows do not have reverse video", () => {
  const lines = renderDockerPanel(dockerWithHealth, 0);
  const row = lines[2] ?? "";
  expect(row).not.toContain("\x1b[7m");
});

test("renderDockerPanel: shows HELTH for healthy container", () => {
  const out = joined(renderDockerPanel(dockerWithHealth, -1));
  expect(out).toContain("HELTH");
});

test("renderDockerPanel: shows UNHLT for unhealthy container", () => {
  const out = joined(renderDockerPanel(dockerWithHealth, -1));
  expect(out).toContain("UNHLT");
});

test("renderDockerPanel: shows NONE for no-health container", () => {
  const out = joined(renderDockerPanel(dockerWithHealth, -1));
  expect(out).toContain("NONE");
});

test("renderDockerPanel: cursor -1 does not highlight any row", () => {
  const lines = renderDockerPanel(docker, -1);
  for (const l of lines) {
    expect(l).not.toContain("\x1b[7m");
  }
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun test src/tui/panels.test.ts 2>&1 | tail -5
```

Expected: 6 new failures.

- [ ] **Step 3: Update `renderDockerPanel` in `src/tui/panels.ts`**

Change the function signature to `renderDockerPanel(data: DockerStatus | CollectorError, cursor = -1): string[]` and update the container rendering loop:

```ts
export function renderDockerPanel(data: DockerStatus | CollectorError, cursor = -1): string[] {
  if (!("available" in data)) {
    return ["DOCKER", `  ⚠ ${(data as CollectorError).error.slice(0, 28)}`];
  }
  const d = data as DockerStatus;
  if (!d.available) {
    return ["DOCKER", "  ○ daemon not running"];
  }
  if (d.containers.length === 0) {
    return ["DOCKER", "  no containers"];
  }
  const lines: string[] = ["DOCKER"];
  d.containers.slice(0, 6).forEach((c, i) => {
    const icon =
      c.status === "running"    ? `${G}●${Z}` :
      c.status === "restarting" ? `${Y}↻${Z}` : `${R}✕${Z}`;
    const name = c.name.slice(0, 10).padEnd(10);
    const statusStr =
      c.status === "running"    ? `${G}UP  ${Z}` :
      c.status === "paused"     ? `${Y}PAUS${Z}` :
      c.status === "restarting" ? `${Y}RSTR${Z}` : `${R}DOWN${Z}`;
    const healthStr =
      c.health === "healthy"   ? `${G}HELTH${Z}` :
      c.health === "unhealthy" ? `${R}UNHLT${Z}` :
      c.health === "starting"  ? `${Y}START${Z}` : `\x1b[2mNONE ${Z}`;
    const row = `  ${icon} ${name} ${statusStr} ${healthStr}`;
    lines.push(i === cursor ? `\x1b[7m${row}\x1b[0m` : row);
  });
  return lines;
}
```

- [ ] **Step 4: Run tests**

```bash
bun test src/tui/panels.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/tui/panels.ts src/tui/panels.test.ts
git commit -m "feat: add cursor highlight and health column to docker panel"
```

---

## Task 7: Frame builder — compact mode and detail row

**Files:**
- Modify: `src/tui/draw.ts`
- Modify: `src/tui/draw.test.ts`

- [ ] **Step 1: Write failing tests — append to `src/tui/draw.test.ts`**

```ts
test("buildFrame compact: panel section has 3 rows instead of 5", () => {
  const compact = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", compact: true, lastRefreshAt: 0 });
  const expanded = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", compact: false, lastRefreshAt: 0 });
  // compact frame should have fewer lines than expanded
  expect(compact.split("\n").length).toBeLessThan(expanded.split("\n").length);
});

test("buildFrame with detailLines null: no detail section in output", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", detailLines: null, lastRefreshAt: 0 });
  expect(frame).not.toContain("image:");
});

test("buildFrame with detailLines set: detail content appears in frame", () => {
  const frame = buildFrame({
    ...BASE_OPTS,
    mode: "IDLE",
    agentActivity: "",
    detailLines: ["  nginx  RUNNING  started 2h ago  restarts: 0", "  image: nginx:1.25  ports: 0.0.0.0:80->80/tcp"],
    lastRefreshAt: 0,
  });
  expect(frame).toContain("nginx");
  expect(frame).toContain("nginx:1.25");
});

test("buildFrame with detailLines: frame has more rows than without", () => {
  const without = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "", detailLines: null, lastRefreshAt: 0 });
  const withDetail = buildFrame({
    ...BASE_OPTS,
    mode: "IDLE",
    agentActivity: "",
    detailLines: ["  row one", "  row two"],
    lastRefreshAt: 0,
  });
  expect(withDetail.split("\n").length).toBeGreaterThan(without.split("\n").length);
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun test src/tui/draw.test.ts 2>&1 | tail -5
```

Expected: 4 new failures.

- [ ] **Step 3: Update `FrameOptions` in `src/tui/draw.ts` and update `buildFrame`**

Add to `FrameOptions` interface (new optional fields with defaults in the function):

```ts
export interface FrameOptions {
  cols: number;
  rows: number;
  systemLines: string[];
  dockerLines: string[];
  gitLines: string[];
  alerts: string[];
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
  agentActivity: string;
  scrollOffset?: number;
  timestamp: string;
  statusError?: string | null;
  // M2 additions
  detailLines?: string[] | null;
  compact?: boolean;
  lastRefreshAt?: number;
  panelErrors?: { system: boolean; docker: boolean; git: boolean };
}
```

In `buildFrame`, change `const PANEL_ROWS = 5` to:

```ts
const PANEL_ROWS = opts.compact ? 3 : 5;
```

After the alert section (after the alert bar closing border) and before the status/query section, insert the detail section when `opts.detailLines` is non-null:

```ts
  // ── Detail row (container vital signs) ───────────────────────────────────
  const detailLines = opts.detailLines ?? null;
  if (detailLines !== null && detailLines.length > 0) {
    frame += `${B.lj}${hline(innerW)}${B.rj}\n`;
    for (const dl of detailLines) {
      frame += `${B.v}${pad(dl, innerW)}${B.v}\n`;
    }
  }
```

Update the row accounting for `statusSectionRows`. The current formula is:
```ts
const alertRows = opts.alerts.length === 0 ? 1 : Math.min(opts.alerts.length, 2);
const statusSectionRows = Math.max(3, opts.rows - 12 - alertRows);
```

Add the detail row count:
```ts
const alertRows = opts.alerts.length === 0 ? 1 : Math.min(opts.alerts.length, 2);
const detailRowCount = detailLines && detailLines.length > 0 ? detailLines.length + 1 : 0;
const statusSectionRows = Math.max(3, opts.rows - 12 - alertRows - detailRowCount - (PANEL_ROWS - 5));
```

- [ ] **Step 4: Run tests**

```bash
bun test src/tui/draw.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 5: Run full suite to check no regressions**

```bash
bun test 2>&1 | tail -4
```

Expected: 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/tui/draw.ts src/tui/draw.test.ts
git commit -m "feat: add compact mode and container detail row to frame builder"
```

---

## Task 8: Frame builder — freshness badges and severity-sorted alerts

**Files:**
- Modify: `src/tui/draw.ts`
- Modify: `src/tui/draw.test.ts`

- [ ] **Step 1: Write failing tests — append to `src/tui/draw.test.ts`**

```ts
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

test("generateAlerts: critical (red ✕) appears before warnings (yellow ⚠)", () => {
  const { generateAlerts } = await import("./draw");
  const system = {
    cpu_percent: 95, mem_percent: 91,
    mem_used_gb: 14.5, mem_total_gb: 16,
    disk_used_gb: 191, disk_total_gb: 200, disk_percent: 96,
    load_avg: [1, 1, 1] as [number, number, number],
  };
  const docker = { available: false, containers: [], error: "not running" };
  const alerts = generateAlerts(system, docker);
  // disk critical should be first
  const firstStripped = strip(alerts[0] ?? "");
  expect(firstStripped).toContain("DISK CRITICAL");
});

test("buildFrame: fresh panel titles contain green dot (●)", () => {
  const frame = buildFrame({
    ...BASE_OPTS, mode: "IDLE", agentActivity: "",
    lastRefreshAt: Date.now(),
    panelErrors: { system: false, docker: false, git: false },
  });
  expect(frame).toContain("●");
});

test("buildFrame: error panel gets red dot (○)", () => {
  const frame = buildFrame({
    ...BASE_OPTS, mode: "IDLE", agentActivity: "",
    lastRefreshAt: Date.now(),
    panelErrors: { system: true, docker: false, git: false },
  });
  // The SYSTEM panel title line should contain ○
  expect(frame).toContain("○");
});

test("buildFrame: stale timestamp shows age annotation", () => {
  const staleTime = Date.now() - 15_000;
  const frame = buildFrame({
    ...BASE_OPTS, mode: "IDLE", agentActivity: "",
    lastRefreshAt: staleTime,
    panelErrors: { system: false, docker: false, git: false },
  });
  expect(strip(frame)).toMatch(/\d+s old/);
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
bun test src/tui/draw.test.ts 2>&1 | tail -5
```

Expected: 4 new failures.

- [ ] **Step 3: Update `generateAlerts` to sort by severity**

In `src/tui/draw.ts`, update `generateAlerts` to sort: red `✕` before yellow `⚠`:

```ts
export function generateAlerts(
  system: SystemMetrics | CollectorError,
  docker: DockerStatus | CollectorError,
): string[] {
  const critical: string[] = [];
  const warnings: string[] = [];

  if (!("error" in system)) {
    const m = system as SystemMetrics;
    if (m.disk_percent > 95) critical.push(`${"\x1b[31m"}✕ DISK CRITICAL ${m.disk_percent.toFixed(0)}%${A.reset}`);
    else if (m.disk_percent > 85) warnings.push(`${"\x1b[33m"}⚠ Disk ${m.disk_percent.toFixed(0)}% full${A.reset}`);
    if (m.cpu_percent > 90) warnings.push(`${"\x1b[33m"}⚠ CPU ${m.cpu_percent.toFixed(0)}% high${A.reset}`);
    if (m.mem_percent > 90) warnings.push(`${"\x1b[33m"}⚠ Memory ${Math.min(m.mem_percent, 100).toFixed(0)}% used${A.reset}`);
  }
  if (!("error" in docker)) {
    const d = docker as DockerStatus;
    if (d.available) {
      for (const c of d.containers) {
        if (c.status === "restarting") {
          warnings.push(`${"\x1b[33m"}↻ ${c.name} is restarting${A.reset}`);
        } else if (c.status === "exited" && c.exit_code !== 0) {
          critical.push(`${"\x1b[31m"}✕ ${c.name} exited (code ${c.exit_code ?? "?"})${A.reset}`);
        }
      }
    }
  }
  return [...critical, ...warnings];
}
```

- [ ] **Step 4: Add freshness badge helper and wire into `buildFrame`**

Add the helper after the `hline` function:

```ts
function freshnessDot(lastRefreshAt: number, isError: boolean): string {
  if (isError || lastRefreshAt === 0) return `${A.red}○${A.reset}`;
  const ageMs = Date.now() - lastRefreshAt;
  if (ageMs > 30_000) return `${A.red}○${A.reset}`;
  if (ageMs > 10_000) return `${A.yellow}◐${A.reset}`;
  return `${A.green}●${A.reset}`;
}
```

In `buildFrame`, add staleness annotation to the header timestamp:

```ts
  const lra = opts.lastRefreshAt ?? 0;
  const ageMs = lra > 0 ? Date.now() - lra : 0;
  const ageAnnotation = ageMs > 30_000
    ? ` ${A.red}(${Math.floor(ageMs / 1000)}s old)${A.reset}`
    : ageMs > 10_000
    ? ` ${A.yellow}(${Math.floor(ageMs / 1000)}s old)${A.reset}`
    : "";
  const ts = `${A.dim}${opts.timestamp}${A.reset}${ageAnnotation}`;
```

Add freshness dots to each panel's first line. In the panel rendering loop (the `for (let i = 0; i < PANEL_ROWS; i++)` loop), prepend dots to the title line (i === 0). Replace the existing panel loop with:

```ts
  const pe = opts.panelErrors;
  const sysDot = pe ? freshnessDot(lra, pe.system) : freshnessDot(lra, false);
  const dkDot  = pe ? freshnessDot(lra, pe.docker) : freshnessDot(lra, false);
  const gtDot  = pe ? freshnessDot(lra, pe.git)    : freshnessDot(lra, false);

  for (let i = 0; i < PANEL_ROWS; i++) {
    const lRaw = (i < sys.length ? sys[i] : undefined) ?? "";
    const mRaw = (i < doc.length ? doc[i] : undefined) ?? "";
    const rRaw = (i < git.length ? git[i] : undefined) ?? "";
    const l = i === 0 ? `${lRaw} ${sysDot}` : lRaw;
    const m = i === 0 ? `${mRaw} ${dkDot}`  : mRaw;
    const r = i === 0 ? `${rRaw} ${gtDot}`  : rRaw;
    frame += `${B.v}${pad(l, w1)}${B.v}${pad(m, w2)}${B.v}${pad(r, w3)}${B.v}\n`;
  }
```

- [ ] **Step 5: Run tests**

```bash
bun test src/tui/draw.test.ts 2>&1 | tail -5
```

Expected: all pass, 0 fail.

- [ ] **Step 6: Run full suite**

```bash
bun test 2>&1 | tail -4
```

Expected: 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/tui/draw.ts src/tui/draw.test.ts
git commit -m "feat: add freshness badges, severity-sorted alerts, and stale timestamp annotation"
```

---

## Task 9: Wire everything in `watch.ts`

**Files:**
- Modify: `src/commands/watch.ts`

- [ ] **Step 1: Read current watch.ts and make the following targeted changes**

All changes are in `src/commands/watch.ts`.

**Add imports at the top:**

```ts
import { getDockerInspect } from "../collectors/docker-inspect";
import type { ContainerInspect } from "../collectors/types";
import { renderContainerDetail } from "../tui/detail";
```

**Add state variables after `let conversationHistory: Message[] = []`:**

```ts
let lastRefreshAt = 0;
let inspectCache = new Map<string, ContainerInspect>();
let lastContainerNames: string[] = [];
```

**In `doRefresh`, after `lastCtx = await collectAll()`**, record the refresh time and invalidate inspect cache if containers changed:

```ts
lastCtx = await collectAll();
lastRefreshError = null;
lastRefreshAt = Date.now();
// Invalidate inspect cache if container set changed
const newNames = ("available" in lastCtx.docker) && (lastCtx.docker as DockerStatus).available
  ? (lastCtx.docker as DockerStatus).containers.map(c => c.name)
  : [];
const namesChanged = JSON.stringify(newNames.sort()) !== JSON.stringify([...lastContainerNames].sort());
if (namesChanged) {
  inspectCache = new Map();
  lastContainerNames = newNames;
}
```

**Update `draw` to pass new FrameOptions fields.** Replace the `buildFrame` call with:

```ts
  const dockerData = lastCtx?.docker;
  const containers = dockerData && "available" in dockerData && (dockerData as DockerStatus).available
    ? (dockerData as DockerStatus).containers
    : [];
  const panelErrors = lastCtx ? {
    system: "error" in lastCtx.system,
    docker: "error" in lastCtx.docker,
    git: "error" in lastCtx.git,
  } : { system: false, docker: false, git: false };

  const detailLines = state.selectedContainer && inspectCache.has(state.selectedContainer)
    ? renderContainerDetail(inspectCache.get(state.selectedContainer)!, state.compactMode)
    : state.selectedContainer
    ? ["  loading..."]
    : null;

  const frame = buildFrame({
    cols,
    rows,
    systemLines: lastCtx ? renderSystemPanel(lastCtx.system) : ["SYSTEM", "  collecting..."],
    dockerLines: lastCtx ? renderDockerPanel(lastCtx.docker, state.panelFocus === "docker" ? state.dockerCursor : -1) : ["DOCKER", "  collecting..."],
    gitLines:    lastCtx ? renderGitPanel(lastCtx.git)       : ["GIT",    "  collecting..."],
    alerts: lastCtx ? generateAlerts(lastCtx.system, lastCtx.docker) : [],
    mode: state.mode,
    queryInput: state.queryInput,
    aiResponse: state.aiResponse,
    agentActivity: state.agentActivity,
    scrollOffset: state.scrollOffset,
    timestamp: new Date().toLocaleTimeString(),
    statusError: lastRefreshError,
    detailLines,
    compact: state.compactMode,
    lastRefreshAt,
    panelErrors,
  });
```

**Update the keyboard handler** to pass container names to `handleKey` and trigger inspect on selection change:

```ts
  const restoreRaw = setupRawMode((key) => {
    if (state.mode === "QUERYING" && (key === "\r" || key === "\n")) {
      if (querying) return;
      const q = state.queryInput.trim();
      if (q) {
        state = { ...state, queryInput: q };
        submitQuery(q).catch(() => {});
      }
      return;
    }

    if (state.mode === "SHOWING_RESULT" && querying) {
      if (key === "q" || key === "\x03") { restoreRaw(); cleanup(0); }
      return;
    }

    const prevSelected = state.selectedContainer;
    const { state: next, action } = handleKey(state, key, lastContainerNames);
    state = next;

    // Trigger inspect fetch when a new container is selected
    if (state.selectedContainer && state.selectedContainer !== prevSelected) {
      const name = state.selectedContainer;
      if (!inspectCache.has(name)) {
        getDockerInspect(name)
          .then(inspect => { inspectCache.set(name, inspect); if (!querying) draw(); })
          .catch(() => {});
      }
    }

    // Clamp dockerCursor after container list may have shrunk
    if (state.dockerCursor >= lastContainerNames.length && lastContainerNames.length > 0) {
      state = { ...state, dockerCursor: lastContainerNames.length - 1 };
    }

    if (action === "quit") {
      restoreRaw();
      cleanup(0);
      return;
    }

    draw();
  });
```

- [ ] **Step 2: Run full test suite**

```bash
bun test 2>&1 | tail -5
```

Expected: all pass, 0 fail (watch.ts has no unit tests, changes are integration-only).

- [ ] **Step 3: Commit**

```bash
git add src/commands/watch.ts
git commit -m "feat: wire container selection, inspect cache, freshness, and compact mode into watch"
```

---

## Final Validation

- [ ] **Run full suite one last time**

```bash
bun test
```

Expected: all pass, 0 fail.

- [ ] **Update the hint line in `draw.ts`** to reflect new keybindings:

In `buildFrame`, change the `hint` const:

```ts
const hint = `${A.dim}[/] ask  [↑↓] select  [z] compact  [q] quit${A.reset}`;
```

Commit:
```bash
git add src/tui/draw.ts
git commit -m "chore: update hint line with M2 keybindings"
```

---

## Self-Review

**Spec coverage:**

| M2 feature | Task(s) | Status |
|-----------|---------|--------|
| Container selection (↑↓ + Enter) | Task 5 (state), Task 9 (watch.ts) | ✓ |
| Container detail row (full-width, option C) | Task 4 (renderer), Task 7 (draw), Task 9 (wire) | ✓ |
| Vital signs from docker inspect | Task 3 (collector), Task 9 (cache) | ✓ |
| Docker health column in panel | Task 2 (health parsing), Task 6 (panels) | ✓ |
| Severity-sorted alerts | Task 8 | ✓ |
| Freshness badges (global + per-panel) | Task 8 | ✓ |
| Compact/expanded toggle (`z`) | Task 5 (state), Task 7 (draw) | ✓ |
| Footer showing active mode + last refresh | Task 8 (stale annotation), Task 9 final step (hint) | ✓ |
| ESC two-stage (close detail then clear cursor) | Task 5 | ✓ |
| Cursor clamping on container list change | Task 9 | ✓ |
| Inspect cache invalidation on container change | Task 9 | ✓ |

**Placeholder scan:** No TBDs. All code blocks are complete. All type references are defined in earlier tasks.

**Type consistency:**
- `ContainerInspect` defined Task 1, used in Tasks 3, 4, 9. ✓
- `renderDockerPanel(data, cursor?)` — cursor default -1 means existing callers in watch.ts still work until Task 9 updates them. ✓
- `handleKey(state, key, containerNames?)` — default `[]` means all existing tests pass without modification. ✓
- `FrameOptions` new fields all optional — existing `BASE_OPTS` in draw tests needs no changes. ✓
