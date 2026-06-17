import { test, expect } from "bun:test";
import { parseArgs } from "./index";

test("parseArgs extracts provider and prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-sonnet-4-6", "find all TODOs"]);
  expect(result).toEqual({ provider: "anthropic:claude-sonnet-4-6", prompt: "find all TODOs" });
});

test("parseArgs returns undefined prompt for REPL mode", () => {
  const result = parseArgs(["--provider", "anthropic:claude-sonnet-4-6"]);
  expect(result).toEqual({ provider: "anthropic:claude-sonnet-4-6", prompt: undefined });
});

test("parseArgs throws when --provider is missing", () => {
  expect(() => parseArgs(["find all TODOs"])).toThrow("--provider");
});

test("parseArgs handles --provider at end with no model", () => {
  expect(() => parseArgs(["--provider"])).toThrow();
});
