# Cael DevOps Agent — Implementation Spec

## Framework Selection

**Anthropic's native tool use via the existing `LLMProvider` abstraction.**

The alternatives — LangGraph, LlamaIndex, Mastra — all impose a single-provider model or a heavy abstraction that conflicts with Cael's core value proposition of being model-agnostic. The existing `runAgentLoop` already implements the correct pattern: an agentic loop that calls the provider, extracts tool calls, executes them, feeds results back, and repeats until `end_turn`. That's all you need.

For the Anthropic provider specifically, use `claude-opus-4-8` with `thinking: {type: "adaptive"}` for system analysis tasks. Adaptive thinking gives the model genuine reasoning power when diagnosing a crashed container or correlating memory pressure with a process list. On the OpenAI side, `gpt-4o` is the practical peer. For Ollama, `llama3.2` works for simple queries but will struggle with multi-step diagnostic reasoning.

Do not use Managed Agents. That surface requires Anthropic to run the agent loop server-side and provisions a remote container for tool execution. Cael's entire premise is local, low-latency, no-cloud-dependency operation.

---

## Collector Architecture

The system collectors are the substrate of everything. They become tools registered in `src/tools.ts` alongside the existing `read_file`, `write_file`, `run_shell`, `list_dir`.

### Tool Definitions

**`get_system_metrics`** — returns: `{ cpu_percent: number, mem_used_gb: number, mem_total_gb: number, mem_percent: number, disk_used_gb: number, disk_total_gb: number, disk_percent: number, load_avg: [number, number, number] }`

**`get_docker_status`** — returns: `{ available: boolean, error?: string, containers: Array<{ name: string, status: "running"|"exited"|"paused"|"restarting", health?: "healthy"|"unhealthy"|"starting", image: string, uptime?: string, exit_code?: number, ports: string[] }> }`

**`get_docker_logs`** — params: `{ container: string, lines?: number, since?: string }` — returns: `{ logs: string, truncated: boolean }`

**`get_git_status`** — returns: `{ is_git_repo: boolean, branch?: string, dirty_files?: number, unpushed_commits?: number, untracked_files?: number, stash_count?: number, last_commit_message?: string, last_commit_hash?: string }`

**`get_process_list`** — params: `{ sort_by?: "cpu"|"mem", limit?: number }` — returns: `{ processes: Array<{ pid: number, name: string, cpu_percent: number, mem_mb: number, user: string, command: string }> }`

### File Structure

```
src/
  collectors/
    system.ts
    docker.ts
    git.ts
    process.ts
    index.ts       // collectAll(): parallel Promise.allSettled with timeouts
  tui/
    dashboard.ts
    input.ts
    panels.ts
  commands/
    ask.ts
    watch.ts
    deploy-check.ts
    postmortem.ts
  tools.ts         // extend with collector tools
  agent.ts         // existing — add maxIterations, error recovery
  providers/       // existing
index.ts           // extend with subcommand routing
```

---

## Cross-Platform Collector Implementation

This is the single biggest engineering risk. macOS and Linux have fundamentally different system APIs and shell commands.

### Architecture Pattern

Extract platform-specific raw parsers as **pure functions** that accept command output as a string and return a normalized object. The shell invocation is thin; all logic lives in the parser. This makes cross-platform testing tractable — test the Linux parser against fixture strings captured from a Linux machine without needing to run the tests on Linux.

### CPU and Memory

Linux uses `/proc/meminfo` and `/proc/stat`. macOS uses `vm_stat` and `sysctl`. These produce completely different output formats.

For CPU on Linux, read `/proc/stat`, take two samples 500ms apart, compute the delta. On macOS, parse `top -l2 -stats cpu` output (the first sample from `top -l1` is unreliable).

For memory on macOS: `vm_stat` gives pages. Multiply by `sysctl -n hw.pagesize` to get bytes. On Linux: parse `MemTotal` and `MemAvailable` from `/proc/meminfo`; used = total - available.

### Disk

