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

    let response;
    if (provider.stream) {
      response = await provider.stream(working, tools, callbacks.onChunk, { system: systemPrompt });
    } else {
      response = await provider.chat(working, tools, { system: systemPrompt });
      if (response.text) callbacks.onChunk(response.text);
    }

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
