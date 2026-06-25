import { test, expect } from "bun:test";
import { runConfig } from "./config";

test("runConfig show prints current config", async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));
  await runConfig(["show"], "/tmp/cael-config-test-show.json");
  console.log = origLog;
  expect(logs.some((l) => l.includes("provider") || l.includes("(not set)"))).toBe(true);
});

test("runConfig set provider writes to config", async () => {
  const path = "/tmp/cael-config-test-set.json";
  await runConfig(["set", "provider", "anthropic:claude-opus-4-8"], path);
  const file = Bun.file(path);
  const cfg = await file.json();
  expect(cfg.provider).toBe("anthropic:claude-opus-4-8");
});

test("runConfig set with unknown key prints error and exits non-zero", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...args: any[]) => errors.push(args.join(" "));
  let code = 0;
  const origExit = process.exit;
  (process as any).exit = (c: number) => { code = c; throw new Error("EXIT"); };
  try {
    await runConfig(["set", "unknown_key", "value"], "/tmp/cael-config-test-bad.json");
  } catch {}
  (process as any).exit = origExit;
  console.error = origErr;
  expect(code).toBe(1);
  expect(errors.some((e) => e.includes("unknown_key"))).toBe(true);
});

test("runConfig set without value prints usage and exits", async () => {
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (...args: any[]) => errors.push(args.join(" "));
  let code = 0;
  const origExit = process.exit;
  (process as any).exit = (c: number) => { code = c; throw new Error("EXIT"); };
  try {
    await runConfig(["set", "provider"], "/tmp/cael-config-test-novalue.json");
  } catch {}
  (process as any).exit = origExit;
  console.error = origErr;
  expect(code).toBe(1);
});
