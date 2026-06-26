import { readConfig, writeConfig } from "../config";

const ALLOWED_KEYS = new Set(["provider"]);

export async function runConfig(args: string[], configPath?: string): Promise<void> {
  const [action, key, value] = args;

  if (action === "show" || !action) {
    const cfg = await readConfig(configPath);
    console.log("Cael configuration:");
    console.log(`  provider: ${cfg.provider ?? "(not set)"}`);
    console.log("");
    console.log(`Config file: ${configPath ?? "~/.cael/config.json"}`);
    console.log(`Env override: CAEL_PROVIDER=${process.env.CAEL_PROVIDER ?? "(not set)"}`);
    return;
  }

  if (action === "set") {
    if (!key) {
      console.error("Usage: cael config set <key> <value>");
      console.error("  Example: cael config set provider anthropic:claude-sonnet-4-6");
      process.exit(1);
    }
    if (!ALLOWED_KEYS.has(key)) {
      console.error(`Unknown config key: '${key}'. Allowed keys: ${[...ALLOWED_KEYS].join(", ")}`);
      process.exit(1);
    }
    if (!value) {
      console.error(`Usage: cael config set ${key} <value>`);
      process.exit(1);
    }
    await writeConfig({ [key]: value } as any, configPath);
    console.log(`Set ${key} = ${value}`);
    return;
  }

  console.error(`Unknown config action: '${action}'. Use: cael config show | set <key> <value>`);
  process.exit(1);
}
