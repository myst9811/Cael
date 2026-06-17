import { test, expect } from "bun:test";
import { runAgentLoop } from "./agent";
import type { LLMProvider } from "./providers/types";

test("runAgentLoop returns provider text when no tool calls", async () => {
  const mockProvider: LLMProvider = {
    name: "mock",
    chat: async () => ({
      text: "Hello, world!",
      toolCalls: [],
      stopReason: "end_turn",
    }),
  };

  const result = await runAgentLoop(mockProvider, [
    { role: "user", content: "say hello" },
  ]);

  expect(result).toBe("Hello, world!");
});

test("runAgentLoop executes tool calls and returns final text", async () => {
  let callCount = 0;
  const mockProvider: LLMProvider = {
    name: "mock",
    chat: async () => {
      callCount++;
      if (callCount === 1) {
        return {
          text: "",
          toolCalls: [{ id: "tool-1", name: "list_dir", input: { path: "." } }],
          stopReason: "tool_use" as const,
        };
      }
      return { text: "Done!", toolCalls: [], stopReason: "end_turn" as const };
    },
  };

  const result = await runAgentLoop(mockProvider, [
    { role: "user", content: "list files" },
  ]);

  expect(result).toBe("Done!");
  expect(callCount).toBe(2);
});

test("runAgentLoop passes tool results back into the conversation", async () => {
  const seenMessages: string[] = [];
  const mockProvider: LLMProvider = {
    name: "mock",
    chat: async (messages) => {
      seenMessages.push(JSON.stringify(messages.at(-1)));
      if (seenMessages.length === 1) {
        return {
          text: "",
          toolCalls: [{ id: "t1", name: "list_dir", input: { path: "." } }],
          stopReason: "tool_use" as const,
        };
      }
      return { text: "All done!", toolCalls: [], stopReason: "end_turn" as const };
    },
  };

  await runAgentLoop(mockProvider, [{ role: "user", content: "go" }]);

  // Second call should include a tool result message
  const lastMessage = JSON.parse(seenMessages[1]);
  expect(lastMessage.role).toBe("user");
  expect(JSON.stringify(lastMessage.content)).toContain("t1");
});

test("runAgentLoop stops at maxIterations and appends warning", async () => {
  let calls = 0;
  const mockProvider: LLMProvider = {
    name: "mock",
    chat: async () => {
      calls++;
      return {
        text: "",
        toolCalls: [{ id: `t${calls}`, name: "list_dir", input: { path: "." } }],
        stopReason: "tool_use" as const,
      };
    },
  };

  const result = await runAgentLoop(
    mockProvider,
    [{ role: "user", content: "go" }],
    { maxIterations: 3 }
  );

  expect(calls).toBe(3);
  expect(result).toContain("reached maximum iterations");
});

test("runAgentLoop catches tool execution errors and sends is_error: true", async () => {
  const seenToolResults: any[] = [];
  const mockProvider: LLMProvider = {
    name: "mock",
    chat: async (messages) => {
      if (messages.length === 1) {
        return {
          text: "",
          toolCalls: [{ id: "t1", name: "nonexistent_tool_xyz", input: {} }],
          stopReason: "tool_use" as const,
        };
      }
      const last = messages[messages.length - 1];
      seenToolResults.push(...last.content);
      return { text: "done", toolCalls: [], stopReason: "end_turn" as const };
    },
  };

  const result = await runAgentLoop(mockProvider, [{ role: "user", content: "test" }]);
  expect(result).toBe("done");
  expect(seenToolResults[0].is_error).toBe(true);
  expect(seenToolResults[0].content).toBeTruthy();
});
