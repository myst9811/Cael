# M2: Watch as an Incident Cockpit — Design Spec

## Goal

Upgrade `cael watch` from a static dashboard into an interactive incident cockpit: containers are selectable (showing vital signs on demand), alerts are severity-sorted, data freshness is visible at a glance, and the layout can be compacted for small terminals.

## Approach

Extend the existing state machine and frame builder in-place (Approach A). No new rendering paradigm — new fields are added to `WatchState`, `handleKey` gains new cases, `buildFrame` gains new `FrameOptions`, and two new files handle docker inspect and container detail rendering. All other files are modified minimally.

---

## State & Key Bindings

### New `WatchState` fields

```ts
dockerCursor: number           // index into container list; -1 = nothing highlighted
panelFocus: "docker" | null    // which panel currently has arrow-key focus
selectedContainer: string | null  // name of container whose detail row is open
compactMode: boolean           // user-toggled compact layout
```

`createWatchState` initialises: `dockerCursor: -1`, `panelFocus: null`, `selectedContainer: null`, `compactMode: false`.

### Key bindings (mode-dependent)

| Key | IDLE | SHOWING_RESULT | QUERYING |
|-----|------|----------------|---------|
| `↑` / `↓` | moves `dockerCursor`; activates docker focus on first press if containers exist | scrolls AI response (unchanged) | — |
| `Enter` | opens detail row for highlighted container; closes it if already open | — | submits query (unchanged) |
| `ESC` | if detail open → close detail first; else clear cursor | clears AI pane (unchanged) | cancels query (unchanged) |
| `z` | toggles `compactMode` | toggles `compactMode` | — |
| `/` | enters QUERYING (unchanged) | enters QUERYING (unchanged) | — |
| `q` / Ctrl+C | quit (unchanged) | quit (unchanged) | — |

Arrow keys in IDLE set `panelFocus: "docker"` on first press and move `dockerCursor`. When no containers are available `dockerCursor` stays at -1 and arrow keys are no-ops.

---

## New Files

### `src/collectors/docker-inspect.ts`

Fetches vital signs for a single container via `docker inspect --format '{{json .}}'`.

**`ContainerInspect` type** (added to `src/collectors/types.ts`):

```ts
interface ContainerInspect {
  name: string
  status: string          // "running" | "exited" | "paused" | "restarting"
  startedAt: string       // ISO 8601 timestamp
  finishedAt: string      // ISO 8601 timestamp; zero value "0001-01-01T00:00:00Z" if running
  restartCount: number
  exitCode: number
  image: string
  ports: string[]         // ["8080/tcp -> 0.0.0.0:8080", ...]
}
```

**`getDockerInspect(name: string): Promise<ContainerInspect>`** — runs `docker inspect --format '{{json .}}'`, parses `State`, `Config`, `NetworkSettings.Ports`, and `Name` fields. Throws on docker error or non-zero exit.

Called only when a container is selected (not on every 5s refresh). The result is cached in `watch.ts` in a `Map<string, ContainerInspect>` keyed by container name. Cache is invalidated when the container list changes on the next refresh (detected by comparing container name sets).

### `src/tui/detail.ts`

Pure renderer with no I/O.

**`renderContainerDetail(inspect: ContainerInspect, compact: boolean): string[]`**

- **Expanded (2 lines):**
  ```
    nginx   RUNNING  started 2h 14m ago   restarts: 0   exit: —
    image: nginx:1.25   ports: 443→0.0.0.0:443, 80→0.0.0.0:80
  ```
- **Compact (1 line):**
  ```
    nginx  RUNNING  2h 14m  restarts:0  nginx:1.25  443→:443 80→:80
  ```

Uses a helper `formatUptime(startedAt: string): string` that converts an ISO timestamp to a human-readable duration (`2h 14m ago`, `just now`, `stopped 5m ago`).

---

## Modified Files

### `src/collectors/types.ts`

Add `health?: "healthy" | "unhealthy" | "none"` to `DockerContainer`. Add `ContainerInspect` type (defined above).

### `src/collectors/docker.ts`

