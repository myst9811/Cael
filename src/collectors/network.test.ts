import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLsofOutput, parseSsOutput } from "./network";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "__fixtures__", name), "utf-8");

test("parseLsofOutput TCP: extracts port and process name", () => {
  const result = parseLsofOutput(fixture("lsof-tcp.txt"), "tcp");
  expect(result.length).toBe(3);
  const node = result.find(p => p.port === 3000)!;
  expect(node.protocol).toBe("tcp");
  expect(node.process_name).toBe("node");
  expect(node.pid).toBe(1234);
  expect(node.address).toBe("0.0.0.0");
});

test("parseLsofOutput TCP: specific address is preserved", () => {
  const result = parseLsofOutput(fixture("lsof-tcp.txt"), "tcp");
  const nginx = result.find(p => p.port === 8080)!;
  expect(nginx.address).toBe("127.0.0.1");
  expect(nginx.pid).toBe(999);
});

test("parseLsofOutput UDP: extracts UDP entries with correct protocol", () => {
  const result = parseLsofOutput(fixture("lsof-udp.txt"), "udp");
  expect(result.length).toBe(2);
  for (const e of result) expect(e.protocol).toBe("udp");
  expect(result.find(p => p.port === 5353)?.address).toBe("0.0.0.0");
});

test("parseSsOutput: extracts TCP entries with process info", () => {
  const result = parseSsOutput(fixture("ss-tcp.txt"));
  const tcp = result.filter(p => p.protocol === "tcp");
  expect(tcp.length).toBeGreaterThanOrEqual(2);
  const ssh = tcp.find(p => p.port === 22)!;
  expect(ssh.process_name).toBe("sshd");
  expect(ssh.pid).toBe(1001);
});

test("parseSsOutput: extracts UDP entries", () => {
  const result = parseSsOutput(fixture("ss-udp.txt"));
  const udp = result.filter(p => p.protocol === "udp");
  expect(udp.length).toBeGreaterThanOrEqual(1);
  const syslog = udp.find(p => p.port === 514)!;
  expect(syslog.process_name).toBe("syslogd");
  expect(syslog.pid).toBe(202);
});

test("parseSsOutput: line without process info produces undefined pid", () => {
  const result = parseSsOutput(fixture("ss-tcp.txt"));
  const noProc = result.find(p => p.port === 80);
  expect(noProc?.pid).toBeUndefined();
  expect(noProc?.process_name).toBeUndefined();
});
