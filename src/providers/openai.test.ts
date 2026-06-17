import { test, expect } from "bun:test";
import { translateMessagesForOpenAI } from "./openai";
import type { Message } from "./types";

test("translateMessagesForOpenAI: passes plain user message through", () => {
  const msgs: Message[] = [{ role: "user", content: "hello" }];
  const result = translateMessagesForOpenAI(msgs);
  expect(result).toHaveLength(1);
  expect(result[0]).toEqual({ role: "user", content: "hello" });
});

test("translateMessagesForOpenAI: passes plain assistant message through", () => {
  const msgs: Message[] = [{ role: "assistant", content: "hi there" }];
  const result = translateMessagesForOpenAI(msgs);
  expect(result[0]).toEqual({ role: "assistant", content: "hi there" });
});

test("translateMessagesForOpenAI: converts assistant tool_use blocks to tool_calls", () => {
  const msgs: Message[] = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "tu1", name: "get_git_status", input: {} },
      ],
    },
  ];
  const result = translateMessagesForOpenAI(msgs);
  expect(result).toHaveLength(1);
  const msg = result[0] as any;
  expect(msg.role).toBe("assistant");
  expect(msg.content).toBe("Let me check.");
  expect(msg.tool_calls).toHaveLength(1);
  expect(msg.tool_calls[0].id).toBe("tu1");
  expect(msg.tool_calls[0].function.name).toBe("get_git_status");
  expect(msg.tool_calls[0].function.arguments).toBe("{}");
});

test("translateMessagesForOpenAI: converts tool_result user turn to role:tool messages", () => {
  const msgs: Message[] = [
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu1", content: '{"branch":"main"}' },
      ],
    },
  ];
  const result = translateMessagesForOpenAI(msgs);
  expect(result).toHaveLength(1);
  const msg = result[0] as any;
  expect(msg.role).toBe("tool");
  expect(msg.tool_call_id).toBe("tu1");
  expect(msg.content).toBe('{"branch":"main"}');
});

test("translateMessagesForOpenAI: multi-turn conversation with tool call round-trip", () => {
  const msgs: Message[] = [
    { role: "user", content: "check git" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "get_git_status", input: {} }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: '{"branch":"main"}' }],
    },
  ];
  const result = translateMessagesForOpenAI(msgs);
  expect(result).toHaveLength(3);
  expect((result[0] as any).role).toBe("user");
  expect((result[1] as any).role).toBe("assistant");
  expect((result[1] as any).tool_calls[0].id).toBe("t1");
  expect((result[2] as any).role).toBe("tool");
  expect((result[2] as any).tool_call_id).toBe("t1");
});

test("translateMessagesForOpenAI: multiple tool results expand into multiple tool messages", () => {
  const msgs: Message[] = [
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "result1" },
        { type: "tool_result", tool_use_id: "t2", content: "result2" },
      ],
    },
  ];
  const result = translateMessagesForOpenAI(msgs);
  expect(result).toHaveLength(2);
  expect((result[0] as any).tool_call_id).toBe("t1");
  expect((result[1] as any).tool_call_id).toBe("t2");
});
