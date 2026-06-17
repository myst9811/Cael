import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";
import { OllamaProvider } from "./ollama";
import type { LLMProvider } from "./types";

export function createProvider(spec: string): LLMProvider {
  const [provider, model] = spec.split(":");

  switch (provider) {
    case "anthropic": return new AnthropicProvider(model);
    case "openai":    return new OpenAIProvider(model);
    case "ollama":    return new OllamaProvider(model);
    default: throw new Error(`Unknown provider: ${provider}. Use anthropic, openai, or ollama`);
  }
}