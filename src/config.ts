import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CaelConfig {
  provider?: string;
}

const DEFAULT_CONFIG_PATH = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".cael",
  "config.json"
);

export async function readConfig(path = DEFAULT_CONFIG_PATH): Promise<CaelConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  const parsed = await file.json(); // throws on malformed JSON — intentional, not swallowed
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config file is not a JSON object: ${path}`);
  }
  return parsed as CaelConfig;
}

export async function writeConfig(patch: Partial<CaelConfig>, path = DEFAULT_CONFIG_PATH): Promise<void> {
  const existing = await readConfig(path);
  const merged = { ...existing, ...patch };
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(merged, null, 2) + "\n");
}

export async function resolveProvider(configPath = DEFAULT_CONFIG_PATH): Promise<string | null> {
  if (process.env.CAEL_PROVIDER) return process.env.CAEL_PROVIDER;
  const cfg = await readConfig(configPath);
  return cfg.provider ?? null;
}