Use `df -k .` (kilobytes) for machine-parseable output. Report the filesystem for the current working directory, not all filesystems.

### Docker

`docker info` returns exit code 1 when the daemon isn't running. Catch this explicitly and return `{ available: false, error: "Docker daemon not running" }`. The AI needs to reason about Docker being unavailable, not crash.

For container list: `docker ps -a --format json` on newer Docker versions; fall back to tab-separated `--format` flags for older versions. A container with status "Exited (1) 3 minutes ago" maps to `status: "exited", exit_code: 1`.

For logs: always pass `--tail` to bound output. Default to 100 lines. If the log exceeds 10KB after collection, truncate and set `truncated: true`.

### Git

Before running any git commands, check `git rev-parse --is-inside-work-tree 2>/dev/null`. If it exits non-zero, return `{ is_git_repo: false }`.

For unpushed commits: `git rev-list @{u}.. --count 2>/dev/null`. If the branch has no upstream, this command errors — report `unpushed_commits: null` (unknown), not 0.

### Process List

Linux: `ps aux --sort=-%cpu`. macOS: `ps aux -r`. The command column is everything after the fixed columns — handle commands with spaces.

---

## Context Injection Strategy

Every subcommand must collect a full snapshot upfront and inject it into the system prompt. Also register all collector tools. The snapshot gives the AI instant global context; the tools let it drill into specifics.

Without the upfront snapshot, the AI's first response is always "let me check the metrics" and then calls five tools in sequence. With the snapshot, the AI immediately has the full picture and can answer with a single targeted tool call for logs.

Collect with `Promise.allSettled` (not `Promise.all`) so partial failures don't prevent answering. Each collector runs with a 5-second timeout.

### System Prompt Template

```
You are Cael, a local DevOps agent analyzing live system state. You have access to tools that collect real-time metrics from this machine. Never fabricate or estimate metrics — use the tools if the data isn't in your snapshot.

Live snapshot collected at {ISO_TIMESTAMP}:

SYSTEM METRICS:
{system_metrics_formatted}

DOCKER CONTAINERS:
{docker_status_formatted}

GIT STATUS ({cwd}):
{git_status_formatted}

TOP PROCESSES (by CPU):
{process_list_formatted}

If the snapshot data is insufficient to answer the question, use your tools to get more detail — especially get_docker_logs for container issues.
```

---

## Subcommand Specs

### `cael ask <question>`

Parse the first positional argument after `--provider` and its value. If it equals `ask`, the remainder is the question. Wire into `index.ts`'s routing before the existing REPL fallback.

Edge cases:
- Empty question after `ask`: print usage and exit 1
- Network failure mid-agent-loop: catch provider errors, print friendly message, exit 1

### `cael watch`

**State machine:**
- `IDLE` — collecting metrics every 5 seconds (configurable), rendering dashboard
- `QUERYING` — user pressed `/`, typed question, AI is responding
- `SHOWING_RESULT` — AI result displayed in bottom panel, waiting for any key to return to IDLE

**Dashboard layout:**

```
╔════════════════════════════════════════════════════╗
║  cael watch                              [q] quit  ║
╠══════════════╦═════════════════╦══════════════════╣
║  SYSTEM      ║  DOCKER         ║  GIT             ║
║  CPU  47%    ║  ● api       UP ║  branch: main    ║
║  MEM  6.2GB  ║  ● db        UP ║  ↑2 unpushed     ║
║  DISK 78%    ║  ✕ worker  DOWN ║  3 files dirty   ║
╠══════════════╩═════════════════╩══════════════════╣
║  ⚠ worker container exited 4 min ago             ║
║  Press / to ask Cael a question    [q] quit       ║
╚═══════════════════════════════════════════════════╝
```

**TUI architecture: raw ANSI for MVP.** Zero dependencies, works in any terminal, full cursor control. Ink (React for terminal) adds 200+ deps and a build step — use as an upgrade path if needed.

Use `\x1b[2J\x1b[H` to clear and home the cursor on each render. Everything goes through a single `drawFrame(content)` function.

