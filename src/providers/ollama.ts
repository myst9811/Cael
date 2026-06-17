import type { LLMProvider, Message, ToolDefinition, ProviderResponse, ChatOptions } from "./types";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private model: string;
  private baseUrl: string;

  constructor(model = "llama3.2", baseUrl = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    onChunk: (t: string) => void,
    options?: ChatOptions,
  ): Promise<ProviderResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      tools: tools.map(t => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      })),
      stream: true,
    };

    // Inject system prompt as the first message (Ollama uses the messages array).
    if (options?.system) {
      const systemMsg = { role: "system", content: options.system };
      body.messages = [systemMsg, ...messages];
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status} ${res.statusText}`);
    }
    if (!res.body) {
      throw new Error("Ollama returned a response with no body");
    }

    let fullText = "";
    const toolCalls: Array<{ function: { name: string; arguments: unknown } }> = [];

    // Buffer partial lines across read() calls to handle chunk boundaries correctly.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      // Keep the last (possibly incomplete) line in the buffer.
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(line);
        } catch {
          // Malformed line (e.g. server-side error text) — skip.
          continue;
        }
        const msg = data.message as Record<string, unknown> | undefined;
        if (typeof msg?.content === "string") {
          onChunk(msg.content);
          fullText += msg.content;
        }
        if (Array.isArray(msg?.tool_calls)) {
          toolCalls.push(...(msg.tool_calls as typeof toolCalls));
        }
      }
    }

    return {
      text: fullText,
      toolCalls: toolCalls.map(tc => ({
        id: crypto.randomUUID(),
        name: tc.function.name,
        input: tc.function.arguments as Record<string, unknown>,
      })),
      stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    };
  }

  async chat(messages: Message[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse> {
    return this.stream(messages, tools, () => {}, options);
  }
}
