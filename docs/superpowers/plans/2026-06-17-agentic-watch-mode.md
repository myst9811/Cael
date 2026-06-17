# Agentic Watch Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot LLM call in `cael watch` with a full agent loop that can call tools (process list, docker logs, shell, etc.) and maintain conversation history across queries.

**Architecture:** A new `src/commands/watch-agent.ts` module exports `runWatchAgentLoop` — an agent loop that streams text tokens and executes tools, returning the updated `Message[]` for history persistence. `watch.ts` owns the history array, wires callbacks, and guards dismiss keys while the loop is running.

**Tech Stack:** Bun, TypeScript, existing `LLMProvider` interface, existing `executeToolWithTimeout` from `src/tools.ts`

---

## File Map

| File | Change |
|------|--------|
| `src/tools.ts` | Extract 4 named tool constants; add `watchTools` export (no `write_file`); export `MAX_TOOL_RESULT_CHARS = 10_000` |
| `src/tui/state.ts` | Add `agentActivity: string` to `WatchState`; initialise to `""` in `createWatchState` |
| `src/tui/draw.ts` | Add `agentActivity: string` to `FrameOptions`; render it as the row before dismiss in `SHOWING_RESULT` |
| `src/commands/watch-agent.ts` | **New** — `runWatchAgentLoop` with streaming, tool execution, history management |
| `src/commands/watch.ts` | Import new module; add `conversationHistory`; rewrite `submitQuery`; add dismiss guard |
| `src/tools.test.ts` | Add tests for `watchTools` and `MAX_TOOL_RESULT_CHARS` |
| `src/tui/state.test.ts` | Add test for `agentActivity` in initial state |
| `src/tui/draw.test.ts` | **New** — tests for `agentActivity` rendering and frame height consistency |
| `src/commands/watch-agent.test.ts` | **New** — full unit test suite for `runWatchAgentLoop` |

---

## Task 1: Export `watchTools` and `MAX_TOOL_RESULT_CHARS` from `tools.ts`

**Files:**
- Modify: `src/tools.ts:68-108`
- Modify: `src/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the end of `src/tools.test.ts`:

```typescript
import { watchTools, tools, MAX_TOOL_RESULT_CHARS } from "./tools";

test("MAX_TOOL_RESULT_CHARS is 10000", () => {
  expect(MAX_TOOL_RESULT_CHARS).toBe(10_000);
});

test("watchTools does not include write_file", () => {
  expect(watchTools.find(t => t.name === "write_file")).toBeUndefined();
});

test("watchTools includes all collector tools", () => {
  const names = watchTools.map(t => t.name);
  for (const n of ["get_system_metrics", "get_docker_status", "get_docker_logs", "get_git_status", "get_process_list"]) {
    expect(names).toContain(n);
  }
});

test("watchTools includes read-only code tools", () => {
  const names = watchTools.map(t => t.name);
  for (const n of ["read_file", "run_shell", "list_dir"]) {
    expect(names).toContain(n);
  }
});

test("tools (full set) still includes write_file", () => {
  expect(tools.find(t => t.name === "write_file")).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/tools.test.ts
```

Expected: 5 new tests fail with `Cannot find name 'watchTools'` / `Cannot find name 'MAX_TOOL_RESULT_CHARS'`.

- [ ] **Step 3: Refactor `codeTools` into named constants and add exports**

Replace the `codeTools` block in `src/tools.ts` (lines 68–108) with:

```typescript
export const MAX_TOOL_RESULT_CHARS = 10_000;

const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read a file's contents from disk",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Path to the file" } },
    required: ["path"],
  },
};

const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file on disk",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to write to" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
};

const runShellTool: ToolDefinition = {
  name: "run_shell",
  description: "Execute a shell command and return stdout. Commands run directly (no shell), so pipes and redirects are not supported — use individual commands.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string", description: "Command to run (e.g. 'git status' or 'ls -la')" } },
    required: ["command"],
  },
};

const listDirTool: ToolDefinition = {
  name: "list_dir",
  description: "List files and folders in a directory",
  input_schema: {
    type: "object",
    properties: { path: { type: "string", description: "Directory path (defaults to .)" } },
    required: [],
  },
};

