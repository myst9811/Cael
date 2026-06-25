import { test, expect } from "bun:test";
import { parseArgs } from "./index";

test("parseArgs extracts provider and prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-sonnet-4-6", "find all TODOs"], null);
  expect(result).toMatchObject({ provider: "anthropic:claude-sonnet-4-6", prompt: "find all TODOs" });
});

test("parseArgs returns undefined prompt for REPL mode", () => {
  const result = parseArgs(["--provider", "anthropic:claude-sonnet-4-6"], null);
  expect(result).toMatchObject({ provider: "anthropic:claude-sonnet-4-6", prompt: undefined });
});

test("parseArgs throws when --provider flag given but no value", () => {
  expect(() => parseArgs(["--provider"], null)).toThrow();
});

test("parseArgs detects 'ask' subcommand and separates prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "ask", "why is worker crashing?"], null);
  expect(result.subcommand).toBe("ask");
  expect(result.prompt).toBe("why is worker crashing?");
});

test("parseArgs ask with multi-word question joins correctly", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "ask", "what", "is", "using", "all", "my", "memory"], null);
  expect(result.subcommand).toBe("ask");
  expect(result.prompt).toBe("what is using all my memory");
});

test("parseArgs non-subcommand first arg is treated as plain prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "find all TODOs"], null);
  expect(result.subcommand).toBeUndefined();
  expect(result.prompt).toBe("find all TODOs");
});

test("parseArgs ask with no question returns undefined prompt", () => {
  const result = parseArgs(["--provider", "anthropic:claude-opus-4-8", "ask"], null);
  expect(result.subcommand).toBe("ask");
  expect(result.prompt).toBeUndefined();
});

test("parseArgs works without --provider when resolvedProvider supplied", () => {
  const result = parseArgs(["ask", "why is disk full?"], "anthropic:claude-sonnet-4-6");
  expect(result.subcommand).toBe("ask");
  expect(result.provider).toBe("anthropic:claude-sonnet-4-6");
  expect(result.prompt).toBe("why is disk full?");
});

test("parseArgs returns null provider when --provider missing and no fallback", () => {
  const result = parseArgs(["ask", "question"], null);
  expect(result.provider).toBeNull();
});

test("parseArgs detects 'config' subcommand", () => {
  const result = parseArgs(["config", "show"], null);
  expect(result.subcommand).toBe("config");
});

test("parseArgs detects 'doctor' subcommand", () => {
  const result = parseArgs(["doctor"], null);
  expect(result.subcommand).toBe("doctor");
});

test("parseArgs detects --help flag", () => {
  const result = parseArgs(["--help"], null);
  expect(result.help).toBe(true);
});

test("parseArgs detects -h flag", () => {
  const result = parseArgs(["-h"], null);
  expect(result.help).toBe(true);
});

test("parseArgs --provider still overrides fallback when supplied", () => {
  const result = parseArgs(["--provider", "ollama:llama3", "ask", "hi"], "anthropic:claude-sonnet-4-6");
  expect(result.provider).toBe("ollama:llama3");
});
