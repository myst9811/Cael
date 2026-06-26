import { $ } from "bun";
import type { GitStatus } from "./types";

export function parseGitShortStatus(output: string): { dirty: number; untracked: number } {
  const lines = output.trim().split("\n").filter(Boolean);
  const untracked = lines.filter(l => l.startsWith("??")).length;
  const dirty = lines.length - untracked;
  return { dirty, untracked };
}

export function parseUnpushedCount(output: string): number | null {
  const trimmed = output.trim();
  if (!trimmed || trimmed === "no-upstream") return null;
  const n = parseInt(trimmed);
  return isNaN(n) ? null : n;
}

/**
 * Returns paths of all changed files from `git status --short` output,
 * including untracked files (`??` prefix). Untracked lockfiles are a deploy
 * risk and must not be silently excluded.
 */
export function parseDirtyFilePaths(output: string): string[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map(l => l.slice(3).trim());
}

/**
 * Returns how many commits the local branch is behind its upstream, or null
 * when no upstream is configured or the output is non-numeric (git error).
 */
export function parseBehindCount(output: string): number | null {
  const trimmed = output.trim();
  if (!trimmed || trimmed === "no-upstream") return null;
  const n = parseInt(trimmed);
  return isNaN(n) ? null : n;
}

export async function getGitStatus(): Promise<GitStatus> {
  const isRepo = await $`git rev-parse --is-inside-work-tree`.quiet().nothrow();
  if (isRepo.exitCode !== 0) return { is_git_repo: false };

  const [branch, statusOut, unpushedOut, behindOut, stashOut, logOut] = await Promise.all([
    $`git branch --show-current`.quiet().nothrow().then(r => r.stdout.toString().trim()),
    $`git status --short`.quiet().nothrow().then(r => r.stdout.toString()),
    $`git rev-list "@{u}.." --count`.quiet().nothrow().then(r =>
      r.exitCode === 0 ? r.stdout.toString().trim() : "no-upstream"
    ),
    $`git rev-list "..@{u}" --count`.quiet().nothrow().then(r =>
      r.exitCode === 0 ? r.stdout.toString().trim() : "no-upstream"
    ),
    $`git stash list`.quiet().nothrow().then(r =>
      r.stdout.toString().trim().split("\n").filter(Boolean).length
    ),
    $`git log -1 --format=%s|%h`.quiet().nothrow().then(r => r.stdout.toString().trim()),
  ]);

  const { dirty, untracked } = parseGitShortStatus(statusOut);
  const dirty_file_paths = parseDirtyFilePaths(statusOut);
  const unpushed = parseUnpushedCount(unpushedOut);
  const behind = parseBehindCount(behindOut);
  const pipeIdx = logOut.lastIndexOf("|");
  const lastMsg = pipeIdx > -1 ? logOut.slice(0, pipeIdx) : logOut;
  const lastHash = pipeIdx > -1 ? logOut.slice(pipeIdx + 1) : undefined;

  return {
    is_git_repo: true,
    branch: branch || undefined,
    dirty_files: dirty,
    dirty_file_paths,
    untracked_files: untracked,
    unpushed_commits: unpushed,
    behind_commits: behind,
    stash_count: stashOut,
    last_commit_message: lastMsg || undefined,
    last_commit_hash: lastHash || undefined,
  };
}