const codeTools: ToolDefinition[] = [readFileTool, writeFileTool, runShellTool, listDirTool];

export const watchTools: ToolDefinition[] = [
  readFileTool,
  runShellTool,
  listDirTool,
  ...collectorTools,
  // write_file intentionally excluded
];
```

The existing `export const tools: ToolDefinition[] = [...codeTools, ...collectorTools];` line stays unchanged.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/tools.test.ts
```

Expected: all tests pass including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts src/tools.test.ts
git commit -m "feat: add watchTools and MAX_TOOL_RESULT_CHARS to tools.ts"
```

---

## Task 2: Add `agentActivity` to TUI state and draw

**Files:**
- Modify: `src/tui/state.ts`
- Modify: `src/tui/state.test.ts`
- Modify: `src/tui/draw.ts`
- Create: `src/tui/draw.test.ts`

- [ ] **Step 1: Write failing state test**

Add to the end of `src/tui/state.test.ts`:

```typescript
test("createWatchState initialises agentActivity to empty string", () => {
  expect(createWatchState().agentActivity).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test src/tui/state.test.ts
```

Expected: new test fails with `Property 'agentActivity' does not exist`.

- [ ] **Step 3: Add `agentActivity` to `WatchState`**

In `src/tui/state.ts`, replace:

```typescript
export interface WatchState {
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
}

export function createWatchState(): WatchState {
  return { mode: "IDLE", queryInput: "", aiResponse: "" };
}
```

with:

```typescript
export interface WatchState {
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
  agentActivity: string;
}

export function createWatchState(): WatchState {
  return { mode: "IDLE", queryInput: "", aiResponse: "", agentActivity: "" };
}
```

- [ ] **Step 4: Run state test to verify it passes**

```bash
bun test src/tui/state.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Write failing draw tests**

Create `src/tui/draw.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { buildFrame } from "./draw";

const BASE_OPTS = {
  cols: 80,
  rows: 24,
  systemLines: ["SYSTEM", "  cpu 5%"],
  dockerLines: ["DOCKER", "  unavailable"],
  gitLines: ["GIT", "  main"],
  alerts: [],
  timestamp: "12:00:00",
  queryInput: "what is using memory?",
  aiResponse: "The top consumer is Bun.",
  statusError: null,
};

test("buildFrame SHOWING_RESULT renders agentActivity on row before dismiss", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "⟳ calling get_process_list..." });
  const lines = frame.split("\n");
  const dismissIdx = lines.findIndex(l => l.includes("any key to dismiss"));
  const activityIdx = lines.findIndex(l => l.includes("calling get_process_list"));
  expect(activityIdx).toBeGreaterThan(-1);
  expect(activityIdx).toBe(dismissIdx - 1);
});

test("buildFrame SHOWING_RESULT blank activity row when agentActivity is empty", () => {
  const frame = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  // The dismiss line should still appear
  expect(frame).toContain("any key to dismiss");
});

test("buildFrame SHOWING_RESULT same line count with and without agentActivity", () => {
  const withActivity = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "⟳ calling X..." });
  const withoutActivity = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  expect(withActivity.split("\n").length).toBe(withoutActivity.split("\n").length);
});

test("buildFrame IDLE same line count as SHOWING_RESULT", () => {
  const idle = buildFrame({ ...BASE_OPTS, mode: "IDLE", agentActivity: "" });
  const showing = buildFrame({ ...BASE_OPTS, mode: "SHOWING_RESULT", agentActivity: "" });
  expect(idle.split("\n").length).toBe(showing.split("\n").length);
});
```

- [ ] **Step 6: Run draw tests to verify they fail**

```bash
bun test src/tui/draw.test.ts
```

Expected: tests fail — `agentActivity` is not in `FrameOptions`, `buildFrame` doesn't accept it.

- [ ] **Step 7: Add `agentActivity` to `FrameOptions` in `draw.ts`**

In `src/tui/draw.ts`, in the `FrameOptions` interface, add:

```typescript
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
  agentActivity: string;   // ← add this line
  timestamp: string;
  statusError?: string | null;
}
```

- [ ] **Step 8: Update `SHOWING_RESULT` rendering in `buildFrame`**

In `src/tui/draw.ts`, inside `buildFrame`, find the `SHOWING_RESULT` block. Replace this section:

```typescript
    const visible = responseLines.length <= responseContentRows
      ? [...responseLines, ...Array<string>(responseContentRows - responseLines.length).fill("")]
      : responseLines.slice(-responseContentRows);
    for (const rl of visible) {
      frame += `${B.v}${pad(`  ${rl}`, innerW)}${B.v}\n`;
    }
    frame += `${B.v}${pad(`  ${A.dim}[any key to dismiss]${A.reset}`, innerW)}${B.v}\n`;
```

with:

```typescript
    // Reserve one row for agentActivity when there's room (responseContentRows >= 2).
    const hasActivityRow = responseContentRows >= 2;
    const visibleResponseRows = hasActivityRow ? responseContentRows - 1 : responseContentRows;
    const visible = responseLines.length <= visibleResponseRows
      ? [...responseLines, ...Array<string>(visibleResponseRows - responseLines.length).fill("")]
      : responseLines.slice(-visibleResponseRows);
    for (const rl of visible) {
      frame += `${B.v}${pad(`  ${rl}`, innerW)}${B.v}\n`;
    }
    if (hasActivityRow) {
      const activityText = opts.agentActivity
        ? `  ${A.dim}${opts.agentActivity}${A.reset}`
        : "";
      frame += `${B.v}${pad(activityText, innerW)}${B.v}\n`;
    }
    frame += `${B.v}${pad(`  ${A.dim}[any key to dismiss]${A.reset}`, innerW)}${B.v}\n`;
```

- [ ] **Step 9: Run draw tests to verify they pass**

```bash
bun test src/tui/draw.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 10: Run full test suite to confirm no regressions**

```bash
bun test
```

Expected: all tests pass (number increases by 6 new tests).

- [ ] **Step 11: Commit**

```bash
git add src/tui/state.ts src/tui/state.test.ts src/tui/draw.ts src/tui/draw.test.ts
git commit -m "feat: add agentActivity to WatchState and draw frame"
```

---

## Task 3: Implement `watch-agent.ts`

**Files:**
- Create: `src/commands/watch-agent.ts`
- Create: `src/commands/watch-agent.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/commands/watch-agent.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { runWatchAgentLoop } from "./watch-agent";
import type { LLMProvider, ToolDefinition, ProviderResponse } from "../providers/types";

const noTools: ToolDefinition[] = [];
const SYS = "You are Cael.";

// ── Mock provider helpers ────────────────────────────────────────────────────

function mockProvider(responses: Partial<ProviderResponse>[]): LLMProvider {
  let i = 0;
  const next = (): ProviderResponse => {
    const r = responses[i++] ?? { text: "", toolCalls: [], stopReason: "end_turn" };
    return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], stopReason: r.stopReason ?? "end_turn" } as ProviderResponse;
  };
  return {
    name: "mock",
    chat: async () => next(),
  };
}