Parse health from the `Status` string in `docker ps` output. e.g. `"Up 2 hours (healthy)"` → `"healthy"`, `"Up 5 minutes (unhealthy)"` → `"unhealthy"`, `"Up 3 days"` → `"none"`.

### `src/tui/panels.ts`

**`renderDockerPanel(data, cursor: number)`** — new `cursor` parameter (default -1).

- Highlighted row (`i === cursor`) is wrapped in reverse-video: `\x1b[7m...\x1b[0m`
- A fourth column `HELTH` / `UNHLT` / dim `NONE` (5 chars) is added after the status column when `health` is present

### `src/tui/draw.ts`

**`FrameOptions` additions:**

```ts
detailLines: string[] | null   // null = no container selected; non-null = insert detail row
compact: boolean               // compact mode reduces PANEL_ROWS from 5 → 3
lastRefreshAt: number          // Date.now() of last successful collectAll()
```

**`PANEL_ROWS`** becomes `compact ? 3 : 5`.

**Detail row** — inserted between the alert bar and the AI/status section when `detailLines` is non-null:

```
╠══════════════════════════════════════════════════════════════╣
║  nginx   RUNNING  started 2h 14m ago   restarts: 0  ...     ║
╠══════════════════════════════════════════════════════════════╣
```

Height: `detailLines.length` rows (1 in compact, 2 in expanded). When `detailLines` is null the section is entirely absent (zero rows, no borders).

**Freshness badges** — panel title freshness dot, computed from `lastRefreshAt` and whether the panel data is a `CollectorError`:

| Condition | Dot | Color |
|-----------|-----|-------|
| < 10s since refresh, no error | `●` | green |
| 10–30s since refresh | `◐` | yellow |
| > 30s since refresh, or panel is error | `○` | red |

Panel titles become e.g. `SYSTEM ●` / `DOCKER ◐` / `GIT ○`.

Header timestamp gains staleness annotation: `12:34:56` normally; `12:34:56 (15s old)` in yellow if >10s; red if >30s.

**`generateAlerts`** — sorted before returning: red `✕` critical entries first, then yellow `⚠` warnings. Max 2 shown (unchanged), but now always shows the most severe pair.

### `src/tui/state.ts`

`handleKey` extended with new cases as specified in the Key Bindings section. No changes to `WatchMode` type — the new features work within IDLE / QUERYING / SHOWING_RESULT.

### `src/commands/watch.ts`

Three additions:

1. **`lastRefreshAt: number`** — set to `Date.now()` after each successful `collectAll()`. Passed to `buildFrame`.

2. **`inspectCache: Map<string, ContainerInspect>`** — populated by calling `getDockerInspect(name)` when `state.selectedContainer` changes to a non-null value. Invalidated (cleared) when the set of container names changes between refreshes. The detail row shows `["  loading..."]` while the inspect call is in-flight.

3. **`dockerCursor` clamping** — after each refresh, clamp `dockerCursor` to `Math.min(cursor, containers.length - 1)` so it stays valid if containers disappear.

---

## Testing

- **`src/collectors/docker-inspect.test.ts`** — fixture-based: mock `Bun.spawn` output for a healthy running container and a stopped container; verify `ContainerInspect` fields parse correctly.
- **`src/tui/detail.test.ts`** — unit test `renderContainerDetail` for expanded and compact output; test `formatUptime` boundary values.
- **`src/tui/state.test.ts`** — extend existing tests: arrow key navigation, Enter to open/close detail, ESC two-stage behaviour, `z` toggle.
- **`src/tui/draw.test.ts`** — extend existing tests: frame with `detailLines: null` unchanged, frame with `detailLines` non-null inserts the detail section, `compact: true` reduces panel rows.
- **`src/tui/panels.test.ts`** — extend: cursor highlight at index 0, 1, last; health column rendering for each health value.
- **`src/collectors/docker.test.ts`** — extend: health parsing from status strings.

---

## What is NOT in M2

- Log preview in the detail row (deferred to M3)
- Health check history (deferred to M3)
- Per-panel independent refresh rates
- Mouse support
