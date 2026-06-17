# Agentic Watch Mode — Design Spec

**Date:** 2026-06-17
**Status:** Approved

---

## 1. Problem Statement

`cael watch` currently answers user questions with a single one-shot LLM call against a static text snapshot of system metrics. The agent cannot take any actions — it can only reason over frozen text. A user asking "what's consuming my memory?" gets a generic recommendation rather than an answer grounded in actual process data.

The fix: wire the watch query path through a real agent loop that can call tools (`get_process_list`, `get_docker_logs`, `run_shell`, etc.) to investigate before answering.

**Scope:** reactive only. The agent acts when the user asks a question. No autonomous background behavior.

---

## 2. Goals

- User queries in `cael watch` trigger a multi-step agent loop with tool use
- Conversation history persists across queries within a single session
- The TUI shows real-time tool activity ("calling get_process_list...") during investigation
- Tool access is restricted to read-only + shell (no file writes)
- Zero regression to existing commands (`ask`, `deploy-check`, `postmortem`, REPL)

---

## 3. Architecture

### 3.1 New File: `src/commands/watch-agent.ts`

Single exported function:

```typescript
export async function runWatchAgentLoop(
  provider: LLMProvider,
  history: Message[],
  tools: ToolDefinition[],
  systemPrompt: string,
  callbacks: {
    onChunk: (text: string) => void;
    onToolCall: (name: string) => void;
  },
  maxIterations?: number
): Promise<Message[]>
```

**Behavior:**

1. Clones incoming `history` into a local working copy
2. Enters a loop (default max: 10 iterations)
3. Each iteration:
   a. Calls `provider.stream(history, tools, onChunk, { system: systemPrompt })` if streaming is available; falls back to `provider.chat` if not
   b. Streaming delivers text tokens to the TUI via `onChunk` as they arrive
   c. When the call resolves, inspects `ProviderResponse.stopReason` and `ProviderResponse.toolCalls`
   d. If `stopReason === "end_turn"` OR `toolCalls` is empty → exit loop, return updated history
   e. If there are tool calls → fire `onToolCall(name)` for the first tool in the list (TUI shows a single active indicator), then execute **all** tool calls concurrently via `executeToolWithTimeout`; append the assistant content block + all tool_result blocks to history; loop again
4. Returns the full updated `Message[]` including all new turns from this query

**Max iterations:** if the loop reaches the limit without `end_turn`, appends a sentinel user-facing note to the last text: `"[Cael: reached maximum investigation steps]"` and returns. Does not throw.

### 3.2 Changes to `src/tools.ts`

Extract the three read-only code tools into named constants, then define `watchTools`:

```typescript
const readFileTool: ToolDefinition = { name: "read_file", ... };
const runShellTool: ToolDefinition = { name: "run_shell", ... };
const listDirTool:  ToolDefinition = { name: "list_dir",  ... };
const writeFileTool: ToolDefinition = { name: "write_file", ... };

export const tools: ToolDefinition[] = [readFileTool, writeFileTool, runShellTool, listDirTool, ...collectorTools];

export const watchTools: ToolDefinition[] = [
  readFileTool,
  runShellTool,
  listDirTool,
  ...collectorTools,
  // write_file intentionally excluded
];
```

`runAgentLoop` in `agent.ts` continues importing `tools` (all tools). No change to that file.

### 3.3 Changes to `src/commands/watch.ts`

