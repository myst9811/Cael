# M4: Operational Workflows — Design Spec

## Goal

Make `cael deploy-check` and `cael postmortem` production-ready for on-call teams: configurable scoring policies, two new deploy checks (inode pressure, branch upstream) plus an enhanced git check (lockfile detection), a structured incident timeline, custom postmortem templates, SHA256 release checksums, a Homebrew tap, and a `cael update` self-update command with checksum verification.

## Approach

Approach A — extend the existing config, command, and CI systems in-place. No new frameworks or dependencies. Project-level `.cael/policy.json` overrides user-level `~/.cael/config.json` overrides hardcoded defaults. All four subsystems (deploy scoring, postmortem timeline, markdown templates, CI hardening) are independent and can ship in one PR.

**Branch from:** `origin/main` after M3 merge (`1ad031d`). No files overlap with open PRs.

---

## Prerequisites

M1 (`src/config.ts`, `~/.cael/config.json`) and M3 (`SystemMetrics.disk_inode_percent`, `src/collectors/types.ts`) must be on main. Both are merged as of this spec.

---

## Section 1: Configurable Deploy Scoring

### New files

**`src/commands/deploy-check/policy.ts`** — loads and resolves deploy thresholds.

```ts
export interface DeployPolicy {
  cpu_warn: number;           // default 70
  cpu_crit: number;           // default 85
  mem_warn: number;           // default 80
  mem_crit: number;           // default 90
  disk_warn: number;          // default 85
  disk_crit: number;          // default 95
  go_threshold: number;       // default 96  — raw score out of 120 for GO verdict (80%)
  caution_threshold: number;  // default 72  — raw score out of 120 for CAUTION verdict (60%)
}

// Total score is out of 140: 7 checks × 20pts each
// (cpu, memory, disk, docker, git, inodes, branch_upstream).
// go_threshold=112 means ≥80% required for GO; caution_threshold=84 means ≥60% for CAUTION.
export const DEFAULT_POLICY: DeployPolicy = {
  cpu_warn: 70, cpu_crit: 85,
  mem_warn: 80, mem_crit: 90,
  disk_warn: 85, disk_crit: 95,
  go_threshold: 112, caution_threshold: 84,
};

export async function loadDeployPolicy(): Promise<DeployPolicy>
```

Resolution order: `.cael/policy.json` (CWD) → `~/.cael/config.json` (`deploy` key) → `DEFAULT_POLICY`. Any missing key falls through to the next level. Both files are optional.

`.cael/policy.json` example:
```json
{
  "deploy": {
    "cpu_warn": 60,
    "disk_crit": 90
  }
}
```

### Modified files

**`src/commands/deploy-check/scorer.ts`**

`calculateDeployScore(input, policy?)` — new optional `policy: DeployPolicy` parameter. All hardcoded thresholds replaced with `policy.cpu_warn`, etc.

`DeployInput` gains:
```ts
disk_inode_percent?: number;
```

`ScoreResult.items` gains two new entries:
```ts
inodes: CheckItem;          // 20-point check using disk_inode_percent
branch_upstream: CheckItem; // 20-point check using behind_commits
```

**Inode check** — 20 pts if `disk_inode_percent` < 85%; 10 pts if < 95%; 0 pts otherwise. Skipped (returns `{score: 20}`) when `disk_inode_percent` is undefined.

**Branch upstream check** — requires new `behind_commits?: number` field on `GitStatus` (from `git rev-list --count HEAD..@{u}`). 20 pts if behind = 0; 10 pts if behind 1-5; 0 pts if behind > 5 or upstream unknown. Flagged explicitly when behind > 0.

**Git check enhanced** — same 20 points but now distinguishes:
- dirty lockfile (`bun.lock`, `package-lock.json`, `yarn.lock`, `Cargo.lock`) → 0 pts, flagged explicitly
- unpushed commits → 5 pts deducted
- dirty non-lockfile → 5 pts deducted

Lockfile detection requires filenames, not just a count. `GitStatus` gains `dirty_file_paths?: string[]` (from `git status --short`, lines starting with ` M`, `M `, `??`). `DeployInput.git` gains `dirty_file_paths?: string[]`. `getGitStatus()` in `src/collectors/git.ts` is updated to run `git status --short` and populate this field.

`ScoreResult.hard_block` gains `"inode_critical"` as a new variant (triggered when `disk_inode_percent > 95`).

Total score is out of **140** (7 checks × 20pts: cpu, memory, disk, docker, git, inodes, branch_upstream). Default `go_threshold: 112` (80% of 140) and `caution_threshold: 84` (60% of 140).

**`src/commands/deploy-check/formatter.ts`** — add `itemLine("Inodes", result.items.inodes)` to `formatScoreTable`. Add `"inode_critical"` to the hard-block label map.

**`src/commands/deploy-check/index.ts`** — call `loadDeployPolicy()` before `calculateDeployScore`, pass it in. Pass `ctx.system.disk_inode_percent` into `DeployInput`.

### Tests

**`src/commands/deploy-check/scorer.test.ts`** (extend existing) — test custom policy thresholds, inode check (0/10/20 pts), lockfile detection.

