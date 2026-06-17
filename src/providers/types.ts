export type TextBlock       = { type: "text";        text: string };
export type ToolUseBlock    = { type: "tool_use";    id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ContentBlock    = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ProviderResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use";
}

export interface ChatOptions {
  system?: string;
}

export interface LLMProvider {
  name: string;
  chat(messages: Message[], tools: ToolDefinition[], options?: ChatOptions): Promise<ProviderResponse>;
  stream?(messages: Message[], tools: ToolDefinition[], onChunk: (text: string) => void, options?: ChatOptions): Promise<ProviderResponse>;
}