function mockStreamingProvider(responses: Partial<ProviderResponse>[]): LLMProvider {
  let i = 0;
  const next = (): ProviderResponse => {
    const r = responses[i++] ?? { text: "", toolCalls: [], stopReason: "end_turn" };
    return { text: r.text ?? "", toolCalls: r.toolCalls ?? [], stopReason: r.stopReason ?? "end_turn" } as ProviderResponse;
  };
  return {
    name: "mock-stream",
    chat: async () => ({ text: "", toolCalls: [], stopReason: "end_turn" }),
    stream: async (_msgs, _tools, onChunk) => {
      const r = next();
      for (const ch of r.text) onChunk(ch);
      return r;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("end_turn immediately: returns history with assistant message", async () => {
  const chunks: string[] = [];
  const history = [{ role: "user" as const, content: "what is memory?" }];
  const result = await runWatchAgentLoop(
    mockStreamingProvider([{ text: "Memory is 15GB.", stopReason: "end_turn" }]),
    history, noTools, SYS,
    { onChunk: c => chunks.push(c), onToolCall: () => {} }
  );
  expect(result).toHaveLength(2);
  expect(result[1]).toMatchObject({ role: "assistant", content: "Memory is 15GB." });
  expect(chunks.join("")).toBe("Memory is 15GB.");
});

test("falls back to provider.chat when stream is undefined", async () => {
  const history = [{ role: "user" as const, content: "q" }];
  const result = await runWatchAgentLoop(
    mockProvider([{ text: "answer via chat", stopReason: "end_turn" }]),
    history, noTools, SYS,
    { onChunk: () => {}, onToolCall: () => {} }
  );
  expect(result[1]).toMatchObject({ role: "assistant", content: "answer via chat" });
});

test("tool call: executes tool, appends tool_result, loops to end_turn", async () => {
  const toolsCalled: string[] = [];
  const mockExecute = async (name: string) => `output of ${name}`;

  const result = await runWatchAgentLoop(
    mockStreamingProvider([
      { text: "", toolCalls: [{ id: "tc1", name: "get_process_list", input: {} }], stopReason: "tool_use" },
      { text: "Top process is Bun.", stopReason: "end_turn" },
    ]),
    [{ role: "user" as const, content: "what uses CPU?" }],
    noTools, SYS,
    { onChunk: () => {}, onToolCall: n => toolsCalled.push(n) },
    10,
    mockExecute
  );

  // history: user, assistant(tool_use), user(tool_result), assistant(final)
  expect(result).toHaveLength(4);
  expect(toolsCalled).toContain("get_process_list");

  const toolResultMsg = result[2]!;
  expect(toolResultMsg.role).toBe("user");
  const content = Array.isArray(toolResultMsg.content) ? toolResultMsg.content : [];
  expect(content[0]).toMatchObject({ type: "tool_result", tool_use_id: "tc1", content: "output of get_process_list" });

  expect(result[3]).toMatchObject({ role: "assistant", content: "Top process is Bun." });
});

test("tool execution error becomes is_error tool_result (loop continues)", async () => {
  const mockExecute = async () => { throw new Error("permission denied"); };

  const result = await runWatchAgentLoop(
    mockStreamingProvider([
      { text: "", toolCalls: [{ id: "tc1", name: "read_file", input: { path: "/etc/secret" } }], stopReason: "tool_use" },
      { text: "Could not read that file.", stopReason: "end_turn" },
    ]),
    [{ role: "user" as const, content: "show /etc/secret" }],
    noTools, SYS,
    { onChunk: () => {}, onToolCall: () => {} },
    10,
    mockExecute
  );

  const toolResultMsg = result[2]!;
  const content = Array.isArray(toolResultMsg.content) ? toolResultMsg.content : [];
  expect(content[0]).toMatchObject({ type: "tool_result", is_error: true, content: "permission denied" });
});

test("large tool output is truncated to MAX_TOOL_RESULT_CHARS", async () => {
  const bigOutput = "x".repeat(15_000);
  const mockExecute = async () => bigOutput;

  const result = await runWatchAgentLoop(
    mockStreamingProvider([
      { text: "", toolCalls: [{ id: "tc1", name: "run_shell", input: { command: "cat big.log" } }], stopReason: "tool_use" },
      { text: "done", stopReason: "end_turn" },
    ]),
    [{ role: "user" as const, content: "show logs" }],
    noTools, SYS,
    { onChunk: () => {}, onToolCall: () => {} },
    10,
    mockExecute
  );

  const toolResultMsg = result[2]!;
  const content = Array.isArray(toolResultMsg.content) ? toolResultMsg.content : [];
  const stored = (content[0] as { content: string }).content;
  expect(stored.length).toBeLessThanOrEqual(10_000 + "\n[output truncated]".length);
  expect(stored).toContain("[output truncated]");
});

test("max iterations: emits sentinel via onChunk and returns", async () => {
  const chunks: string[] = [];
  const mockExecute = async () => "output";

  // Always returns tool_use to force loop
  const provider = mockStreamingProvider(
    Array(20).fill({ text: "", toolCalls: [{ id: "tc1", name: "run_shell", input: { command: "ps" } }], stopReason: "tool_use" })
  );

  await runWatchAgentLoop(
    provider,
    [{ role: "user" as const, content: "q" }],
    noTools, SYS,
    { onChunk: c => chunks.push(c), onToolCall: () => {} },
    3,  // low limit for test speed
    mockExecute
  );

  expect(chunks.join("")).toContain("reached maximum investigation steps");
});

test("empty toolCalls with tool_use stopReason: treats as end_turn", async () => {
  const result = await runWatchAgentLoop(
    mockStreamingProvider([{ text: "done", toolCalls: [], stopReason: "tool_use" }]),
    [{ role: "user" as const, content: "q" }],
    noTools, SYS,
    { onChunk: () => {}, onToolCall: () => {} }
  );
  expect(result[1]).toMatchObject({ role: "assistant", content: "done" });
});

test("preserves existing history: new turns appended, old turns untouched", async () => {
  const existingHistory = [
    { role: "user" as const, content: "first question" },
    { role: "assistant" as const, content: "first answer" },
  ];
  const result = await runWatchAgentLoop(
    mockStreamingProvider([{ text: "second answer", stopReason: "end_turn" }]),
    [...existingHistory, { role: "user" as const, content: "second question" }],
    noTools, SYS,
    { onChunk: () => {}, onToolCall: () => {} }
  );
  expect(result).toHaveLength(4);
  expect(result[0]).toMatchObject(existingHistory[0]!);
  expect(result[1]).toMatchObject(existingHistory[1]!);
  expect(result[3]).toMatchObject({ role: "assistant", content: "second answer" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/commands/watch-agent.test.ts
```

Expected: all 8 tests fail with `Cannot find module './watch-agent'`.

- [ ] **Step 3: Implement `watch-agent.ts`**

Create `src/commands/watch-agent.ts`:

```typescript
import { executeToolWithTimeout, MAX_TOOL_RESULT_CHARS } from "../tools";
import type { LLMProvider, Message, ToolDefinition, ContentBlock } from "../providers/types";

type ExecuteFn = (name: string, input: Record<string, unknown>) => Promise<string>;

export async function runWatchAgentLoop(
  provider: LLMProvider,
  history: Message[],
  tools: ToolDefinition[],
  systemPrompt: string,
  callbacks: {
    onChunk: (text: string) => void;
    onToolCall: (name: string) => void;
  },
  maxIterations = 10,
  executeFn: ExecuteFn = executeToolWithTimeout
): Promise<Message[]> {
  const working = [...history];
  let iterations = 0;

  while (true) {
    if (iterations >= maxIterations) {
      callbacks.onChunk("\n[Cael: reached maximum investigation steps]");
      return working;
    }
    iterations++;

    const response = provider.stream
      ? await provider.stream(working, tools, callbacks.onChunk, { system: systemPrompt })
      : await provider.chat(working, tools, { system: systemPrompt });

    // Defensive: empty toolCalls treated as end_turn regardless of stopReason
    if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
      if (response.text) working.push({ role: "assistant", content: response.text });
      return working;
    }

    // Build assistant turn containing text (if any) + all tool_use blocks
    const assistantContent: ContentBlock[] = [];
    if (response.text) assistantContent.push({ type: "text", text: response.text });
    for (const tc of response.toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    working.push({ role: "assistant", content: assistantContent });

    // Signal the first tool name for TUI activity display
    callbacks.onToolCall(response.toolCalls[0]?.name ?? "tool");

    // Execute all tool calls concurrently
    const toolResults: ContentBlock[] = await Promise.all(
      response.toolCalls.map(async (tc): Promise<ContentBlock> => {
        let content: string;
        let isError = false;
        try {
          content = await executeFn(tc.name, tc.input);
        } catch (e: unknown) {
          content = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        if (content.length > MAX_TOOL_RESULT_CHARS) {
          content = content.slice(0, MAX_TOOL_RESULT_CHARS) + "\n[output truncated]";
        }
        return {
          type: "tool_result",
          tool_use_id: tc.id,
          content,
          ...(isError ? { is_error: true } : {}),
        };
      })
    );
    working.push({ role: "user", content: toolResults });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/commands/watch-agent.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/watch-agent.ts src/commands/watch-agent.test.ts
git commit -m "feat: implement runWatchAgentLoop in watch-agent.ts"
```

---

## Task 4: Wire `runWatchAgentLoop` into `watch.ts`

**Files:**
- Modify: `src/commands/watch.ts`

This task rewires `submitQuery` to use the new agent loop, adds conversation history, and adds the dismiss guard. There is no dedicated unit test file for `watch.ts` (it is a TUI command), so correctness is verified by running the app manually after the change.

- [ ] **Step 1: Add imports to `watch.ts`**

At the top of `src/commands/watch.ts`, add these imports alongside the existing ones:

```typescript
import { runWatchAgentLoop } from "./watch-agent";
import { watchTools } from "../tools";
import type { Message } from "../providers/types";
```

- [ ] **Step 2: Add `conversationHistory` local variable**

Inside `runWatch`, immediately after `let lastRefreshError: string | null = null;`, add:

```typescript
let conversationHistory: Message[] = [];
```

- [ ] **Step 3: Update `draw` to pass `agentActivity`**

In the `draw` function, the `buildFrame` call must include `agentActivity`. Replace the existing `buildFrame({...})` call with:

```typescript
const frame = buildFrame({
  cols,
  rows,
  systemLines: lastCtx ? renderSystemPanel(lastCtx.system) : ["SYSTEM", "  collecting..."],
  dockerLines: lastCtx ? renderDockerPanel(lastCtx.docker) : ["DOCKER", "  collecting..."],
  gitLines:    lastCtx ? renderGitPanel(lastCtx.git)       : ["GIT",    "  collecting..."],
  alerts: lastCtx ? generateAlerts(lastCtx.system, lastCtx.docker) : [],
  mode: state.mode,
  queryInput: state.queryInput,
  aiResponse: state.aiResponse,
  agentActivity: state.agentActivity,
  timestamp: new Date().toLocaleTimeString(),
  statusError: lastRefreshError,
});
```

- [ ] **Step 4: Rewrite `submitQuery`**

Replace the entire `submitQuery` async function with:

```typescript
const submitQuery = async (question: string) => {
  querying = true;
  if (refreshTimer) clearInterval(refreshTimer);

  // Collect a fresh snapshot for the system prompt
  let ctx = lastCtx;
  try { ctx = await collectAll(); lastCtx = ctx; } catch (e: unknown) {
    lastRefreshError = e instanceof Error ? e.message : "collection failed";
  }

  const systemPrompt = ctx ? formatSystemPrompt(ctx) : "You are Cael, a DevOps agent.";

  // Build input history without mutating conversationHistory yet
  const inputHistory: Message[] = [
    ...conversationHistory,
    { role: "user" as const, content: question },
  ];

  state = { ...state, mode: "SHOWING_RESULT", aiResponse: "", agentActivity: "" };
  draw();

  try {
    const updatedHistory = await runWatchAgentLoop(
      provider,
      inputHistory,
      watchTools,
      systemPrompt,
      {
        onChunk: (chunk) => {
          if (!chunk) return;
          state = { ...state, aiResponse: state.aiResponse + chunk };
          draw();
        },
        onToolCall: (name) => {
          state = { ...state, agentActivity: `⟳ calling ${name}...` };
          draw();
        },
      }
    );
    conversationHistory = updatedHistory;
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    let friendly = raw;
    try {
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { type?: string; message?: string } };
        if (parsed.error?.type === "overloaded_error") {
          friendly = "API overloaded — try again in a moment";
        } else if (typeof parsed.error?.message === "string") {
          friendly = parsed.error.message;
        }
      }
    } catch { /* not JSON — use raw */ }
    state = { ...state, aiResponse: `Error: ${friendly}` };
    draw();
  } finally {
    state = { ...state, agentActivity: "" };
    querying = false;
    refreshTimer = setInterval(doRefresh, REFRESH_MS);
    draw();
  }
};
```

- [ ] **Step 5: Add dismiss guard in the keyboard handler**

In the keyboard handler inside `setupRawMode`, add a guard immediately after the QUERYING enter-submit block and before `handleKey`:

```typescript
const restoreRaw = setupRawMode((key) => {
  // Handle query submission before state machine
  if (state.mode === "QUERYING" && (key === "\r" || key === "\n")) {
    const q = state.queryInput.trim();
    if (q) {
      state = { ...state, queryInput: q };
      submitQuery(q).catch(() => {});
    }
    return;
  }

  // Block dismiss while an agent loop is in progress
  if (state.mode === "SHOWING_RESULT" && querying) {
    return;
  }

  const { state: next, action } = handleKey(state, key);
  state = next;

  if (action === "quit") {
    restoreRaw();
    cleanup(0);
    return;
  }

  draw();
});
```

- [ ] **Step 6: Run full test suite**

```bash
bun test
```

Expected: all tests still pass — the `watch.ts` changes are behavioural and covered by existing tests plus the new ones from Tasks 1–3.

- [ ] **Step 7: Smoke-test manually**

```bash
bun run index.ts --provider anthropic:claude-opus-4-8 watch
```

1. Press `/`, type `what processes are using the most memory?`, press Enter
2. Verify: TUI shows `⟳ calling get_process_list...` while the agent investigates
3. Verify: response streams in and is grounded in real process data
4. Verify: `[any key to dismiss]` appears only after the response is complete
5. Press `/` again, type `how should I free some up?`, press Enter
6. Verify: agent's answer references the previous response context (multi-turn history working)

- [ ] **Step 8: Commit**

```bash
git add src/commands/watch.ts
git commit -m "feat: wire agentic loop with tool use and conversation history into cael watch"
```

---

## Self-Review Checklist

- [x] **Spec §3.1** (`runWatchAgentLoop` signature, streaming/fallback, tool loop, history return) → Task 3
- [x] **Spec §3.2** (`watchTools`, `MAX_TOOL_RESULT_CHARS`) → Task 1
- [x] **Spec §3.3** (history management, `onChunk`/`onToolCall` callbacks, error path leaves history clean) → Task 4
- [x] **Spec §3.4** (`agentActivity` in `WatchState`) → Task 2
- [x] **Spec §3.5** (`agentActivity` row in `SHOWING_RESULT`, frame height stable) → Task 2
- [x] **Spec §5.1** (no stream → chat fallback) → Task 3 test 2
- [x] **Spec §5.2** (tool failure → `is_error` result) → Task 3 test 4
- [x] **Spec §5.3** (tool timeout — handled by `executeToolWithTimeout` throwing → same as 5.2) → covered by 5.2
- [x] **Spec §5.4** (max iterations sentinel) → Task 3 test 6
- [x] **Spec §5.5** (no text on tool-call turn) → `if (response.text)` guard in implementation
- [x] **Spec §5.6** (streaming error → history unchanged) → `inputHistory` pattern in Task 4, `finally` clears `agentActivity`
- [x] **Spec §5.7** (dismiss guard while querying) → Task 4 Step 5
- [x] **Spec §5.8** (large tool output truncation) → Task 3 test 5
- [x] **Spec §5.9** (refresh timer during query) → unchanged; `querying` flag still guards `doRefresh`
- [x] **Spec §5.10** (null ctx fallback) → unchanged; `formatSystemPrompt` null guard preserved
- [x] **Spec §5.11** (empty chunk guard) → `if (!chunk) return` in `onChunk` in Task 4
- [x] **Spec §5.12** (empty toolCalls with tool_use stopReason) → Task 3 test 7
- [x] **Spec §5.13** (`agentActivity` cleared in `finally`) → Task 4 Step 4
- [x] **Spec §5.14** (frame height consistency) → Task 2 Step 8 + draw tests
- [x] **Spec §5.15** (concurrent query submission) → unchanged; `querying` flag prevents re-entry
