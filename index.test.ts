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

test("parseArgs detects 'ask' subcommand and separates prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "ask", "why is worker crashing?"]);
  expect(result.subcommand).toBe("ask");
  expect(result.prompt).toBe("why is worker crashing?");
});

test("parseArgs ask with multi-word question joins correctly", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "ask", "what", "is", "using", "all", "my", "memory"]);
  expect(result.subcommand).toBe("ask");
  expect(result.prompt).toBe("what is using all my memory");
});

test("parseArgs non-subcommand first arg is treated as plain prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "find all TODOs"]);
  expect(result.subcommand).toBeUndefined();
  expect(result.prompt).toBe("find all TODOs");
});

test("parseArgs ask with no question returns undefined prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "ask"]);
  expect(result.subcommand).toBe("ask");
  expect(result.prompt).toBeUndefined();
});
