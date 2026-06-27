import { test, expect } from "bun:test";
import { loadDeployPolicy, DEFAULT_POLICY } from "./policy";

test("DEFAULT_POLICY has correct 140-point scale thresholds", () => {
  expect(DEFAULT_POLICY.go_threshold).toBe(112);
  expect(DEFAULT_POLICY.caution_threshold).toBe(84);
  expect(DEFAULT_POLICY.cpu_warn).toBe(70);
  expect(DEFAULT_POLICY.disk_crit).toBe(95);
});

test("loadDeployPolicy returns defaults when no config files exist", async () => {
  const policy = await loadDeployPolicy("/tmp/nonexistent-m4-project.json", "/tmp/nonexistent-m4-user.json");
  expect(policy).toEqual(DEFAULT_POLICY);
});

test("loadDeployPolicy: project-level overrides user-level", async () => {
  const projectPath = "/tmp/m4-policy-project.json";
  const userPath = "/tmp/m4-policy-user.json";
  await Bun.write(userPath, JSON.stringify({ deploy: { cpu_warn: 65, go_threshold: 100 } }));
  await Bun.write(projectPath, JSON.stringify({ deploy: { cpu_warn: 55 } }));
  const policy = await loadDeployPolicy(projectPath, userPath);
  expect(policy.cpu_warn).toBe(55);
  expect(policy.go_threshold).toBe(100);
  expect(policy.caution_threshold).toBe(84);
});

test("loadDeployPolicy: user-level overrides defaults", async () => {
  const userPath = "/tmp/m4-policy-user-only.json";
  await Bun.write(userPath, JSON.stringify({ deploy: { disk_crit: 90 } }));
  const policy = await loadDeployPolicy("/tmp/nonexistent-m4-project.json", userPath);
  expect(policy.disk_crit).toBe(90);
  expect(policy.cpu_warn).toBe(70);
});

test("loadDeployPolicy: malformed JSON falls back to defaults", async () => {
  const bad = "/tmp/m4-policy-bad.json";
  await Bun.write(bad, "not json {{{");
  const policy = await loadDeployPolicy(bad, "/tmp/nonexistent.json");
  expect(policy).toEqual(DEFAULT_POLICY);
});
