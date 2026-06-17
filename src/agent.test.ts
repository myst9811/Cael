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
