import { executeTool, tools } from "./tools";
import type { LLMProvider, Message } from "./providers/types";

export async function runAgentLoop(
  provider: LLMProvider,
  messages: Message[]
): Promise<string> {
  const history = [...messages];

  while (true) {
    const response = await provider.chat(history, tools);

    if (response.stopReason === "end_turn" || response.toolCalls.length === 0) {
      return response.text;
    }

    // Append assistant turn with tool_use blocks (required for Anthropic multi-turn)
    const assistantContent: any[] = [];
    if (response.text) assistantContent.push({ type: "text", text: response.text });
    for (const tc of response.toolCalls) {
      assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    history.push({ role: "assistant", content: assistantContent });

    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => ({
        type: "tool_result",
        tool_use_id: tc.id,
        content: await executeTool(tc.name, tc.input),
      }))
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
