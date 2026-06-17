export interface Message {
  role: "user" | "assistant";
  content: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: object;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ProviderResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use";
}

export interface LLMProvider {
  name: string;
  chat(messages: Message[], tools: ToolDefinition[]): Promise<ProviderResponse>;
  stream?(messages: Message[], tools: ToolDefinition[], onChunk: (text: string) => void): Promise<ProviderResponse>;
}