**`src/commands/deploy-check/policy.test.ts`** (new) — test resolution order with temp files; verify project-level overrides user-level; verify missing keys use defaults.

---

## Section 2: Postmortem Timeline Engine

### New file

**`src/commands/postmortem/timeline.ts`**

```ts
export interface TimelineEvent {
  timestamp: string;    // ISO 8601
  source: "git" | "log";
  container?: string;
  message: string;
  level?: "error" | "warn" | "info";
}

export function extractTimeline(ctx: PostmortemContext): TimelineEvent[]
export function formatTimeline(events: TimelineEvent[]): string  // markdown table
```

**Git pass:** parses `ctx.gitLog`. Requires `collectPostmortemContext` to use `git log --format="%H %aI %s"` (ISO date via `%aI`) instead of `--oneline`. Regex: `/^([0-9a-f]{7,40})\s+(\S+)\s+(.+)$/`. Emits one event per commit.

**Log pass:** for each container in `ctx.containerLogs`, scans each log line for a leading ISO timestamp (`/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/`). Classifies level by keyword scan (ERROR/FATAL/CRITICAL → error, WARN → warn). Deduplication: lines within 1 second from the same container whose normalised prefix (first 60 chars, timestamps stripped) matches an already-seen entry are collapsed — count is shown instead.

Result: timestamped events merged and sorted by `timestamp` ascending. Events without a parseable timestamp are collected separately and appended after the sorted timeline under an "Untimed Evidence" heading in `formatTimeline` — they are not placed first, as doing so would make them look causally prior to dated events.

**`formatTimeline`** returns a markdown table:
```
| Time | Source | Message |
|------|--------|---------|
| 10:00:01 | git | fix: bump connection pool size (abc1234) |
| 10:00:03 | api (error×4) | Database connection failed |
```

### Modified files

**`src/commands/postmortem/context.ts`**

`PostmortemContext` gains a new field:
```ts
gitTimelineLog: string;  // git log --format="%H %aI %s" -20 (ISO date for timeline engine)
```

`gitLog` (the existing `--oneline` format) is **retained** for human-readable display in `formatPostmortemContext`. Both fields are populated. `extractTimeline` consumes `gitTimelineLog`; `formatPostmortemContext` continues to render `gitLog` under "RECENT GIT HISTORY".

**`src/commands/postmortem/index.ts`**

After `collectPostmortemContext`, call `extractTimeline(ctx)` and `formatTimeline(events)`. Inject the timeline table into the prompt context between the header and the raw log sections. The system prompt note becomes: "A pre-sorted timeline is provided first; use it to reconstruct the incident sequence in the Timeline section."

### Tests

**`src/commands/postmortem/timeline.test.ts`** (new) — inline fixture strings; test git line parsing; test log timestamp extraction; test deduplication; test sort order; test `formatTimeline` produces a markdown table.

---

## Section 3: Markdown Export Templates

### New file

**`src/commands/postmortem/default-template.ts`** — a string constant containing the current hardcoded section list as a markdown template:

```ts
export const DEFAULT_TEMPLATE = `## What Happened
<!-- Describe the user-visible impact and when it started -->

## Likely Root Cause
<!-- The single most proximate technical cause -->

## Contributing Factors
<!-- Secondary conditions that made the incident worse or harder to catch -->

## Timeline
<!-- Events in chronological order — use the timeline table provided -->

## Recommended Action Items
- [ ] <!-- Add specific, ownable follow-up tasks -->
`;
```

### Modified files

**`src/commands/postmortem/flags.ts`** — add `template?: string` to `PostmortemFlags` and parse `--template <path>`.

**`src/commands/postmortem/index.ts`**

Template resolution order:
1. `--template <path>` flag (absolute or CWD-relative path both accepted — user explicitly chose it)
2. `.cael/postmortem-template.md` in CWD (if it exists — CWD-confined)
3. `DEFAULT_TEMPLATE`

**Path safety for `--template`:** file size capped at 50KB (larger files use `DEFAULT_TEMPLATE` with a warning). Read errors (not found, permission denied) fall back to `DEFAULT_TEMPLATE` with a stderr warning — they do not crash the command. No content sanitisation needed since the user chose the path.

The resolved template replaces the hardcoded section list in `POSTMORTEM_PROMPT`. The AI is instructed: "Fill in each `##` section below exactly as named. Preserve the section headers."

Output format: template sections filled in by AI, preceded by:
```markdown
# Incident Postmortem
_Generated by Cael at <timestamp>_
```

### Tests

**`src/commands/postmortem/flags.test.ts`** (extend existing) — test `--template` flag parsing.

**`src/commands/postmortem/index.test.ts`** (new, minimal) — test template resolution logic in isolation (mock file system, verify correct template string is selected).

---

## Section 4: CI/Release Hardening

### `src/version.ts` (new)

```ts
declare const BUILD_VERSION: string;
export const VERSION: string = typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "dev";
```

### `package.json` (modify)

