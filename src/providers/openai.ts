import OpenAI from "openai";
import type { LLMProvider, Message, ToolDefinition, ProviderResponse, ChatOptions } from "./types";

export function translateMessagesForOpenAI(
  messages: Message[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      out.push({ role: msg.role, content: msg.content } as any);
      continue;
    }

    const hasToolUse = msg.content.some((b: any) => b.type === "tool_use");
    const hasToolResult = msg.content.some((b: any) => b.type === "tool_result");

    if (hasToolUse && msg.role === "assistant") {
      const textBlocks = msg.content.filter((b: any) => b.type === "text");
      const toolBlocks = msg.content.filter((b: any) => b.type === "tool_use");
      out.push({
        role: "assistant",
        content: textBlocks.map((b: any) => b.text).join("") || null,
        tool_calls: toolBlocks.map((b: any) => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        })),
      });
      continue;
    }

    if (hasToolResult && msg.role === "user") {
      for (const block of msg.content.filter((b: any) => b.type === "tool_result")) {
        out.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: block.content ?? "",
        } as any);
      }
      continue;
    }

    // Plain array content — flatten to string
    const text = msg.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    out.push({ role: msg.role, content: text } as any);
  }

  return out;
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client = new OpenAI();
  private model: string;

  constructor(model = "gpt-4o") {
    this.model = model;
  }

  async stream(messages: Message[], tools: ToolDefinition[], onChunk: (t: string) => void, options?: ChatOptions): Promise<ProviderResponse> {
    const oaiTools = tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema as Record<string, unknown>,
      },
    }));

    const oaiMessages = translateMessagesForOpenAI(messages);

    // OpenAI has no top-level system field — inject it as the first message.
    if (options?.system) {
      oaiMessages.unshift({ role: "system", content: options.system });
    }

    const stream = await this.client.chat.completions.create({
      model: this.model,
      tools: oaiTools,
      messages: oaiMessages,
      stream: true,
    } as any);

    let fullText = "";
    const toolCallAccumulator: Record<number, any> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        onChunk(delta.content);
        fullText += delta.content;
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallAccumulator[tc.index]) toolCallAccumulator[tc.index] = { id: "", name: "", args: "" };
          if (tc.id) toolCallAccumulator[tc.index].id = tc.id;
          if (tc.function?.name) toolCallAccumulator[tc.index].name = tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[tc.index].args += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallAccumulator).map((tc: any) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.args || "{}");
      } catch {
        // Malformed JSON from a partial/interrupted stream — treat as empty input.
      }
      return { id: tc.id, name: tc.name, input };
    });

    return {
      text: fullText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async chat(messages: Message[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse> {
    return this.stream(messages, tools, () => {}, options);
  }
}
