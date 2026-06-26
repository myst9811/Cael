import { unlink } from "node:fs/promises";
import { VERSION } from "../version";

const REPO = "myst9811/Cael";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const TIMEOUT_MS = 10_000;

function parseSemver(v: string): [number, number, number] {
  const m = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!)] : [0, 0, 0];
}

export function compareVersions(current: string, latest: string): boolean {
  if (current === "dev") return false;
  if (current === latest) return false;
  const [cMaj, cMin, cPat] = parseSemver(current);
  const [lMaj, lMin, lPat] = parseSemver(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

export function getAssetName(platform: string, arch: string): string | null {
  if (platform === "darwin" && arch === "arm64") return "cael-darwin-arm64";
  if (platform === "darwin" && arch === "x64")   return "cael-darwin-x64";
  if (platform === "linux"  && arch === "x64")   return "cael-linux-x64";
  if (platform === "linux"  && arch === "arm64") return "cael-linux-arm64";
  return null;
}

export function parseChecksum(content: string, filename: string): string | null {
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[1] === filename) return parts[0] ?? null;
  }
  return null;
}

export async function runUpdate(): Promise<void> {
  if (VERSION === "dev") {
    console.error("Cannot update a dev build. Use `bun run index.ts`.");
    process.exit(1);
  }

  const execPath = process.execPath;
  const isCompiledCael = execPath.endsWith("/cael") || /\/cael-\w/.test(execPath);
  if (!isCompiledCael) {
    console.log("Not running as a compiled cael binary. Skipping self-update.");
    process.exit(0);
  }

  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/")) {
    console.error("Installed via Homebrew — run `brew upgrade cael` instead.");
    process.exit(0);
  }

  process.stdout.write("Checking for updates...\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let releaseData: { tag_name: string; assets: Array<{ name: string; browser_download_url: string }> };
  try {
    const res = await fetch(API_URL, {
      headers: { "User-Agent": `cael/${VERSION}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    releaseData = await res.json() as typeof releaseData;
  } finally {
    clearTimeout(timer);
  }

  const { tag_name, assets } = releaseData;

  if (!compareVersions(VERSION, tag_name)) {
    console.log(`Already at ${tag_name}.`);
    return;
  }

  const assetName = getAssetName(process.platform, process.arch);
  if (!assetName) {
    console.error(`Unsupported platform: ${process.platform}/${process.arch}. Download from https://github.com/${REPO}/releases.`);
    process.exit(1);
  }

  const binaryAsset = assets.find(a => a.name === assetName);
  const checksumAsset = assets.find(a => a.name === "checksums.sha256");

  if (!binaryAsset) {
    console.error(`No binary asset found for ${assetName} in release ${tag_name}.`);
    process.exit(1);
  }

  process.stdout.write(`Downloading ${assetName} (${tag_name})...\n`);

  const tmpPath = `${execPath}.tmp`;

  // Download binary with timeout
  const binController = new AbortController();
  const binTimer = setTimeout(() => binController.abort(), TIMEOUT_MS);
  let binRes: Response;
  try {
    binRes = await fetch(binaryAsset.browser_download_url, { signal: binController.signal });
    if (!binRes.ok) throw new Error(`Download failed: ${binRes.status}`);
    await Bun.write(tmpPath, binRes);
  } finally {
    clearTimeout(binTimer);
  }

  // Verify checksum — fail closed: abort if checksum asset exists but can't be verified
  if (checksumAsset) {
    const csController = new AbortController();
    const csTimer = setTimeout(() => csController.abort(), TIMEOUT_MS);
    let expected: string | null = null;
    try {
      const csRes = await fetch(checksumAsset.browser_download_url, { signal: csController.signal });
      if (!csRes.ok) throw new Error(`Checksum fetch failed: ${csRes.status}`);
      expected = parseChecksum(await csRes.text(), assetName);
    } finally {
      clearTimeout(csTimer);
    }
    if (!expected) {
      await unlink(tmpPath).catch(() => {});
      console.error(`No checksum entry found for ${assetName} — aborting update.`);
      process.exit(1);
    }
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await Bun.file(tmpPath).arrayBuffer());
    const actual = hasher.digest("hex");
    if (actual !== expected) {
      await unlink(tmpPath).catch(() => {});
      console.error("Checksum mismatch — aborting update. The downloaded file has been deleted.");
      process.exit(1);
    }
  }

  // Atomic replace
  try {
    const mv = Bun.spawn(["mv", tmpPath, execPath], { stdout: "pipe", stderr: "pipe" });
    const code = await mv.exited;
    if (code !== 0) throw new Error("mv failed");
    await Bun.spawn(["chmod", "0755", execPath], { stdout: "pipe", stderr: "pipe" }).exited;
  } catch {
    console.error(`Permission denied updating ${execPath}. Try: sudo cael update`);
    process.exit(1);
  }

  console.log(`Updated to ${tag_name}.`);
}