**Conversation history:** add `let conversationHistory: Message[] = []` as a local variable (not in `WatchState` — the TUI doesn't render it).

**`submitQuery` rewrite:**
1. Build fresh `systemPrompt` from current snapshot via `formatSystemPrompt`
2. Build `inputHistory = [...conversationHistory, { role: "user", content: question }]` — do **not** mutate `conversationHistory` yet
3. Call `runWatchAgentLoop(provider, inputHistory, watchTools, systemPrompt, { onChunk, onToolCall })`
4. On success: set `conversationHistory = returnedHistory`; clear `agentActivity`; draw final state
5. On error: caught in `try/catch` with existing friendly JSON error parsing; `conversationHistory` is unchanged (failed turn discarded); clear `agentActivity`; set `aiResponse` to error string

**`onChunk` callback:**
```typescript
onChunk: (chunk) => {
  if (!chunk) return;
  state = { ...state, aiResponse: state.aiResponse + chunk };
  draw();
}
```

**`onToolCall` callback:**
```typescript
onToolCall: (name) => {
  state = { ...state, agentActivity: `⟳ calling ${name}...` };
  draw();
}
```

**Dismiss guard:** in the keyboard handler, pressing any key in `SHOWING_RESULT` mode must be ignored while `querying === true`. This prevents the user from accidentally dismissing an in-progress response.

### 3.4 Changes to `src/tui/state.ts`

Add `agentActivity: string` (default `""`) to `WatchState`.

### 3.5 Changes to `src/tui/draw.ts`

In `SHOWING_RESULT` mode, when `opts.agentActivity` is non-empty, render it as the row immediately before the `[any key to dismiss]` line (the last content row):

```
  ⟳ calling get_process_list...
  [any key to dismiss]
```

When `agentActivity` is `""`, that row renders blank — same as the current filler rows. Frame height is always `opts.rows` regardless of agent state; the activity line never adds or removes a row.

---

## 4. Data Flow

```
User presses Enter on query
  → submitQuery(question)
    → append user message to conversationHistory
    → build fresh systemPrompt from snapshot
    → runWatchAgentLoop(...)
        → provider.stream / provider.chat  ←── onChunk → TUI streams text
        → tool calls?
            → onToolCall("get_process_list") → TUI shows "⟳ calling..."
            → executeToolWithTimeout(...)
            → append tool_result to history
            → loop again
        → end_turn → return updated Message[]
    → conversationHistory = returned history
    → clear agentActivity
    → draw final state
```

---

## 5. Edge Cases

### 5.1 Provider Has No `stream` Method

Ollama and any future provider may not implement the optional `stream` field. `runWatchAgentLoop` checks `provider.stream != null` before calling it. Falls back to `provider.chat`. The TUI shows `"⟳ thinking..."` (the initial state set before the call) until the response arrives — no streaming, but functionally correct.

### 5.2 Tool Execution Failure

`executeToolWithTimeout` throws (permission denied, process not found, etc.). Caught per-tool; result becomes a `tool_result` block with `is_error: true` and the error message as content. The agent receives the error and can adapt (retry differently, explain the failure, or move on). The loop does not abort.

### 5.3 Tool Timeout (10 seconds)

`executeToolWithTimeout` rejects after 10s. Same path as 5.2 — error result fed back to the agent. The TUI continues showing `"⟳ calling X..."` until the timeout resolves, then shows the next activity or the final response.

### 5.4 Max Iterations Reached

After 10 turns without `end_turn`, the loop exits with the last partial text plus the sentinel string. This prevents infinite loops on adversarial or confused tool call sequences. 10 is the right ceiling for a watch query (investigate → answer, not a long coding session).

### 5.5 Agent Produces No Text on a Tool-Call Turn

Valid: the agent may call tools without emitting any text first. `onChunk` is simply never called for that turn — `aiResponse` stays at `""` or its previous value. TUI shows `agentActivity` only. No empty string appended to the response.

### 5.6 Streaming Error Mid-Turn

`provider.stream` throws after partial text has been emitted (network cut, API 5xx). Caught in the `try/catch` in `submitQuery`. `agentActivity` is cleared in `finally`. `aiResponse` is set to the friendly error string. `conversationHistory` is NOT updated (the failed partial turn is discarded) — the next query starts from the last known-good state.

### 5.7 Key Press While Agent Is Looping

`querying === true` while `runWatchAgentLoop` is running. The keyboard handler checks this flag before processing any dismiss action (key press in `SHOWING_RESULT`). The user cannot accidentally dismiss an in-progress response. `q`/SIGINT still call `cleanup → process.exit` — no partial state to worry about.

### 5.8 Large Tool Output in History

`run_shell` can return unbounded stdout. To prevent the conversation history from accumulating MBs: truncate any single tool result to `MAX_TOOL_RESULT_CHARS = 10_000` characters before appending to history, appending `"\n[output truncated]"` if truncated. `read_file` is already limited to 1MB by the existing guard. `get_docker_logs` already truncates at 10KB.

### 5.9 Refresh Timer During Query

`doRefresh` skips early when `querying === true`. The refresh timer is cleared at the start of `submitQuery` and restarted in `finally`. No race condition between the refresh cycle and the agent loop.

### 5.10 First Query Before Any Snapshot

If the user presses `/` before the first `doRefresh` completes, `lastCtx` is `null`. `formatSystemPrompt(null)` already has a fallback: `"You are Cael, a DevOps agent."` The agent proceeds with no snapshot data, which is honest.

### 5.11 Empty Streaming Chunks

Some providers emit empty string chunks at stream boundaries. Guard: `if (!chunk) return` in `onChunk`. No blank tokens appended to `aiResponse`.

### 5.12 `ProviderResponse.stopReason === "tool_use"` But `toolCalls === []`

Defensive: if `toolCalls` is empty regardless of `stopReason`, treat as `end_turn` and exit the loop. Prevents an infinite loop on a malformed provider response.

### 5.13 `agentActivity` Not Cleared on Error

`agentActivity` is cleared in the `finally` block of `submitQuery`, not just the happy path. The TUI never gets stuck showing `"⟳ calling..."` after a failure.

### 5.14 Frame Height Consistency

`agentActivity` occupies one of the existing `responseContentRows` — it does not add a new row. When `agentActivity` is `""`, that row renders blank. Frame height is always `opts.rows` regardless of agent state. No stale rows from height changes.

### 5.15 Concurrent Query Submission

`querying = true` is set synchronously before the `await`. The keyboard handler checks `querying` before entering `SHOWING_RESULT`. A second `/` + Enter while a query is running is a no-op — the existing enter-submit guard in the keyboard handler only fires in `QUERYING` mode, which the state machine won't re-enter while `querying === true`.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `src/commands/watch-agent.ts` | **New** — watch agent loop |
| `src/tools.ts` | Extract named tool constants; export `watchTools` |
| `src/commands/watch.ts` | Wire `runWatchAgentLoop`; add history; guard dismiss; add callbacks |
| `src/tui/state.ts` | Add `agentActivity: string` to `WatchState` |
| `src/tui/draw.ts` | Render `agentActivity` row in `SHOWING_RESULT` mode |
| `src/agent.ts` | **No change** |
| `src/providers/` | **No change** |

---

## 7. Non-Goals

- Proactive/autonomous investigation (deferred — user prefers reactive only for now)
- Persistent history across sessions (sessions are short-lived, adds complexity for little gain)
- Token count–based history pruning (YAGNI — watch sessions are short)
- Streaming tool call arguments (not supported by current provider interface)
- `write_file` access from watch (intentionally excluded for safety)
