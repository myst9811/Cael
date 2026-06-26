import { test, expect } from "bun:test";
import { parsePostmortemFlags } from "./flags";

test("parses --container flag", () => {
  const r = parsePostmortemFlags(["--container", "worker"]);
  expect(r.container).toBe("worker");
});

test("parses --since flag", () => {
  const r = parsePostmortemFlags(["--since", "2h"]);
  expect(r.since).toBe("2h");
});

test("parses --output flag", () => {
  const r = parsePostmortemFlags(["--output", "report.md"]);
  expect(r.output).toBe("report.md");
});

test("parses all flags together", () => {
  const r = parsePostmortemFlags(["--container", "api", "--since", "1h30m", "--output", "incident.md"]);
  expect(r.container).toBe("api");
  expect(r.since).toBe("1h30m");
  expect(r.output).toBe("incident.md");
});

test("returns undefined for missing flags", () => {
  const r = parsePostmortemFlags([]);
  expect(r.container).toBeUndefined();
  expect(r.since).toBeUndefined();
  expect(r.output).toBeUndefined();
});

test("flags can appear in any order", () => {
  const r = parsePostmortemFlags(["--output", "out.md", "--since", "30m", "--container", "db"]);
  expect(r.container).toBe("db");
  expect(r.since).toBe("30m");
  expect(r.output).toBe("out.md");
});

test("invalid --since value is preserved (validation is caller's job)", () => {
  const r = parsePostmortemFlags(["--since", "yesterday"]);
  expect(r.since).toBe("yesterday");
});

test("parses --template flag", () => {
  const r = parsePostmortemFlags(["--template", "/path/to/template.md"]);
  expect(r.template).toBe("/path/to/template.md");
});

test("--template does not affect other flags", () => {
  const r = parsePostmortemFlags(["--since", "2h", "--template", "tmpl.md", "--container", "api"]);
  expect(r.since).toBe("2h");
  expect(r.template).toBe("tmpl.md");
  expect(r.container).toBe("api");
});
