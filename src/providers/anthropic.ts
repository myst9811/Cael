import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, Message, ToolDefinition, ProviderResponse, ChatOptions } from "./types";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client = new Anthropic();
  private model: string;

  constructor(model = "claude-sonnet-4-6") {
    this.model = model;
  }

  async stream(messages: Message[], tools: ToolDefinition[], onChunk: (t: string) => void, options?: ChatOptions): Promise<ProviderResponse> {
    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      ...(options?.system ? { system: options.system } : {}),
      tools: tools as any,
      messages,
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        onChunk(chunk.delta.text);
      }
    }

    const response = await stream.finalMessage();
    const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const toolCalls = response.content
      .filter((b: any) => b.type === "tool_use")
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
    };
  }

  async chat(messages: Message[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse> {
    return this.stream(messages, tools, () => {}, options);
  }
}