import { test, expect } from "bun:test";
import { executeToolWithTimeout } from "./tools";

test("executeToolWithTimeout: returns result for fast tool", async () => {
  const result = await executeToolWithTimeout("list_dir", { path: "." }, 5000);
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

test("executeToolWithTimeout: rejects with timeout error when deadline exceeded", async () => {
  // sleep 5 takes 5s; 50ms timeout should always win the race
  await expect(
    executeToolWithTimeout("run_shell", { command: "sleep 5" }, 50)
  ).rejects.toThrow("timed out");
}, 2000);

test("executeToolWithTimeout: unknown tool throws immediately (not a timeout)", async () => {
  await expect(executeToolWithTimeout("totally_unknown_tool", {}, 5000)).rejects.toThrow("Unknown tool");
});
