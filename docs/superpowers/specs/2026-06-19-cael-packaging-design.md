# Cael Packaging — Design Spec

**Date:** 2026-06-19
**Goal:** Ship `cael` as a public GitHub Release binary so users can install and run `cael watch`, `cael ask`, etc. without needing Bun or Node.

---

## Build System

Use `bun build --compile` to produce self-contained binaries. The Bun runtime is embedded in the output — no external runtime needed on the user's machine.

Cross-compile all 4 targets from a single Linux runner:

| Artifact | Platform |
|---|---|
| `cael-darwin-arm64` | macOS Apple Silicon |
| `cael-darwin-x64` | macOS Intel |
| `cael-linux-x64` | Linux x86_64 |
| `cael-linux-arm64` | Linux ARM (Graviton, Raspberry Pi) |

Add to `package.json`:
- `"build"` script — compiles for the current machine (for local testing)
- `"build:all"` script — compiles all 4 targets (used by CI)

## GitHub Actions Workflow

File: `.github/workflows/release.yml`

- Trigger: `push` on tags matching `v*`
- Runner: `ubuntu-latest` (cross-compiles all targets)
- Steps: checkout → setup-bun → `bun install` → build all 4 binaries → create GitHub Release via `softprops/action-gh-release` with all binaries attached
- Release notes: auto-generated from commits since last tag

To ship a release:
```
git tag v0.1.0
git push --tags
```

## Installation (README)

```bash
# macOS (Apple Silicon)
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-arm64 -o cael
chmod +x cael && xattr -dr com.apple.quarantine cael
sudo mv cael /usr/local/bin/cael

# macOS (Intel)
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-x64 -o cael
chmod +x cael && xattr -dr com.apple.quarantine cael
sudo mv cael /usr/local/bin/cael

# Linux (x86_64)
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-linux-x64 -o cael
chmod +x cael && sudo mv cael /usr/local/bin/cael

# Linux (ARM64)
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-linux-arm64 -o cael
chmod +x cael && sudo mv cael /usr/local/bin/cael
```

**macOS Gatekeeper note:** The `xattr` command removes the quarantine flag macOS applies to binaries downloaded from the internet. Required once after download.

## Files Changed

1. `package.json` — add `build` and `build:all` scripts
2. `.github/workflows/release.yml` — new CI release workflow
3. `README.md` — add Installation section with real URLs

## Out of Scope

- Code signing / notarization (can add later)
- `curl | sh` install script (can add later)
- npm/Homebrew distribution (can add later)
- Windows builds (can add later)
