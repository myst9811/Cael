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

  const provider = mockStreamingProvider(
    Array(20).fill({ text: "", toolCalls: [{ id: "tc1", name: "run_shell", input: { command: "ps" } }], stopReason: "tool_use" })
  );

  await runWatchAgentLoop(
    provider,
    [{ role: "user" as const, content: "q" }],
    noTools, SYS,
    { onChunk: c => chunks.push(c), onToolCall: () => {} },
    3,
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
