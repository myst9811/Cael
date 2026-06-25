import { test, expect } from "bun:test";
import { writeConfig, readConfig, resolveProvider } from "./config";

const TEST_CONFIG_PATH = "/tmp/cael-test-config.json";

test("readConfig returns empty object when file missing", async () => {
  const cfg = await readConfig("/tmp/cael-nonexistent-config-xyz.json");
  expect(cfg).toEqual({});
});

test("writeConfig then readConfig round-trips data", async () => {
  await writeConfig({ provider: "anthropic:claude-sonnet-4-6" }, TEST_CONFIG_PATH);
  const cfg = await readConfig(TEST_CONFIG_PATH);
  expect(cfg.provider).toBe("anthropic:claude-sonnet-4-6");
});

test("writeConfig merges with existing config", async () => {
  await writeConfig({ provider: "ollama:llama3" }, TEST_CONFIG_PATH);
  await writeConfig({ provider: "ollama:llama3" } as any, TEST_CONFIG_PATH);
  const cfg = await readConfig(TEST_CONFIG_PATH);
  expect(cfg.provider).toBe("ollama:llama3");
});

test("resolveProvider returns CAEL_PROVIDER env when set", async () => {
  const orig = process.env.CAEL_PROVIDER;
  process.env.CAEL_PROVIDER = "anthropic:claude-haiku-4-5-20251001";
  const result = await resolveProvider("/tmp/cael-nonexistent-env-test.json");
  expect(result).toBe("anthropic:claude-haiku-4-5-20251001");
  if (orig === undefined) delete process.env.CAEL_PROVIDER; else process.env.CAEL_PROVIDER = orig;
});

test("resolveProvider falls back to config file when env unset", async () => {
  const orig = process.env.CAEL_PROVIDER;
  delete process.env.CAEL_PROVIDER;
  await writeConfig({ provider: "openai:gpt-4o" }, TEST_CONFIG_PATH);
  const result = await resolveProvider(TEST_CONFIG_PATH);
  expect(result).toBe("openai:gpt-4o");
  if (orig !== undefined) process.env.CAEL_PROVIDER = orig;
});

test("resolveProvider returns null when neither env nor config set", async () => {
  const orig = process.env.CAEL_PROVIDER;
  delete process.env.CAEL_PROVIDER;
  const result = await resolveProvider("/tmp/nonexistent-cael-config.json");
  expect(result).toBeNull();
  if (orig !== undefined) process.env.CAEL_PROVIDER = orig;
});