Update all `bun build --compile` commands to add `--define BUILD_VERSION='"$(git describe --tags --exact-match 2>/dev/null || echo dev)"'`. This injects the git tag at compile time.

### `src/commands/update.ts` (new)

`runUpdate(): Promise<void>`

**Pre-flight checks (fail fast before any download):**
- If `VERSION === "dev"`: print "Cannot update a dev build. Use `bun run index.ts`." and exit 1.
- If `process.execPath` ends with `/bun` or `process.execPath` does not end with `/cael`: print "Not running as a compiled cael binary. Skipping self-update." and exit 0.
- If `process.execPath` includes `/Cellar/` or `/homebrew/`: print "Installed via Homebrew — run `brew upgrade cael` instead." and exit 0.

**Update flow:**
1. Fetch `https://api.github.com/repos/myst9811/Cael/releases/latest`. Timeout: 10s.
2. Compare `tag_name` to `VERSION`. If equal, print "Already at <tag_name>." and exit 0.
3. Determine asset name: `cael-darwin-arm64`, `cael-darwin-x64`, `cael-linux-x64`, or `cael-linux-arm64` from `process.platform` + `process.arch`. If no match, print unsupported platform message and exit 1.
4. Find binary asset and `checksums.sha256` asset in `assets` array.
5. Download `checksums.sha256` first. Parse the line matching the asset name to extract the expected SHA256 hex string.
6. Download binary to a temp file (`${process.execPath}.tmp`).
7. Compute SHA256 of the downloaded temp file using `new Bun.CryptoHasher("sha256")`. Compare to expected hash. If mismatch, delete temp file, print "Checksum mismatch — aborting update." and exit 1.
8. Rename temp file over `process.execPath` (`Bun.file(...).rename(...)` or shell `mv`). Catch permission errors: if rename fails, print "Permission denied updating <path>. Try: sudo cael update" and exit 1.
9. Set file mode `0o755` via `chmod`.
10. Print: `Updated to <tag_name>.`

### `src/version.ts` additions

Also export a human-readable version string used by the new `--version` flag:
```ts
export function printVersion(): void {
  console.log(`cael ${VERSION}`);
}
```

### `index.ts` (modify)

**Add `--version`/`-V` flag** — checked before all subcommand routing:
```ts
if (rawArgs.includes("--version") || rawArgs.includes("-V")) {
  const { printVersion } = await import("./src/version");
  printVersion();
  process.exit(0);
}
```

**Add `"update"` to `SUBCOMMANDS`.** Route `update` to `runUpdate()` **before** the `!providerSpec` guard — same pattern as `config` and `doctor`:
```ts
if (subcommand === "update") {
  await runUpdate().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
  process.exit(0);
}
```

Add `update` to the `--help` text.

### `.github/workflows/release.yml` (modify)

After building all 4 binaries, add:

```yaml
- name: Generate checksums
  run: sha256sum cael-darwin-arm64 cael-darwin-x64 cael-linux-x64 cael-linux-arm64 > checksums.sha256

- name: Update Homebrew tap
  if: ${{ secrets.HOMEBREW_TAP_TOKEN != '' }}
  env:
    HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
  run: |
    ARM64_SHA=$(sha256sum cael-darwin-arm64 | cut -d' ' -f1)
    VERSION=${GITHUB_REF_NAME}
    git clone https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/myst9811/homebrew-cael.git tap
    cat > tap/Formula/cael.rb << EOF
    class Cael < Formula
      desc "Local DevOps AI agent for incident investigation"
      homepage "https://github.com/myst9811/Cael"
      version "${VERSION}"
      on_macos do
        on_arm do
          url "https://github.com/myst9811/Cael/releases/download/${VERSION}/cael-darwin-arm64"
          sha256 "${ARM64_SHA}"
          def install
            bin.install "cael-darwin-arm64" => "cael"
          end
        end
        on_intel do
          odie "cael does not provide a macOS x86_64 binary. Use the linux-x64 binary on Linux x86."
        end
      end
    end
    EOF
    cd tap && git config user.email "ci@cael" && git config user.name "Cael CI"
    git add Formula/cael.rb
    git commit -m "cael ${VERSION}" && git push
```

Add `checksums.sha256` to the `softprops/action-gh-release` files list.

### Tests

**`src/commands/update.test.ts`** (new) — mock `fetch` to return a fake releases API + checksums response; verify version comparison; verify asset name selection per platform/arch; verify "already up to date" path; verify dev-build refusal; verify Homebrew install detection; verify checksum mismatch aborts and deletes temp file.

**`src/version.test.ts`** (new, minimal) — verify `VERSION` is a non-empty string; verify `--version`/`-V` flag prints version and exits in `index.ts` integration.

**`src/collectors/git.test.ts`** (extend) — verify `dirty_file_paths` is populated from `git status --short` fixture; verify lockfile names are detected.

---

## What is NOT in M4

- Windows binary or x86 support
- Private repo authentication for `cael update`
- Multiple Homebrew formula variants (only arm64 macOS in the formula)
- Postmortem diffing / comparing two incidents
- Deploy check CI integration (checking GitHub Actions status)
