import * as readline from "readline";
import { createProvider } from "./src/providers";
import { runAgent, runAgentLoop } from "./src/agent";
import { runAsk } from "./src/commands/ask";
import { runConfig } from "./src/commands/config";
import { runDeployCheck } from "./src/commands/deploy-check";
import { runDoctor } from "./src/commands/doctor";
import { runPostmortem } from "./src/commands/postmortem";
import { runWatch } from "./src/commands/watch";
import { resolveProvider } from "./src/config";
import { printLogo } from "./src/assets/logo";

const SUBCOMMANDS = ["ask", "config", "deploy-check", "doctor", "postmortem", "update", "watch"] as const;
type Subcommand = typeof SUBCOMMANDS[number];

const HELP_TEXT = `
Cael — a local DevOps AI agent

Usage:
  cael [--provider <spec>] <subcommand> [args]

Subcommands:
  ask <question>              Ask a question about your system
  watch                       Live dashboard with AI chat
  deploy-check                Score your system's readiness to deploy
  postmortem [time]           Generate a postmortem for a past incident (e.g. "last 2h")
  config show                 Show current configuration
  config set <key> <value>    Set a config value
  doctor                      Check dependencies and configuration
  update                      Check for and install the latest cael release

Options:
  --provider <spec>    Override provider for this run
                       (e.g. anthropic:claude-sonnet-4-6, openai:gpt-4o, ollama:llama3)
  --version, -V        Show version and exit
  --help, -h           Show this help

Provider configuration (in order of precedence):
  1. --provider flag on command line
  2. CAEL_PROVIDER environment variable
  3. cael config set provider <spec>

Examples:
  cael ask "why is disk space low?"
  cael watch
  cael deploy-check
  cael config set provider anthropic:claude-sonnet-4-6
  cael doctor
`.trim();

export interface ParsedArgs {
  provider: string | null;
  subcommand?: Subcommand;
  prompt?: string;
  help?: boolean;
  configArgs?: string[];
  postmortemArgs?: string[];
}

export function parseArgs(args: string[], resolvedProvider: string | null): ParsedArgs {
  if (args.includes("--help") || args.includes("-h")) {
    return { provider: null, help: true };
  }

  let provider: string | null = resolvedProvider;
  const providerIdx = args.indexOf("--provider");
  let remaining = args;

  if (providerIdx !== -1) {
    const spec = args[providerIdx + 1];
    if (!spec || spec.startsWith("--")) throw new Error("--provider requires a value");
    provider = spec;
    remaining = args.filter((_, i) => i !== providerIdx && i !== providerIdx + 1);
  }

  const first = remaining[0];

  if (first === "config") {
    return { provider, subcommand: "config", configArgs: remaining.slice(1) };
  }

  if (first === "doctor") {
    return { provider, subcommand: "doctor" };
  }

  if (first === "postmortem") {
    return { provider, subcommand: "postmortem", postmortemArgs: remaining.slice(1) };
  }

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
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes("--version") || rawArgs.includes("-V")) {
    const { printVersion } = await import("./src/version");
    printVersion();
    process.exit(0);
  }

  let resolvedProvider: string | null = null;
  try {
    resolvedProvider = await resolveProvider();
  } catch (e: unknown) {
    console.error(`Error reading config: ${e instanceof Error ? e.message : String(e)}`);
    console.error("Config file may be malformed. Run: cael config set provider <spec>");
    process.exit(1);
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(rawArgs, resolvedProvider);
  } catch (e: unknown) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    console.error("\nRun `cael --help` for usage.");
    process.exit(1);
  }

  if (parsed.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const { provider: providerSpec, subcommand, prompt, configArgs, postmortemArgs } = parsed;

  if (subcommand === "config") {
    await runConfig(configArgs ?? []).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
    process.exit(0);
  }

  if (subcommand === "doctor") {
    const allOk = await runDoctor().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
    process.exit(allOk ? 0 : 1);
  }

  if (subcommand === "update") {
    const { runUpdate } = await import("./src/commands/update");
    await runUpdate().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
    process.exit(0);
  }

  if (!providerSpec) {
    console.error("Error: no provider configured.");
    console.error("");
    console.error("Set one with:  cael config set provider anthropic:claude-sonnet-4-6");
    console.error("Or env var:    export CAEL_PROVIDER=anthropic:claude-sonnet-4-6");
    console.error("Or per-run:    cael --provider anthropic:claude-sonnet-4-6 ask <question>");
    console.error("");
    console.error("Run `cael doctor` to check your setup.");
    process.exit(1);
  }

  if (subcommand !== "watch") printLogo();
  const provider = createProvider(providerSpec);

  if (subcommand === "ask") {
    if (!prompt) {
      console.error("Usage: cael ask <question>");
      process.exit(1);
    }
    runAsk(prompt, provider).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  } else if (subcommand === "deploy-check") {
    runDeployCheck(provider).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  } else if (subcommand === "postmortem") {
    runPostmortem(postmortemArgs ?? [], provider).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  } else if (subcommand === "watch") {
    runWatch(provider).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  } else if (prompt) {
    runAgent(prompt, provider).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  } else {
    repl(providerSpec).catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  }
}
