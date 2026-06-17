import * as readline from "readline";
import { createProvider } from "./src/providers";
import { runAgent, runAgentLoop } from "./src/agent";

export function parseArgs(args: string[]): { provider: string; prompt?: string } {
  const providerIdx = args.indexOf("--provider");
  if (providerIdx === -1) throw new Error("--provider is required (e.g. --provider anthropic:claude-sonnet-4-6)");
  const provider = args[providerIdx + 1];
  if (!provider || provider.startsWith("--")) throw new Error("--provider requires a value");

  const remaining = args.filter((_, i) => i !== providerIdx && i !== providerIdx + 1);
  const prompt = remaining.length > 0 ? remaining.join(" ") : undefined;
  return { provider, prompt };
}

async function repl(providerSpec: string): Promise<void> {
  const provider = createProvider(providerSpec);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`Cael [${providerSpec}] — type your task, or Ctrl+C to exit.\n`);

  const ask = () =>
    rl.question("cael> ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return ask();
      const result = await runAgentLoop(provider, [{ role: "user", content: trimmed }]);
      console.log("\n" + result + "\n");
      ask();
    });

  rl.on("close", () => process.exit(0));
  ask();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  try {
    const { provider: providerSpec, prompt } = parseArgs(args);
    if (prompt) {
      runAgent(prompt, createProvider(providerSpec)).catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
    } else {
      repl(providerSpec).catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    console.error("Usage: bun run index.ts --provider anthropic:claude-sonnet-4-6 [prompt]");
    process.exit(1);
  }
}
