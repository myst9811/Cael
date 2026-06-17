import OpenAI from "openai";
import type { LLMProvider, Message, ToolDefinition, ProviderResponse } from "./types";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client = new OpenAI();
  private model: string;

  constructor(model = "gpt-4o") {
    this.model = model;
  }

  async stream(messages: Message[], tools: ToolDefinition[], onChunk: (t: string) => void): Promise<ProviderResponse> {
    // Convert tool schema: Anthropic uses input_schema, OpenAI uses parameters
    const oaiTools = tools.map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

    const stream = await this.client.chat.completions.create({
      model: this.model,
      tools: oaiTools,
      messages,
      stream: true,
    });

    let fullText = "";
    const toolCallAccumulator: Record<number, any> = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        onChunk(delta.content);
        fullText += delta.content;
      }
      // Accumulate streamed tool call fragments
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallAccumulator[tc.index]) toolCallAccumulator[tc.index] = { id: "", name: "", args: "" };
          if (tc.id) toolCallAccumulator[tc.index].id = tc.id;
          if (tc.function?.name) toolCallAccumulator[tc.index].name = tc.function.name;
          if (tc.function?.arguments) toolCallAccumulator[tc.index].args += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.values(toolCallAccumulator).map((tc: any) => ({
      id: tc.id,
      name: tc.name,
      input: JSON.parse(tc.args || "{}"),
    }));

    return {
      text: fullText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ProviderResponse> {
    return this.stream(messages, tools, () => {});
  }
}