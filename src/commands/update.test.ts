import { test, expect } from "bun:test";
import { compareVersions, getAssetName, parseChecksum } from "./update";

test("compareVersions: same version returns false", () => {
  expect(compareVersions("v0.2.0", "v0.2.0")).toBe(false);
});

test("compareVersions: newer remote returns true", () => {
  expect(compareVersions("v0.1.0", "v0.2.0")).toBe(true);
});

test("compareVersions: dev build returns false", () => {
  expect(compareVersions("dev", "v0.2.0")).toBe(false);
});

test("getAssetName: darwin arm64", () => {
  expect(getAssetName("darwin", "arm64")).toBe("cael-darwin-arm64");
});

test("getAssetName: linux x64", () => {
  expect(getAssetName("linux", "x64")).toBe("cael-linux-x64");
});

test("getAssetName: linux arm64", () => {
  expect(getAssetName("linux", "arm64")).toBe("cael-linux-arm64");
});

test("getAssetName: darwin x64", () => {
  expect(getAssetName("darwin", "x64")).toBe("cael-darwin-x64");
});

test("getAssetName: unsupported platform returns null", () => {
  expect(getAssetName("win32", "x64")).toBeNull();
});

test("parseChecksum: finds SHA256 for filename", () => {
  const checksums = "abc123  cael-darwin-arm64\ndef456  cael-linux-x64\n";
  expect(parseChecksum(checksums, "cael-darwin-arm64")).toBe("abc123");
});

test("parseChecksum: returns null when filename not found", () => {
  expect(parseChecksum("abc123  cael-linux-x64\n", "cael-darwin-arm64")).toBeNull();
});

test("parseChecksum: handles two-space separator format from sha256sum", () => {
  const checksums = "deadbeef  cael-linux-x64\n";
  expect(parseChecksum(checksums, "cael-linux-x64")).toBe("deadbeef");
});
