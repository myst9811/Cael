import { test, expect } from "bun:test";
import { redactSecrets } from "./redact";

test("redactSecrets is identity for safe text", () => {
  const text = "CPU usage is 42%. Memory: 8GB used of 16GB.";
  expect(redactSecrets(text)).toBe(text);
});

test("redactSecrets redacts API_KEY=value style env vars", () => {
  const input = "API_KEY=sk-ant-abc123xyz\nSome other text";
  const out = redactSecrets(input);
  expect(out).not.toContain("sk-ant-abc123xyz");
  expect(out).toContain("[REDACTED]");
  expect(out).toContain("API_KEY");
});

test("redactSecrets redacts TOKEN= entries", () => {
  const input = "ACCESS_TOKEN=ghp_1234567890abcdef\nok";
  const out = redactSecrets(input);
  expect(out).not.toContain("ghp_1234567890abcdef");
  expect(out).toContain("[REDACTED]");
});

test("redactSecrets redacts PASSWORD= entries", () => {
  const input = "DB_PASSWORD=s3cr3tP@ssword!";
  const out = redactSecrets(input);
  expect(out).not.toContain("s3cr3tP@ssword!");
  expect(out).toContain("[REDACTED]");
});

test("redactSecrets redacts Bearer tokens", () => {
  const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def";
  const out = redactSecrets(input);
  expect(out).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  expect(out).toContain("[REDACTED]");
});

test("redactSecrets redacts private key blocks", () => {
  const input = `Some text\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\nafter`;
  const out = redactSecrets(input);
  expect(out).not.toContain("MIIEowIBAAKCAQEA");
  expect(out).toContain("[REDACTED PRIVATE KEY]");
  expect(out).toContain("Some text");
  expect(out).toContain("after");
});

test("redactSecrets redacts DATABASE_URL env var entirely via key pattern", () => {
  const input = "DATABASE_URL=postgres://admin:hunter2@localhost:5432/mydb";
  const out = redactSecrets(input);
  expect(out).not.toContain("hunter2");
  expect(out).toContain("[REDACTED]");
  expect(out).toContain("DATABASE_URL");
});

test("redactSecrets redacts bare connection string credentials in logs", () => {
  const input = "connecting to postgres://admin:hunter2@localhost:5432/mydb";
  const out = redactSecrets(input);
  expect(out).not.toContain("hunter2");
  expect(out).toContain("[REDACTED]");
  expect(out).toContain("postgres://");
});

test("redactSecrets redacts AWS-style access key IDs", () => {
  const input = "key: AKIAIOSFODNN7EXAMPLE and rest";
  const out = redactSecrets(input);
  expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  expect(out).toContain("[REDACTED AWS KEY]");
});

test("redactSecrets redacts provider-prefixed API key (OPENAI_API_KEY)", () => {
  const input = "OPENAI_API_KEY=sk-proj-abcdef123456\nsome other text";
  const out = redactSecrets(input);
  expect(out).not.toContain("sk-proj-abcdef123456");
  expect(out).toContain("[REDACTED]");
  expect(out).toContain("OPENAI_API_KEY");
});

test("redactSecrets redacts ANTHROPIC_API_KEY", () => {
  const input = "ANTHROPIC_API_KEY=sk-ant-api03-abc123";
  const out = redactSecrets(input);
  expect(out).not.toContain("sk-ant-api03-abc123");
  expect(out).toContain("[REDACTED]");
});

test("redactSecrets redacts GITHUB_TOKEN", () => {
  const input = "GITHUB_TOKEN=ghp_1234567890abcdefghij";
  const out = redactSecrets(input);
  expect(out).not.toContain("ghp_1234567890abcdefghij");
  expect(out).toContain("[REDACTED]");
});

test("redactSecrets handles empty string", () => {
  expect(redactSecrets("")).toBe("");
});

test("redactSecrets does not redact innocuous uppercase words", () => {
  const input = "STATUS=running\nNAME=myapp\nPORT=8080";
  const out = redactSecrets(input);
  expect(out).toBe(input);
});
