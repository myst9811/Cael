import * as readline from "readline";
import { createProvider } from "./src/providers";
import { runAgent, runAgentLoop } from "./src/agent";
import { runAsk } from "./src/commands/ask";
import { runDeployCheck } from "./src/commands/deploy-check";
import { runPostmortem } from "./src/commands/postmortem";
import { runWatch } from "./src/commands/watch";
import { printLogo } from "./src/assets/logo";

const SUBCOMMANDS = ["ask", "watch", "deploy-check", "postmortem"] as const;
type Subcommand = typeof SUBCOMMANDS[number];

export function parseArgs(args: string[]): { provider: string; subcommand?: Subcommand; prompt?: string } {
  const providerIdx = args.indexOf("--provider");
  if (providerIdx === -1) throw new Error("--provider is required (e.g. --provider anthropic:claude-sonnet-4-6)");
  const provider = args[providerIdx + 1];
  if (!provider || provider.startsWith("--")) throw new Error("--provider requires a value");

  const remaining = args.filter((_, i) => i !== providerIdx && i !== providerIdx + 1);

  const first = remaining[0];
  if (first && (SUBCOMMANDS as readonly string[]).includes(first)) {
    const subcommand = first as Subcommand;
    const prompt = remaining.slice(1).join(" ") || undefined;
    return { provider, subcommand, prompt };
  }

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
    const { provider: providerSpec, subcommand, prompt } = parseArgs(args);
    // watch uses a full-screen alt buffer — printing the logo would cause a flash.
    if (subcommand !== "watch") printLogo();
    const provider = createProvider(providerSpec);

    if (subcommand === "ask") {
      if (!prompt) {
        console.error("Usage: cael --provider <provider> ask <question>");
        process.exit(1);
      }
      runAsk(prompt, provider).catch((e) => { console.error(e.message); process.exit(1); });
    } else if (subcommand === "deploy-check") {
      runDeployCheck(provider).catch((e) => { console.error(e.message); process.exit(1); });
    } else if (subcommand === "postmortem") {
      runPostmortem(prompt ?? "", provider).catch((e) => { console.error(e.message); process.exit(1); });
    } else if (subcommand === "watch") {
      runWatch(provider).catch((e) => { console.error(e.message); process.exit(1); });
    } else if (prompt) {
      runAgent(prompt, provider).catch((e) => { console.error(e.message); process.exit(1); });
    } else {
      repl(providerSpec).catch((e) => { console.error(e.message); process.exit(1); });
    }
  } catch (e: unknown) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Usage: bun run index.ts --provider anthropic:claude-opus-4-8 [ask <question> | <prompt>]");
    process.exit(1);
  }
}
