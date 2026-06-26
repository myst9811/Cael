# M4: Operational Workflows — Design Spec

## Goal

Make `cael deploy-check` and `cael postmortem` production-ready for on-call teams: configurable scoring policies, three new deploy checks, a structured incident timeline, custom postmortem templates, SHA256 release checksums, a Homebrew tap, and a `cael update` self-update command.

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
  cpu_warn: number;        // default 70
  cpu_crit: number;        // default 85
  mem_warn: number;        // default 80
  mem_crit: number;        // default 90
  disk_warn: number;       // default 85
  disk_crit: number;       // default 95
  go_threshold: number;    // default 80  — total score for GO verdict
  caution_threshold: number; // default 60 — total score for CAUTION verdict
}

export const DEFAULT_POLICY: DeployPolicy = {
  cpu_warn: 70, cpu_crit: 85,
  mem_warn: 80, mem_crit: 90,
  disk_warn: 85, disk_crit: 95,
  go_threshold: 80, caution_threshold: 60,
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
inodes: CheckItem;    // 20-point check using disk_inode_percent
```

Git check expanded — same 20 points but now distinguishes three conditions:
- dirty lockfile (`bun.lock`, `package-lock.json`, `yarn.lock`, `Cargo.lock`) → 0 pts, flagged explicitly
- unpushed commits → 5 pts deducted
- dirty non-lockfile → 5 pts deducted

`ScoreResult.hard_block` gains `"inode_critical"` as a new variant (triggered when `disk_inode_percent > 95`).

Total score is now out of 120 (5 existing checks × 20pts + inode 20pts). `go_threshold` and `caution_threshold` in the policy are raw scores out of 120. Default `go_threshold: 96` (80% of 120) and `caution_threshold: 72` (60% of 120).

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

Result: both arrays merged and sorted by `timestamp` ascending. Events without a parseable timestamp are placed at the beginning (oldest-unknown).

**`formatTimeline`** returns a markdown table:
```
| Time | Source | Message |
|------|--------|---------|
| 10:00:01 | git | fix: bump connection pool size (abc1234) |
| 10:00:03 | api (error×4) | Database connection failed |
```

### Modified files

**`src/commands/postmortem/context.ts`**

Change git log command from `git log --oneline -20` to `git log --format="%H %aI %s" -20` so timestamps are available for the timeline.

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
1. `--template <path>` flag
2. `.cael/postmortem-template.md` in CWD (if it exists)
3. `DEFAULT_TEMPLATE`

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

1. Fetch `https://api.github.com/repos/myst9811/Cael/releases/latest` (no auth required for public repo). Timeout: 10s.
2. Compare `tag_name` from response to `VERSION`. If equal or if `VERSION === "dev"`, print "already up to date" and exit.
3. Determine asset name: `cael-${platform}-${arch}` where platform = `darwin`/`linux` and arch = `arm64`/`x64` from `process.platform` + `process.arch`.
4. Find matching asset in `assets` array, get `browser_download_url`.
5. Stream download to a temp file, then `Bun.write` over the current executable path (`process.execPath`). Set file mode `0o755`.
6. Print: `Updated to <tag_name>. Restart cael to use the new version.`

### `index.ts` (modify)

Add `"update"` to `SUBCOMMANDS`. Route to `runUpdate()`. No provider required.

### `.github/workflows/release.yml` (modify)

After building all 4 binaries, add:

```yaml
- name: Generate checksums
  run: sha256sum cael-darwin-arm64 cael-darwin-x64 cael-linux-x64 cael-linux-arm64 > checksums.sha256

- name: Update Homebrew tap
  if: env.HOMEBREW_TAP_TOKEN != ''
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
        end
      end
      def install
        bin.install "cael-darwin-arm64" => "cael"
      end
    end
    EOF
    cd tap && git config user.email "ci@cael" && git config user.name "Cael CI"
    git add Formula/cael.rb
    git commit -m "cael ${VERSION}" && git push
```

Add `checksums.sha256` to the `softprops/action-gh-release` files list.

### Tests

**`src/commands/update.test.ts`** (new) — mock `fetch` to return a fake releases API response; verify version comparison logic; verify correct asset name selection per platform/arch; verify graceful "already up to date" path.

---

## What is NOT in M4

- Windows binary or x86 support
- Private repo authentication for `cael update`
- Multiple Homebrew formula variants (only arm64 macOS in the formula)
- Postmortem diffing / comparing two incidents
- Deploy check CI integration (checking GitHub Actions status)
