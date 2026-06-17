import { executeToolWithTimeout, tools } from "./tools";
import type { LLMProvider, Message, ContentBlock, ChatOptions } from "./providers/types";

export interface AgentOptions {
  maxIterations?: number;
  system?: string;
}

export async function runAgentLoop(
  provider: LLMProvider,
  messages: Message[],
  options?: AgentOptions
): Promise<string> {
  const history = [...messages];
  const maxIterations = options?.maxIterations ?? 20;
  const chatOptions: ChatOptions = { system: options?.system };
  let iterations = 0;
  let lastText = "";

  while (true) {
    if (iterations >= maxIterations) {
      return lastText + "\n[Cael: reached maximum iterations without completing analysis]";
    }
    iterations++;

    const response = await provider.chat(history, tools, chatOptions);
    lastText = response.text;

    if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
      return response.text;
    }

    const assistantContent: ContentBlock[] = [];
    if (response.text) assistantContent.push({ type: "text", text: response.text });
    for (const tc of response.toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    history.push({ role: "assistant", content: assistantContent });

    const toolResults: ContentBlock[] = await Promise.all(
      response.toolCalls.map(async (tc): Promise<ContentBlock> => {
        let content: string;
        let isError = false;
        try {
          content = await executeToolWithTimeout(tc.name, tc.input);
        } catch (e: unknown) {
          content = e instanceof Error ? e.message : String(e);
          isError = true;
        }
        return { type: "tool_result", tool_use_id: tc.id, content, ...(isError ? { is_error: true } : {}) };
      })
    );
    history.push({ role: "user", content: toolResults });
  }
}

export async function runAgent(userPrompt: string, provider: LLMProvider): Promise<void> {
  console.log(`\n[${provider.name}] running...\n`);
  const result = await runAgentLoop(provider, [{ role: "user", content: userPrompt }]);
  console.log(result);
  console.log("\nDone.\n");
}
