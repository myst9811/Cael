import { test, expect } from "bun:test";
import { runDoctor, buildChecks } from "./doctor";

test("buildChecks returns array of checks with label and check function", () => {
  const checks = buildChecks("/tmp/nonexistent-doctor-test.json");
  expect(checks.length).toBeGreaterThan(0);
  for (const c of checks) {
    expect(typeof c.label).toBe("string");
    expect(typeof c.check).toBe("function");
  }
});

test("check result has ok and detail fields", async () => {
  const checks = buildChecks("/tmp/nonexistent-doctor-test.json");
  const result = await checks[0]!.check();
  expect(typeof result.ok).toBe("boolean");
  expect(typeof result.detail).toBe("string");
});

test("runDoctor prints check results to stdout", async () => {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => lines.push(args.join(" "));
  await runDoctor("/tmp/nonexistent-doctor-test.json");
  console.log = origLog;
  expect(lines.length).toBeGreaterThan(0);
  const output = lines.join("\n");
  expect(output).toMatch(/✓|✗/);
});
