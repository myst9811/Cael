# Cael Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `cael` as a downloadable binary via GitHub Releases so users run `cael watch` instead of `bun run index.ts watch`.

**Architecture:** `bun build --compile` cross-compiles a self-contained binary (Bun runtime embedded) for 4 targets. A GitHub Actions workflow triggers on `v*` tags, builds all 4 targets from a single Ubuntu runner, and uploads them to a GitHub Release automatically.

**Tech Stack:** Bun compile, GitHub Actions, softprops/action-gh-release@v2

---

## Files Changed

| File | Action | Purpose |
|---|---|---|
| `package.json` | Modify | Add `build` and `build:all` scripts |
| `.github/workflows/release.yml` | Create | CI workflow triggered on `v*` tags |
| `README.md` | Modify | Replace Install section + fix `bun run index.ts` references |

---

## Task 1: Add build scripts to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add scripts section**

Replace the contents of `package.json` with:

```json
{
  "name": "cael",
  "module": "index.ts",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "bun build --compile index.ts --outfile cael",
    "build:all": "bun build --compile --target=bun-darwin-arm64 index.ts --outfile cael-darwin-arm64 && bun build --compile --target=bun-darwin-x64 index.ts --outfile cael-darwin-x64 && bun build --compile --target=bun-linux-x64 index.ts --outfile cael-linux-x64 && bun build --compile --target=bun-linux-arm64 index.ts --outfile cael-linux-arm64"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/node": "^25.9.3"
  },
  "peerDependencies": {
    "typescript": "^5"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.104.2",
    "openai": "^6.43.0"
  }
}
```

- [ ] **Step 2: Verify the local build works**

Run:
```bash
bun run build
```

Expected: a `cael` binary appears in the project root. No errors.

- [ ] **Step 3: Smoke-test the binary**

Run:
```bash
./cael --provider anthropic:claude-sonnet-4-6 ask "hello"
```

Expected: Cael prints the logo and responds to the question. Confirms the compiled binary works identically to `bun run index.ts`.

- [ ] **Step 4: Add binary to .gitignore**

Open `.gitignore` (create it if missing) and append:

```
cael
cael-darwin-arm64
cael-darwin-x64
cael-linux-x64
cael-linux-arm64
```

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore
git commit -m "build: add bun compile scripts for local and cross-platform builds"
```

---

## Task 2: Create GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/release.yml` with this exact content:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Build all targets
        run: |
          bun build --compile --target=bun-darwin-arm64 index.ts --outfile cael-darwin-arm64
          bun build --compile --target=bun-darwin-x64 index.ts --outfile cael-darwin-x64
          bun build --compile --target=bun-linux-x64 index.ts --outfile cael-linux-x64
          bun build --compile --target=bun-linux-arm64 index.ts --outfile cael-linux-arm64

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            cael-darwin-arm64
            cael-darwin-x64
            cael-linux-x64
            cael-linux-arm64
```

- [ ] **Step 3: Verify the YAML is valid**

Run:
```bash
cat .github/workflows/release.yml
```

Expected: file prints cleanly with correct indentation. No tabs — YAML requires spaces.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add GitHub Actions release workflow for v* tags"
```

---

## Task 3: Update README

**Files:**
- Modify: `README.md`

Two changes: (a) replace the Install section with binary download instructions, (b) update the three `bun run index.ts` references scattered through the doc to use `cael`.

- [ ] **Step 1: Replace the Install section**

Find this block in `README.md` (around line 143):

```markdown
## Install

```bash
git clone https://github.com/myst9811/Cael
cd Cael
bun install
```

Set at least one key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Claude
export OPENAI_API_KEY=sk-...          # GPT-4o, etc.
# Ollama: nothing — runs 100% local, no key needed
```
```

Replace it with:

```markdown
## Install

Download the binary for your platform from the [latest release](https://github.com/myst9811/Cael/releases/latest):

**macOS (Apple Silicon)**
```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-arm64 -o cael
chmod +x cael && xattr -dr com.apple.quarantine cael
sudo mv cael /usr/local/bin/cael
```

**macOS (Intel)**
```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-x64 -o cael
chmod +x cael && xattr -dr com.apple.quarantine cael
sudo mv cael /usr/local/bin/cael
```

**Linux (x86_64)**
```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-linux-x64 -o cael
chmod +x cael && sudo mv cael /usr/local/bin/cael
```

**Linux (ARM64)**
```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-linux-arm64 -o cael
chmod +x cael && sudo mv cael /usr/local/bin/cael
```

> **macOS note:** The `xattr` command removes the quarantine flag macOS applies to binaries downloaded from the internet. Run it once after downloading.

Then set at least one API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Claude
export OPENAI_API_KEY=sk-...          # GPT-4o, etc.
# Ollama: nothing — runs 100% local, no key needed
```
```

- [ ] **Step 2: Fix the postmortem example**

Find (around line 108):
```markdown
```bash
bun run index.ts --provider anthropic:claude-opus-4-8 postmortem "api down 02:00–02:47"
```
```

Replace with:
```markdown
```bash
cael --provider anthropic:claude-opus-4-8 postmortem "api down 02:00–02:47"
```
```

- [ ] **Step 3: Fix the REPL example**

Find (around line 131):
```markdown
```bash
bun run index.ts --provider anthropic:claude-opus-4-8
# cael> walk me through what this service is doing
```
```

Replace with:
```markdown
```bash
cael --provider anthropic:claude-opus-4-8
# cael> walk me through what this service is doing
```
```

- [ ] **Step 4: Verify no stale references remain**

Run:
```bash
grep -n "bun run index.ts" README.md
```

Expected: no output. If any lines appear, fix them before continuing.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README with binary install instructions and fix bun run references"
```

---

## Task 4: Tag and trigger the first release

- [ ] **Step 1: Push all commits to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Create and push the v0.1.0 tag**

```bash
git tag v0.1.0
git push origin v0.1.0
```

Expected: GitHub Actions workflow triggers. Visit `https://github.com/myst9811/Cael/actions` to watch the run.

- [ ] **Step 3: Verify the release**

Once the workflow completes (typically 2–3 minutes):

1. Visit `https://github.com/myst9811/Cael/releases`
2. Confirm release `v0.1.0` exists
3. Confirm all 4 artifacts are attached: `cael-darwin-arm64`, `cael-darwin-x64`, `cael-linux-x64`, `cael-linux-arm64`

- [ ] **Step 4: Smoke-test the published binary**

Download and test the binary for your platform:

```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-arm64 -o /tmp/cael-test
chmod +x /tmp/cael-test && xattr -dr com.apple.quarantine /tmp/cael-test
/tmp/cael-test --provider anthropic:claude-sonnet-4-6 ask "hello"
```

Expected: Cael responds. Confirms the published binary works end-to-end.