**Raw mode** (`process.stdin.setRawMode(true)`) is required for instant `/` keypress detection. Always register cleanup handlers:

```typescript
const cleanup = () => {
  process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?25h'); // show cursor
  process.exit(0);
};
process.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

**Terminal resize**: listen to `process.stdout.on('resize', () => { clearAndRedraw(); })`. Without this, resizing corrupts the layout permanently.

**Streaming vs refresh conflict**: use an `isQuerying: boolean` flag. When the AI is streaming a response, pause the 5-second refresh timer. Without this, the refresh overwrites the partial stream output.

**Streaming in TUI**: use `provider.stream()` and accumulate into a panel buffer. On each chunk, update the AI panel and redraw only that panel (not the full frame) to avoid flicker.

### `cael deploy-check`

Produces a scored, go/no-go assessment. Score calculation is deterministic; AI writes the narrative only.

**Scoring rubric:**
- CPU < 70%: 20 pts (< 50%: full 20; 70-85%: 10 pts; > 85%: 0 pts)
- Memory < 80%: 20 pts
- Disk < 85%: 20 pts (> 95%: hard block — always no-go regardless of score)
- All Docker containers UP: 20 pts (any container exited with non-zero: 0 pts)
- Git: no dirty files + no unpushed commits: 20 pts (one or the other: 10 pts)

Hard blocks: disk > 95%, any container in restarting loop.

**Output format:**
```
Deploy Check — 2026-06-17 14:32:01
─────────────────────────────────
Score: 75/100 — ⚠ CAUTION

CPU ................. 47% ✓ (20/20)
Memory .............. 71% ✓ (20/20)
Disk ................ 78% ✓ (20/20)
Docker .............. 2/3 UP ✗ (0/20)  worker: Exited (1)
Git ................. 2 unpushed ✗ (10/20)

