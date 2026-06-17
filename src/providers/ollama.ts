import type { LLMProvider, Message, ToolDefinition, ProviderResponse } from "./types";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private model: string;
  private baseUrl: string;

  constructor(model = "llama3.2", baseUrl = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async stream(messages: Message[], tools: ToolDefinition[], onChunk: (t: string) => void): Promise<ProviderResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: tools.map(t => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
        stream: true,
      }),
    });

    let fullText = "";
    const toolCalls: any[] = [];
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        const data = JSON.parse(line);
        if (data.message?.content) { onChunk(data.message.content); fullText += data.message.content; }
        if (data.message?.tool_calls) toolCalls.push(...data.message.tool_calls);
      }
    }

    return {
      text: fullText,
      toolCalls: toolCalls.map(tc => ({ id: crypto.randomUUID(), name: tc.function.name, input: tc.function.arguments })),
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<ProviderResponse> {
    return this.stream(messages, tools, () => {});
  }
}