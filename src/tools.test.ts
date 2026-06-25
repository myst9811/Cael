import { test, expect } from "bun:test";
import { executeToolWithTimeout, watchExecuteToolWithTimeout, watchTools, tools, MAX_TOOL_RESULT_CHARS } from "./tools";

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

test("MAX_TOOL_RESULT_CHARS is 10000", () => {
  expect(MAX_TOOL_RESULT_CHARS).toBe(10_000);
});

test("watchTools does not include write_file", () => {
  expect(watchTools.find(t => t.name === "write_file")).toBeUndefined();
});

test("watchTools includes all collector tools", () => {
  const names = watchTools.map(t => t.name);
  for (const n of ["get_system_metrics", "get_docker_status", "get_docker_logs", "get_git_status", "get_process_list"]) {
    expect(names).toContain(n);
  }
});

test("watchTools includes read-only code tools", () => {
  const names = watchTools.map(t => t.name);
  for (const n of ["read_file", "run_shell", "list_dir"]) {
    expect(names).toContain(n);
  }
});

test("tools (full set) still includes write_file", () => {
  expect(tools.find(t => t.name === "write_file")).toBeDefined();
});

test("run_shell output has secrets redacted", async () => {
  const tmpFile = "/tmp/cael-redact-test.env";
  await Bun.write(tmpFile, "API_KEY=sk-super-secret-value\nPORT=8080\n");
  const result = await executeToolWithTimeout("run_shell", { command: `cat ${tmpFile}` }, 5000);
  expect(result).not.toContain("sk-super-secret-value");
  expect(result).toContain("[REDACTED]");
  expect(result).toContain("PORT=8080");
});

test("run_shell blocks dd (global denylist)", async () => {
  const result = await executeToolWithTimeout("run_shell", { command: "dd if=/dev/zero of=/tmp/zeros" }, 5000);
  expect(result).toMatch(/not permitted|denied/i);
});

test("run_shell blocks mkfs (global denylist)", async () => {
  const result = await executeToolWithTimeout("run_shell", { command: "mkfs.ext4 /dev/sda" }, 5000);
  expect(result).toMatch(/not permitted|denied/i);
});

test("run_shell blocks shred (global denylist)", async () => {
  const result = await executeToolWithTimeout("run_shell", { command: "shred /tmp/somefile" }, 5000);
  expect(result).toMatch(/not permitted|denied/i);
});

test("run_shell allows ls in normal mode", async () => {
  const result = await executeToolWithTimeout("run_shell", { command: "ls ." }, 5000);
  expect(result).not.toMatch(/not permitted|denied/i);
});

test("watchExecuteToolWithTimeout blocks unknown command in watch mode", async () => {
  const result = await watchExecuteToolWithTimeout("run_shell", { command: "python3 exploit.py" }, 5000);
  expect(result).toMatch(/not permitted/i);
});

test("watchExecuteToolWithTimeout allows grep in watch mode", async () => {
  const result = await watchExecuteToolWithTimeout("run_shell", { command: "grep -r TODO ." }, 5000);
  expect(result).not.toMatch(/not permitted/i);
});

test("watchExecuteToolWithTimeout allows docker ps in watch mode", async () => {
  const result = await watchExecuteToolWithTimeout("run_shell", { command: "docker ps" }, 5000);
  expect(result).not.toMatch(/not permitted/i);
});

test("run_shell blocks dd hidden via sh -c wrapper", async () => {
  const result = await executeToolWithTimeout("run_shell", { command: "sh -c 'dd if=/dev/zero of=/tmp/zeros'" }, 5000);
  expect(result).toMatch(/not permitted/i);
});

test("run_shell blocks mkfs hidden via bash -c wrapper", async () => {
  const result = await executeToolWithTimeout("run_shell", { command: "bash -c 'mkfs.ext4 /dev/sda'" }, 5000);
  expect(result).toMatch(/not permitted/i);
});

test("watchExecuteToolWithTimeout blocks git push in watch mode", async () => {
  const result = await watchExecuteToolWithTimeout("run_shell", { command: "git push origin main" }, 5000);
  expect(result).toMatch(/not permitted/i);
});

test("watchExecuteToolWithTimeout blocks docker exec in watch mode", async () => {
  const result = await watchExecuteToolWithTimeout("run_shell", { command: "docker exec mycontainer bash" }, 5000);
  expect(result).toMatch(/not permitted/i);
});

test("watchExecuteToolWithTimeout allows git status in watch mode", async () => {
  const result = await watchExecuteToolWithTimeout("run_shell", { command: "git status" }, 5000);
  expect(result).not.toMatch(/not permitted/i);
});

test("watchExecuteToolWithTimeout non-shell tools still work", async () => {
  const result = await watchExecuteToolWithTimeout("list_dir", { path: "." }, 5000);
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});