Assessment:
[AI-generated narrative paragraph]
```

### `cael postmortem`

Invocation: `cael postmortem [--container <name>] [--since <duration>]`

Time parsing: support `30m`, `2h`, `1d`. Map to Docker's `--since` flag format. Also accept ISO timestamps. Invalid format: print error and exit 1.

Collects:
- Docker logs for the specified container since the given time
- `git log --oneline -20` for recent deployment history
- `git show --stat HEAD` for last commit details
- Current system metrics and process list

AI prompt: "Given the following system state, container logs, and recent git history, draft a concise incident postmortem. Include: what happened, likely root cause, contributing factors, timeline, and recommended action items."

If `--output <file>` is specified, write markdown to that file.

---

## AI Reliability Engineering

### Iteration Cap

Add `maxIterations = 20` to `runAgentLoop`. After hitting the cap, return whatever text has accumulated plus: `"[Cael: reached maximum iterations without completing analysis]"`.

### Tool Execution Timeout

Wrap every shell execution in a race against a 10-second timeout:

```typescript
const result = await Promise.race([
  Bun.$`docker logs ${container} --tail 100`.text(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Tool execution timed out after 10s")), 10_000)
  )
]);
```

### Tool Error Recovery

Catch all tool errors and return them as tool_result content with `is_error: true`. This is the Anthropic spec for error handling in tool use. The AI then reasons about the failure rather than the loop crashing.

### Context Length Management

After many tool calls with large log outputs, the conversation history grows. Track approximate token count (`characters / 4`). After ~150K estimated tokens, summarize old tool_use/tool_result pairs into a single summary text block to prevent context overflow.

### OpenAI Multi-Turn Fix (pending)

The OpenAI provider breaks on multi-turn tool calls. The Anthropic internal format uses `tool_use` blocks and `tool_result` blocks. OpenAI's wire format uses `tool_calls` on the assistant message and `role: "tool"` result messages. The OpenAI provider's `chat()` method needs to translate before calling the API and translate the response back.

---

## Testing Strategy (TDD with bun test)

### Collector Tests

Each collector's parsing logic is a pure function. Test the pure functions with captured fixture strings.

```typescript
test("parses Linux /proc/meminfo output", () => {
  const fixture = `MemTotal:       16384000 kB\nMemAvailable:   8192000 kB\n`;
  const result = parseLinuxMemInfo(fixture);
  expect(result.mem_total_gb).toBeCloseTo(16.384);
  expect(result.mem_used_gb).toBeCloseTo(8.192);
});
```

Commit fixture strings to `src/collectors/__fixtures__/` (captured from each real platform).

Test all error states:
- Docker daemon not running → `{ available: false, error: "..." }`
- Not a git repo → `{ is_git_repo: false }`
- Collector timeout → `{ error: "timeout" }`
- Empty process list → `{ processes: [] }`

### Agent Loop Tests

```typescript
test("runAgentLoop respects maxIterations cap", async () => {
  let calls = 0;
  const mockProvider = { name: "mock", chat: async () => {
    calls++;
    return { text: "", toolCalls: [{id: `t${calls}`, name: "list_dir", input: {path: "."}}], stopReason: "tool_use" };
  }};
  const result = await runAgentLoop(mockProvider, [{role: "user", content: "go"}], { maxIterations: 3 });
  expect(calls).toBe(3);
  expect(result).toContain("reached maximum iterations");
});
```

Also test: tool execution error returns `is_error: true` rather than throwing.

### Deploy-Check Score Tests

The scoring function is pure — no AI involved:

```typescript
test("disk > 95% is always hard block", () => {
  const result = calculateDeployScore({...metrics, disk_percent: 97}, docker, git);
  expect(result.go_no_go).toBe("NO-GO");
  expect(result.hard_block).toBe("disk");
});
```

### TUI Tests

Focus on pure render functions:
- `renderSystemPanel(metrics)` returns string containing the CPU percentage
- `formatUptime("Up 3 hours, 22 minutes")` returns expected human-readable form
- State transitions: IDLE → QUERYING → SHOWING_RESULT → IDLE

---

## Critical Risks

1. **Cross-platform collector divergence** — macOS and Linux differ at every level. The pure-function parser architecture with committed fixture strings is the mitigation. Without it, bugs only appear in one environment and are impossible to reproduce in CI.

2. **Terminal state corruption** — A crash during raw mode leaves the user's terminal broken (no echo, no line buffering). The cleanup handlers on `exit`, `SIGINT`, and `SIGTERM` are non-negotiable.

3. **AI hallucinating metrics** — Without the "never fabricate metrics" instruction in the system prompt, the model will invent CPU percentages and container states. Especially likely when collectors fail and the AI gets partial data.

4. **Docker socket permissions** — On Linux, the user must be in the `docker` group. If `docker info` fails with a permissions error (not "daemon not running"), surface a distinct error: `"Docker is installed but you don't have permission to access the socket. Try: sudo usermod -aG docker $USER"`.

5. **Streaming vs refresh conflict in watch** — The most complex interaction in the codebase. The `isQuerying` flag that pauses the timer is essential. Test specifically: start a stream, trigger a timer tick, verify stream output is not overwritten.

6. **Long log outputs** — A high-traffic container with `--tail 100` can still produce 500KB if each line is a large JSON blob. Always truncate `get_docker_logs` at 10KB maximum and set `truncated: true`.

---

## Implementation Order

**Phase 1 — Collectors + `cael ask`**
Implement collector pure functions with platform parsers. Commit fixture files. Write failing tests first. Register as tools. Wire `cael ask` subcommand. Verify end-to-end with a real API call.

**Phase 2 — `cael deploy-check` + agent reliability**
Implement scoring function with tests. Fix OpenAI multi-turn tool call format. Add `maxIterations` and tool timeout to agent loop.

**Phase 3 — `cael postmortem`**
Time parsing for `--since` flag. Multi-collector assembly for incident context. AI prompt for postmortem format.

**Phase 4 — `cael watch` TUI**
Raw mode setup and cleanup. ANSI panel layout. Render loop with state machine. Keyboard input. Streaming AI response integration. Terminal resize handling.
